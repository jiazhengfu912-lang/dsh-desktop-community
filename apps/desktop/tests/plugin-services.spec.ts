import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { PassThrough } from 'node:stream'
import { basename, delimiter, dirname, join, resolve } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import type { SubprocessHandle, SubprocessOutcome, SubprocessSpawnSpec } from '@deepseek-ai/dsh-subprocess'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { installDesktopPluginServices } from '../src/main/plugin-services.ts'

const contexts: Context[] = []
const temporaryProfiles: string[] = []
const TEMPORARY_PROFILE_PREFIX = 'dsh-desktop-plugin-services-'

interface Deferred<T> {
  promise: Promise<T>
  resolve(value: T | PromiseLike<T>): void
}

function deferred<T>(): Deferred<T> {
  let resolve!: Deferred<T>['resolve']
  const promise = new Promise<T>((settle) => { resolve = settle })
  return { promise, resolve }
}

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(async (ctx) => { await ctx.fiber.dispose() }))
  const temporaryRoot = resolve(tmpdir())
  for (const directory of temporaryProfiles.splice(0)) {
    const target = resolve(directory)
    if (dirname(target) !== temporaryRoot || !basename(target).startsWith(TEMPORARY_PROFILE_PREFIX)) {
      throw new Error(`refusing to remove unexpected test profile: ${target}`)
    }
    rmSync(target, { recursive: true, force: true })
  }
})

function writeProfileManifest(profileDir: string, bundles: readonly string[]): void {
  writeFileSync(join(profileDir, 'package.json'), JSON.stringify({
    name: 'desktop-plugin-services-test',
    private: true,
    dsh: { profile: { bundles } },
  }, null, 2) + '\n')
}

