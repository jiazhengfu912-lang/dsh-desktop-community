/**
 * Desktop host boot: compose the shared `web` profile (base + web-app
 * bundles, the user's profile and home patch layers, plus the desktop
 * transport overlay), boot it through the shared app-boot kernel, and hand the
 * settled tree's transport face (apiProxy fetch handler + client graph) back
 * to the Electron main process. The core apiProxy rides the IPC bridge; a
 * loopback HTTP server (ephemeral port) serves the window and the third-party
 * web plugins' HTTP/WS routes under a real http:// origin.
 * @module @deepseek-ai/dsh-desktop/host-boot
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import type { EntryOptions } from '@deepseek-ai/cordis-plugin-loader'
import type { PatchOptions } from '@deepseek-ai/cordis-plugin-include'
import {
  boot,
  composeEntries,
  healProfilesModuleFallback,
  loadLayeredEnv,
  loadOptionalPatches,
  loadOverlayPatches,
  loadProfile,
  PROFILE_PATCH_FILENAME,
  type Profile,
} from '@deepseek-ai/dsh-app-boot'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { DSH_LAUNCH_ENVIRONMENT_KEY } from '@deepseek-ai/dsh-launch-environment'
import { provideCmdline } from '@deepseek-ai/dsh-cmdline'
import { toFetchHandler } from '@deepseek-ai/dsh-host-apiproxy'
import { claimSettledHost } from './host-lifecycle.ts'
import { installDesktopPnpmRuntime } from './plugin-runtime.ts'
import { installDesktopPluginServices } from './plugin-services.ts'

/** Structural face of the client-modules node half (avoid importing the dual-face
 * package into the host aggregate — its file list lives in the client program). */
interface ClientModulesFace {
  graph(): unknown
  clientPath(id: string): string | undefined
}

const NAME = 'dsh'

/** Root config filename inside a profile directory (the include anchor). */
const PROFILE_ROOT_FILENAME = 'cordis.yml'

/** The empty root entry list every profile tree patches over. */
const PROFILE_ROOT_CONFIG = '# dsh profile root — an empty entry list.\n[]\n'

/** The session-telemetry row id the DSH_TELEMETRY_DISABLED switch targets. */
const TELEMETRY_ROW_ID = 'session-telemetry-otel'

interface PnpmPackageManifest {
  bin?: string | Record<string, string>
}

function resolvePackagedPnpmBin(manifestPath: string): string {
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as PnpmPackageManifest
  const entry = typeof manifest.bin === 'string' ? manifest.bin : manifest.bin?.pnpm
  if (entry === undefined || entry.length === 0 || entry.includes('\0')) {
    throw new Error('desktop host boot: packaged pnpm does not declare its pnpm executable')
  }
  const packageDir = dirname(manifestPath)
  const binPath = resolve(packageDir, entry)
  const packageRelative = relative(packageDir, binPath)
  if (packageRelative.length === 0 || packageRelative.startsWith('..') || isAbsolute(packageRelative)) {
    throw new Error('desktop host boot: packaged pnpm executable escapes its package directory')
  }
  return binPath
}

/** Inputs the Electron main process resolves before booting the host. */
export interface DesktopHostBootOptions {
  /** Absolute path of the app's own package.json (the profile install anchor). */
  installAnchor: string
  /** Absolute path of the shipped agent-presets root. */
  agentPresetsRoot: string
  /** Absolute path of the desktop transport overlay patch. */
  overlayPatchPath: string
  /** Absolute path of the built renderer's index.html (served over the loopback server). */
  rendererDistIndex: string
  /** Private application state directory for generated package-manager commands. */
  pluginRuntimeDir: string
  /** Electron executable reused in Node mode for packaged CLI and pnpm entries. */
  appExecutable: string
  /** Absolute path of the built private DSH CLI bootstrap. */
  desktopPluginCliPath: string
  /** Electron version used when pnpm installs native dependencies. */
  electronVersion: string
}

/** The settled host's transport face the main process serves over IPC. */
export interface DesktopHostHandle {
  ctx: Context
  fetch: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
  graph: () => unknown
  clientPath: (id: string) => string | undefined
  /** The loopback server's bound port (the window loads over this origin). */
  port: number
  dispose: () => Promise<void>
}

/**
 * Validate a settled Host and transfer its lifecycle to a Desktop handle.
 * A failed validation disposes the unpublished Host before rejecting.
 * @param ctx - settled Host context whose services have finished applying.
 * @returns the validated transport and lifecycle handle.
 */
async function claimDesktopHostHandle(ctx: Context): Promise<DesktopHostHandle> {
  return claimSettledHost(ctx, () => {
    const apiProxy = ctx.get('apiProxy')
    const clientModules = ctx.get('clientModules') as ClientModulesFace | undefined
    if (apiProxy === undefined) {
      throw new Error('desktop host boot: apiProxy service missing after settlement')
    }
    if (clientModules === undefined) {
      throw new Error('desktop host boot: clientModules service missing after settlement')
    }

    const webServer = ctx.get('webServer') as { port: number } | undefined
    if (webServer === undefined) {
      throw new Error('desktop host boot: webServer service missing after settlement')
    }

    return {
      ctx,
      fetch: toFetchHandler(apiProxy).fetch,
      graph: () => clientModules.graph(),
      clientPath: (id: string) => clientModules.clientPath(id),
      port: webServer.port,
      dispose: async () => { await ctx.fiber.dispose() },
    }
  })
}

/** Resolve the telemetry opt-out switch into its boot patch (parity with the CLI launcher). */
function resolveTelemetryPatch(disabledEnv: string | undefined, hasRow: boolean): PatchOptions | undefined {
  if ((disabledEnv ?? '') === '' || !hasRow) return undefined
  return { id: TELEMETRY_ROW_ID, disabled: true }
}

