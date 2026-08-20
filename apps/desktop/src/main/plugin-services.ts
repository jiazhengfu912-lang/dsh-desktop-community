/** Generation-scoped Desktop services consumed by plugin managers such as dshmarket. */

import { readFileSync } from 'node:fs'
import { delimiter, isAbsolute, join } from 'node:path'
import type { Readable } from 'node:stream'
import { pathToFileURL } from 'node:url'
import { Context, Service } from '@deepseek-ai/cordis'
import type { SubprocessHandle, SubprocessOutcome, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { assertPluginPrerequisites } from './plugin-prerequisites.ts'
import type { DesktopPnpmRuntime } from './plugin-runtime.ts'

const TERMINATION_GRACE_MS = 3_000
const ELECTRON_HEADERS_URL = 'https://electronjs.org/headers'

/** Profile identity fixed for one Desktop Host generation. */
export interface DesktopCurrentProfile {
  readonly name: string
  readonly dir: string
}

/** Profile inventory item exposed by this single-profile Desktop shell. */
export interface DesktopProfileSummary extends DesktopCurrentProfile {
  readonly exists: true
  readonly bundles: readonly string[]
  readonly webCapable: true
}

/** Public Desktop profile service used as the pre-Loader environment discriminator. */
export interface DesktopProfiles {
  readonly current: DesktopCurrentProfile
  list(): readonly DesktopProfileSummary[]
  select(name: string): Promise<void>
}

/** Exit facts for one Desktop-owned package operation. */
export interface DesktopPnpmOutcome {
  readonly exitCode: number | null
  readonly signal: NodeJS.Signals | null
}

/** Streaming handle returned to a Desktop plugin manager. */
export interface DesktopPnpmHandle {
  readonly stdout: Readable
  readonly stderr: Readable
  readonly done: Promise<DesktopPnpmOutcome>
  cancel(): void
}

/** Package operations scoped to the active Desktop profile generation. */
export interface DesktopPnpm {
  run(args: readonly string[], signal?: AbortSignal): DesktopPnpmHandle
  runPlugin(args: readonly string[], invokingDir: string, signal?: AbortSignal): DesktopPnpmHandle
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    desktopProfiles: DesktopProfiles
    desktopPnpm: DesktopPnpm
  }
}

/** Immutable inputs for the two Desktop Host services. */
export interface DesktopPluginServicesOptions {
  readonly profile: DesktopCurrentProfile
  readonly homeDir: string
  readonly appExecutable: string
  readonly desktopCliPath: string
  readonly electronVersion: string
  readonly pnpmRuntime: DesktopPnpmRuntime
}

interface ActiveOperation {
  readonly child: SubprocessHandle
  done: Promise<DesktopPnpmOutcome>
}

function assertAbsolutePath(label: string, value: string): void {
  if (!isAbsolute(value) || value.includes('\0')) {
    throw new Error(`desktop plugin services: ${label} must be an absolute path without NUL`)
  }
}

function validatedArgs(args: readonly string[]): string[] {
  if (args.length === 0) throw new Error('desktop plugin services: pnpm arguments must not be empty')
  if (args.some(argument => argument.includes('\0'))) {
    throw new Error('desktop plugin services: pnpm arguments must not contain NUL')
  }
  return [...args]
}

function inheritedPath(): string {
  const exact = process.env.PATH
  if (exact !== undefined || process.platform !== 'win32') return exact ?? ''
  return Object.entries(process.env).find(([name]) => name.toUpperCase() === 'PATH')?.[1] ?? ''
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object'
}

function isStringArray(value: unknown): value is readonly string[] {
  if (!Array.isArray(value)) return false
  const values: readonly unknown[] = value
  return values.every(item => typeof item === 'string')
}

function currentProfileBundles(profileDir: string): readonly string[] {
  const parsed: unknown = JSON.parse(readFileSync(join(profileDir, 'package.json'), 'utf8'))
  if (!isRecord(parsed)) {
    throw new Error('desktop plugin services: profile package.json must contain an object')
  }
  const dsh = parsed.dsh
  if (dsh === undefined) return []
  if (!isRecord(dsh)) {
    throw new Error('desktop plugin services: profile package.json dsh field must contain an object')
  }
  const profile = dsh.profile
  if (profile === undefined) return []
  if (!isRecord(profile)) {
    throw new Error('desktop plugin services: profile package.json dsh.profile field must contain an object')
  }
  const bundles = profile.bundles
  if (bundles === undefined) return []
  if (!isStringArray(bundles)) {
    throw new Error('desktop plugin services: profile package.json dsh.profile.bundles must contain strings')
  }
  return Object.freeze([...bundles])
}

class FixedDesktopProfiles extends Service implements DesktopProfiles {
  private readonly fixedCurrent: DesktopCurrentProfile
  private disposed = false

  constructor(ctx: Context, profile: DesktopCurrentProfile) {
    assertAbsolutePath('profile directory', profile.dir)
    if (profile.name.length === 0 || profile.name.includes('\0')) {
      throw new Error('desktop plugin services: profile name must not be empty or contain NUL')
    }
    super(ctx, 'desktopProfiles')
    this.fixedCurrent = Object.freeze({ ...profile })
    ctx.effect(() => () => { this.disposed = true }, 'desktop: profile service lifetime')
  }

  get current(): DesktopCurrentProfile {
    this.assertActive()
    return this.fixedCurrent
  }

  list(): readonly DesktopProfileSummary[] {
    this.assertActive()
    return [Object.freeze({
      ...this.fixedCurrent,
      exists: true,
      bundles: currentProfileBundles(this.fixedCurrent.dir),
      webCapable: true,
    })]
  }