describe('Desktop plugin-management Host services', () => {
  it('selects the Desktop branch before Loader plugins run and executes plugin work through the managed runtime', async () => {
    const ctx = new Context()
    contexts.push(ctx)
    const profileDir = mkdtempSync(join(tmpdir(), TEMPORARY_PROFILE_PREFIX))
    temporaryProfiles.push(profileDir)
    writeProfileManifest(profileDir, ['@deepseek-ai/dsh-base'])
    const invokingDir = resolve('plugin-checkout')
    const stdout = new PassThrough()
    const stderr = new PassThrough()
    const waitForExit = vi.fn(() => Promise.resolve(true))
    const terminate = vi.fn()
    const completion = deferred<SubprocessOutcome>()
    const spawn = vi.fn((_spec: SubprocessSpawnSpec): SubprocessHandle => ({
      pid: 1234,
      stdin: undefined,
      stdout,
      stderr,
      collected: {},
      done: completion.promise,
      terminate,
      waitForExit,
    }))

    installDesktopPluginServices(ctx, {
      profile: { name: 'web', dir: profileDir },
      homeDir: resolve('dsh-home'),
      appExecutable: resolve('DSH Desktop Community.exe'),
      desktopCliPath: resolve('desktop-plugin-cli.mjs'),
      electronVersion: '36.9.5',
      pnpmRuntime: {
        pathDir: resolve('runtime', 'bin'),
        pnpmBinPath: resolve('app', 'node_modules', 'pnpm', 'bin', 'pnpm.cjs'),
        nodeBinDir: resolve('runtime', 'private', 'node-bin'),
        nodeShimPath: resolve('runtime', 'private', 'node-bin', 'node.cmd'),
        clearEnvironmentPath: resolve('runtime', 'private', 'clear-env.mjs'),
        storeDir: resolve('runtime', 'store'),
        cacheDir: resolve('runtime', 'cache'),
        environment: {
          DSH_DESKTOP_APP_EXECUTABLE: resolve('DSH Desktop Community.exe'),
          DSH_DESKTOP_PNPM_ENTRY: resolve('app', 'node_modules', 'pnpm', 'bin', 'pnpm.cjs'),
        },
      },
    })

    // dshmarket makes this decision synchronously from its Loader apply().
    // A service added only after settlement is too late and leaves it on the
    // ambient `dsh` fallback for the lifetime of this Host generation.
    const profiles = ctx.get('desktopProfiles')
    expect(profiles).toMatchObject({
      current: { name: 'web', dir: profileDir },
    })
    expect(profiles?.list()[0]?.bundles).toEqual(['@deepseek-ai/dsh-base'])

    ctx.provide('subprocess', { spawn } as never)
    await vi.waitFor(() => { expect(ctx.get('desktopPnpm')).toBeDefined() })

    const service = ctx.get('desktopPnpm')
    if (service === undefined) throw new Error('desktopPnpm was not published')
    const operation = service.runPlugin(['add', '@liustack/modlens'], invokingDir)
    expect(() => service.runPlugin(['remove', '@liustack/modlens'], invokingDir))
      .toThrow('desktop plugin services: another desktop pnpm operation is already running')
    operation.cancel()
    expect(terminate).toHaveBeenCalledOnce()
    expect(() => service.runPlugin(['remove', '@liustack/modlens'], invokingDir))
      .toThrow('desktop plugin services: another desktop pnpm operation is already running')
    completion.resolve({ exitCode: 0, signal: null })
    await expect(operation.done).resolves.toEqual({ exitCode: 0, signal: null })

    expect(spawn).toHaveBeenCalledOnce()
    const firstCall = spawn.mock.calls.at(0)
    if (firstCall === undefined) throw new Error('managed subprocess was not started')
    const [spec] = firstCall
    expect(spec.argv).toEqual([
      resolve('DSH Desktop Community.exe'),
      resolve('desktop-plugin-cli.mjs'),
      'plugin',
      '--profile',
      'web',
      'add',
      '@liustack/modlens',
    ])
    expect(spec.cwd).toBe(invokingDir)
    expect(spec.stdio).toEqual({ stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' })
    expect(spec.env).toMatchObject({
      ELECTRON_RUN_AS_NODE: '1',
      DSH_HOME: resolve('dsh-home'),
      NODE: resolve('runtime', 'private', 'node-bin', 'node.cmd'),
      npm_config_runtime: 'electron',
      npm_config_target: '36.9.5',
      DSH_DESKTOP_APP_EXECUTABLE: resolve('DSH Desktop Community.exe'),
      DSH_DESKTOP_PNPM_ENTRY: resolve('app', 'node_modules', 'pnpm', 'bin', 'pnpm.cjs'),
      npm_config_store_dir: resolve('runtime', 'store'),
      npm_config_cache: resolve('runtime', 'cache'),
    })
    expect(spec.env?.PATH?.split(delimiter).slice(0, 2)).toEqual([
      resolve('runtime', 'bin'),
      resolve('runtime', 'private', 'node-bin'),
    ])
    expect(operation.stdout).toBe(stdout)
    expect(operation.stderr).toBe(stderr)
    expect(waitForExit).toHaveBeenCalledOnce()

    writeProfileManifest(profileDir, ['@deepseek-ai/dsh-base', '@liustack/modlens'])
    expect(profiles?.list()[0]?.bundles).toEqual(['@deepseek-ai/dsh-base', '@liustack/modlens'])
  })

  it('terminates and joins an active package operation before Host disposal completes', async () => {
    const ctx = new Context()
    const profileDir = mkdtempSync(join(tmpdir(), TEMPORARY_PROFILE_PREFIX))
    temporaryProfiles.push(profileDir)
    writeProfileManifest(profileDir, ['@deepseek-ai/dsh-base'])
    const completion = deferred<SubprocessOutcome>()
    const exited = deferred<boolean>()
    const terminate = vi.fn(() => {
      completion.resolve({ exitCode: null, signal: 'SIGTERM' })
    })
    const waitForExit = vi.fn(() => exited.promise)
    const spawn = vi.fn((_spec: SubprocessSpawnSpec): SubprocessHandle => ({
      pid: 1234,
      stdin: undefined,
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      collected: {},
      done: completion.promise,
      terminate,
      waitForExit,
    }))

    installDesktopPluginServices(ctx, {
      profile: { name: 'web', dir: profileDir },
      homeDir: resolve('dsh-home'),
      appExecutable: resolve('DSH Desktop Community.exe'),
      desktopCliPath: resolve('desktop-plugin-cli.mjs'),
      electronVersion: '36.9.5',
      pnpmRuntime: {
        pathDir: resolve('runtime', 'bin'),
        pnpmBinPath: resolve('app', 'node_modules', 'pnpm', 'bin', 'pnpm.cjs'),
        nodeBinDir: resolve('runtime', 'private', 'node-bin'),
        nodeShimPath: resolve('runtime', 'private', 'node-bin', 'node.cmd'),
        clearEnvironmentPath: resolve('runtime', 'private', 'clear-env.mjs'),
        storeDir: resolve('runtime', 'store'),
        cacheDir: resolve('runtime', 'cache'),
        environment: {},
      },
    })
    ctx.provide('subprocess', { spawn } as never)
    await vi.waitFor(() => { expect(ctx.get('desktopPnpm')).toBeDefined() })
    const service = ctx.get('desktopPnpm')
    if (service === undefined) throw new Error('desktopPnpm was not published')
    const operation = service.runPlugin(['add', '@liustack/modlens'], profileDir)
    let disposed = false
    const disposal = ctx.fiber.dispose().then(() => { disposed = true })

    try {
      await vi.waitFor(() => { expect(terminate).toHaveBeenCalledOnce() })
      await vi.waitFor(() => { expect(waitForExit).toHaveBeenCalledOnce() })
      expect(disposed).toBe(false)
      exited.resolve(true)
      await disposal
      await expect(operation.done).resolves.toEqual({ exitCode: null, signal: 'SIGTERM' })
      expect(disposed).toBe(true)
    } finally {
      completion.resolve({ exitCode: null, signal: 'SIGTERM' })
      exited.resolve(true)
      await disposal
    }
  })
})