/** Compose and boot the web profile plus the desktop overlay. */
export async function bootHost(options: DesktopHostBootOptions): Promise<DesktopHostHandle> {
  healProfilesModuleFallback(options.installAnchor)
  const homeDir = resolveDshHome()
  const profile: Profile = loadProfile(NAME, 'web', options.installAnchor, homeDir, { userLayer: true })
  // The root is always rewritten (the same guard the CLI launcher applies):
  // a plugin self-disposing can bake composed rows into the root config.
  writeFileSync(join(profile.dir, PROFILE_ROOT_FILENAME), PROFILE_ROOT_CONFIG)

  const homePatchPath = join(homeDir, PROFILE_PATCH_FILENAME)
  const homePatches = loadOptionalPatches(NAME, homePatchPath) ?? []
  const overlayPatches = loadOverlayPatches(NAME, options.overlayPatchPath)
  const bundlePatches = profile.layers.flatMap(layer => layer.patches)

  const rows = new Map<string, EntryOptions>()
  for (const row of composeEntries([bundlePatches, profile.patches, homePatches, overlayPatches])) {
    if (typeof row.id === 'string') rows.set(row.id, row)
  }

  // The shipped agent-presets root is an assembly fact: it sits beside the
  // desktop app's own config, so patch it in when the roster row exists.
  const overlays = [...overlayPatches]
  if (rows.has('agent-presets')) {
    overlays.push({
      id: 'agent-presets',
      config: {
        ...(rows.get('agent-presets')?.config ?? {}) as Record<string, unknown>,
        roots: [{ path: options.agentPresetsRoot, trust: 'system' }],
      },
    })
  }
  const telemetryPatch = resolveTelemetryPatch(process.env.DSH_TELEMETRY_DISABLED, rows.has(TELEMETRY_ROW_ID))
  if (telemetryPatch !== undefined) overlays.push(telemetryPatch)

  // Serve the built desktop renderer over the loopback server: the window loads
  // http://127.0.0.1:<port>/, so plugin fetch()/WebSocket calls resolve against
  // a real http:// origin and reach the HTTP/WS routes they registered.
  overlays.push({
    insert: [{
      id: 'frontend-static-desktop',
      name: '@deepseek-ai/dsh-host-frontend-static',
      inject: ['webServer'],
      config: { distIndex: options.rendererDistIndex },
    }],
  })

  const allPatches: PatchOptions[] = [...bundlePatches, ...profile.patches, ...homePatches, ...overlays]
  const rootConfig = join(profile.dir, PROFILE_ROOT_FILENAME)
  const appRequire = createRequire(options.installAnchor)
  const pnpmManifest = appRequire.resolve('pnpm')
  const pnpmRuntime = installDesktopPnpmRuntime({
    platform: process.platform,
    appExecutable: options.appExecutable,
    pnpmBinPath: resolvePackagedPnpmBin(pnpmManifest),
    electronVersion: options.electronVersion,
    stateDir: options.pluginRuntimeDir,
  })

  const ctx = await boot(NAME, rootConfig, structuredClone(allPatches), (hostCtx) => {
    hostCtx.provide(DSH_LAUNCH_ENVIRONMENT_KEY, loadLayeredEnv(NAME))
    // dshmarket selects its Desktop adapter synchronously during Loader apply.
    // Publish the immutable profile discriminator here, before any entry can
    // fall back to an ambient `dsh`, then publish desktopPnpm when the shared
    // managed subprocess provider becomes available.
    installDesktopPluginServices(hostCtx, {
      profile: { name: profile.name, dir: profile.dir },
      homeDir,
      appExecutable: options.appExecutable,
      desktopCliPath: options.desktopPluginCliPath,
      electronVersion: options.electronVersion,
      pnpmRuntime,
    })
    provideCmdline(hostCtx, { args: [], exit: () => {} })
    // Electron's bundled Node may not expose the internal ESM loader hooks the
    // vendored Loader normally uses (Node >= 22), and its bare `import()`
    // fallback resolves from the loader's own file — where pnpm does not hoist
    // the workspace plugins. Replace the import hook with a createRequire-based
    // resolver that resolves bare names through the profile's node_modules
    // symlinks (the same path the CLI uses under stock Node).
    // The real webserver row (re-enabled in the desktop overlay) owns the
    // HTTP/WS route registries; plugins register against it, and the window is
    // served over it. Only webRuntime stays a desktop stub — the web-runtime row
    // is disabled, and a loopback-only bind needs no LAN trust.
    hostCtx.provide('webRuntime', { trustedHosts: [], lanAddresses: [] })

    const loader = hostCtx.get('loader') as {
      internal: { version: string; import(specifier: string, parentURL: string): Promise<unknown> }
    } | undefined
    if (loader !== undefined) {
      // Resolve in two stages: the profile dir first (user-installed plugins
      // like dshmarket live in ~/.dsh/profiles/<profile>/node_modules as real
      // files), then fall back to this app's own node_modules (inside app.asar).
      // The profile junctions into app.asar are not real filesystem paths, but
      // createRequire + dynamic import both resolve paths inside app.asar fine.
      const profileRequire = createRequire(rootConfig)
      const appRequire = createRequire(options.installAnchor)
      loader.internal = {
        version: 'client',
        import: async (specifier: string) => {
          let resolved: string
          try {
            resolved = profileRequire.resolve(specifier)
          } catch {
            resolved = appRequire.resolve(specifier)
          }
          const imported: unknown = await import(pathToFileURL(resolved).href)
          return imported
        },
      }
    }
  })

  return claimDesktopHostHandle(ctx)
}