  select(name: string): Promise<void> {
    try {
      this.assertActive()
      if (name === this.fixedCurrent.name) return Promise.resolve()
      return Promise.reject(new Error(`desktop plugin services: profile switching is unavailable in this build (${JSON.stringify(name)})`))
    } catch (error) {
      return Promise.reject(error instanceof Error ? error : new Error(String(error)))
    }
  }

  private assertActive(): void {
    if (this.disposed) throw new Error('desktop plugin services: desktopProfiles service disposed')
  }
}

class ManagedDesktopPnpm extends Service implements DesktopPnpm {
  private active: ActiveOperation | undefined
  private closed = false

  constructor(ctx: Context, private readonly options: DesktopPluginServicesOptions) {
    super(ctx, 'desktopPnpm')
    for (const [label, value] of [
      ['Harness home', options.homeDir],
      ['application executable', options.appExecutable],
      ['Desktop CLI entry', options.desktopCliPath],
      ['pnpm entry', options.pnpmRuntime.pnpmBinPath],
      ['pnpm command directory', options.pnpmRuntime.pathDir],
      ['Node command directory', options.pnpmRuntime.nodeBinDir],
      ['Node command', options.pnpmRuntime.nodeShimPath],
      ['environment preloader', options.pnpmRuntime.clearEnvironmentPath],
      ['pnpm store', options.pnpmRuntime.storeDir],
      ['pnpm cache', options.pnpmRuntime.cacheDir],
    ] as const) assertAbsolutePath(label, value)
    if (options.electronVersion.length === 0 || options.electronVersion.includes('\0')) {
      throw new Error('desktop plugin services: Electron version must not be empty or contain NUL')
    }
    ctx.effect(() => async () => {
      this.closed = true
      const active = this.active
      if (active === undefined) return
      active.child.terminate()
      await active.done.catch(() => {})
    }, 'desktop: active plugin package operation teardown')
  }

  run(args: readonly string[], signal?: AbortSignal): DesktopPnpmHandle {
    return this.start({
      argv: [
        this.options.appExecutable,
        '--import',
        pathToFileURL(this.options.pnpmRuntime.clearEnvironmentPath).href,
        this.options.pnpmRuntime.pnpmBinPath,
        ...validatedArgs(args),
      ],
      cwd: this.options.profile.dir,
      ...(signal === undefined ? {} : { signal }),
    })
  }

  runPlugin(args: readonly string[], invokingDir: string, signal?: AbortSignal): DesktopPnpmHandle {
    assertAbsolutePath('plugin invoking directory', invokingDir)
    assertPluginPrerequisites(args)
    return this.start({
      argv: [
        this.options.appExecutable,
        this.options.desktopCliPath,
        'plugin',
        '--profile',
        this.options.profile.name,
        ...validatedArgs(args),
      ],
      cwd: invokingDir,
      ...(signal === undefined ? {} : { signal }),
    })
  }

  private start(command: { argv: readonly string[]; cwd: string; signal?: AbortSignal }): DesktopPnpmHandle {
    if (this.closed) throw new Error('desktop plugin services: package-manager generation is closed')
    if (this.active !== undefined) throw new Error('desktop plugin services: another desktop pnpm operation is already running')
    command.signal?.throwIfAborted()
    const parentPath = inheritedPath()
    const managedPath = [
      this.options.pnpmRuntime.pathDir,
      this.options.pnpmRuntime.nodeBinDir,
      ...(parentPath.length === 0 ? [] : [parentPath]),
    ].join(delimiter)
    const spec: SubprocessSpawnSpec = {
      argv: command.argv,
      cwd: command.cwd,
      stdio: { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' },
      graceMs: TERMINATION_GRACE_MS,
      ...(command.signal === undefined ? {} : { signal: command.signal }),
      env: {
        ...this.options.pnpmRuntime.environment,
        PATH: managedPath,
        NODE: this.options.pnpmRuntime.nodeShimPath,
        ELECTRON_RUN_AS_NODE: '1',
        DSH_HOME: this.options.homeDir,
        CI: 'true',
        npm_config_runtime: 'electron',
        npm_config_target: this.options.electronVersion,
        npm_config_disturl: ELECTRON_HEADERS_URL,
        // The subprocess provider replaces inherited keys case-insensitively on Windows.
        npm_config_store_dir: this.options.pnpmRuntime.storeDir,
        npm_config_cache: this.options.pnpmRuntime.cacheDir,
      },
    }
    const child = this.ctx.subprocess.spawn(spec)
    if (child.stdout === undefined || child.stderr === undefined) {
      child.terminate()
      throw new Error('desktop plugin services: managed subprocess did not expose piped output')
    }
    const active: ActiveOperation = { child, done: Promise.resolve({ exitCode: null, signal: null }) }
    active.done = this.settle(active)
    this.active = active
    return {
      stdout: child.stdout,
      stderr: child.stderr,
      done: active.done,
      cancel: () => { child.terminate() },
    }
  }

  private async settle(active: ActiveOperation): Promise<DesktopPnpmOutcome> {
    try {
      const outcome: SubprocessOutcome = await active.child.done
      return { exitCode: outcome.exitCode, signal: outcome.signal }
    } finally {
      try {
        await active.child.waitForExit()
      } finally {
        if (this.active === active) this.active = undefined
      }
    }
  }
}

/**
 * Publish the Desktop discriminator before Loader entries and the package
 * service as soon as the shared subprocess provider becomes available.
 */
export function installDesktopPluginServices(ctx: Context, options: DesktopPluginServicesOptions): void {
  new FixedDesktopProfiles(ctx, options.profile)
  ctx.inject(['subprocess'], (subprocessCtx: Context) => {
    new ManagedDesktopPnpm(subprocessCtx, options)
  })
}
