/**
 * DSH Desktop Community — Electron main process. Owns the window, the
 * single-instance lock, the host boot, and the typed IPC bridge. The core
 * ApiProxy rides the IPC fetch carrier; a loopback HTTP server serves the
 * window (http:// origin) plus the third-party web plugins' HTTP/WS routes.
 * @module @deepseek-ai/dsh-desktop/main
 */

import { app, BrowserWindow, ipcMain, Menu } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, isAbsolute, join, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { SessionId } from '@deepseek-ai/dsh-session'
import { IPC_CHANNELS } from '../shared/ipc.ts'
import { bootHost, type DesktopHostHandle } from './host-boot.ts'
import { IpcBridge } from './ipc-bridge.ts'
import { denyRendererNavigation, INBOUND_IPC_ROLES, RendererAuthority } from './renderer-security.ts'
import { acquireSingleInstance, SecondInstanceFocus } from './single-instance.ts'
import { loadWindowState, saveWindowState } from './window-state.ts'

const __dirname = dirname(fileURLToPath(import.meta.url))
const STARTUP_SMOKE_FLAG = '--smoke-test'
const PLUGIN_RUNTIME_SMOKE_FLAG = '--smoke-plugin-runtime'
const MARKET_HTTP_SMOKE_FLAG = '--smoke-market-http'
const GIT_PLUGIN_RUNTIME_SMOKE_PREFIX = '--smoke-git-plugin-runtime='
const GIT_PLUGIN_RUNTIME_SMOKE_DIRECTORY_PREFIX = '--smoke-git-plugin-directory='
const PLUGIN_INVENTORY_SMOKE_FLAG = '--smoke-plugin-inventory'
const PLUGIN_RUNTIME_SMOKE_PACKAGE = 'dsh-desktop-smoke-plugin'
const MARKET_HTTP_SMOKE_PACKAGE = '@dsh-desktop-community/market-smoke-plugin'
const MARKET_HTTP_SMOKE_SOURCE = 'https://github.com/dsh-desktop-community/market-smoke-plugin'
const DATA_REUSE_SMOKE_SESSION = SessionId('desktop-data-reuse-smoke')
const DATA_REUSE_SMOKE_BASE_URL = 'https://desktop-reuse-smoke.invalid/v1'

/** Process-start clock for the startup phase timing report. */
const processStartMs = Date.now()

/** Emit one startup phase mark with its ms offset from process start. */
function markStartup(label: string): void {
  console.log(`[desktop:startup] ${label} +${Date.now() - processStartMs}ms`)
}

/** Walk an error cause/errors chain into a flat, readable diagnostic. */
function describeError(error: unknown, depth = 0): string {
  if (depth > 8 || error === null || typeof error !== 'object') return ''
  const err = error as { message?: string; cause?: unknown; errors?: unknown[] }
  const lines: string[] = []
  if (typeof err.message === 'string') lines.push('  '.repeat(depth) + err.message)
  if (Array.isArray(err.errors)) {
    for (const child of err.errors) lines.push(describeError(child, depth + 1))
  } else if (err.cause !== undefined && err.cause !== error) {
    lines.push(describeError(err.cause, depth + 1))
  }
  return lines.filter(Boolean).join('\n')
}

// Pin the app name so its userData directory stays stable across launches.
app.setName('DSH Desktop Community')

const secondInstanceFocus = new SecondInstanceFocus()
if (acquireSingleInstance(app, secondInstanceFocus)) void main(secondInstanceFocus)

function hostBootOptions(): Parameters<typeof bootHost>[0] {
  const electronVersion = process.versions.electron
  return {
    installAnchor: join(app.getAppPath(), 'package.json'),
    agentPresetsRoot: join(app.getAppPath(), 'config', 'agent-presets'),
    overlayPatchPath: join(app.getAppPath(), 'desktop.patch.yml'),
    rendererDistIndex: join(app.getAppPath(), 'dist', 'renderer', 'index.html'),
    pluginRuntimeDir: join(app.getPath('userData'), 'plugin-runtime'),
    appExecutable: process.execPath,
    desktopPluginCliPath: join(__dirname, 'plugin-cli.mjs'),
    electronVersion,
  }
}

async function runPluginInventorySmoke(host: DesktopHostHandle): Promise<void> {
  const rendererAuthority = new RendererAuthority()
  const bridge = new IpcBridge(rendererAuthority)
  bridge.setHost(host)
  bridge.setAppReadyMs(Date.now())
  bridge.setLogPath(join(app.getPath('userData'), 'logs', 'dsh-desktop-community.log'))
  bridge.setStoragePath(join(app.getPath('userData'), 'desktop-storage.json'))
  bridge.register()

  const window = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  })
  const applicationURL = `http://127.0.0.1:${String(host.port)}/`
  denyRendererNavigation(window.webContents)
  rendererAuthority.set('main', window.webContents, applicationURL)
  try {
    await window.loadURL(applicationURL)
    const result = await window.webContents.executeJavaScript(`new Promise((resolve, reject) => {
      const deadline = Date.now() + 30000
      let stage = 'settings'
      const exactButton = (label) => [...document.querySelectorAll('button')]
        .find((button) => button.textContent?.trim() === label)
      const poll = () => {
        if (Date.now() > deadline) {
          reject(new Error('plugin inventory UI timed out at ' + stage))
          return
        }
        if (stage === 'settings') {
          const trigger = document.querySelector('button[aria-haspopup="dialog"]')
          if (trigger instanceof HTMLElement) {
            trigger.click()
            stage = 'section'
          }
        } else if (stage === 'section') {
          const section = exactButton('插件') ?? exactButton('Plugins')
          if (section instanceof HTMLElement) {
            section.click()
            stage = 'tab'
          }
        } else if (stage === 'tab') {
          const tab = exactButton('插件列表') ?? exactButton('Plugin list')
          if (tab instanceof HTMLElement) {
            tab.click()
            stage = 'inventory'
          }
        } else {
          const alert = document.querySelector('[role="alert"]')
          if (alert !== null) {
            reject(new Error('plugin inventory UI failed: ' + alert.textContent?.trim()))
            return
          }
          const entries = document.querySelectorAll('[data-plugin-entry]')
          if (entries.length > 0) {
            resolve({ count: entries.length })
            return
          }
        }
        setTimeout(poll, 50)
      }
      poll()
    })`, true) as unknown
    if (typeof result !== 'object' || result === null
      || typeof (result as { count?: unknown }).count !== 'number'
      || (result as { count: number }).count < 1) {
      throw new Error('desktop plugin inventory smoke returned an invalid result')
    }
    console.log(`DESKTOP_PLUGIN_INVENTORY_OK entries=${String((result as { count: number }).count)}`)
  } finally {
    rendererAuthority.clear('main', window.webContents)
    if (!window.isDestroyed()) window.destroy()
  }
}

async function runStartupSmoke(): Promise<void> {
  let smokeHandle: DesktopHostHandle | undefined
  let exitCode = 0
  try {
    smokeHandle = await bootHost(hostBootOptions())
    const settings = smokeHandle.ctx.get('settings')
    const deepSeekSettings = settings?.describe().find(descriptor => descriptor.ns === 'llm-deepseek')
    const storedSettings = deepSeekSettings?.user
    if (storedSettings === null || typeof storedSettings !== 'object'
      || (storedSettings as { baseURL?: unknown }).baseURL !== DATA_REUSE_SMOKE_BASE_URL) {
      throw new Error('desktop data reuse smoke: custom DSH_HOME settings were not loaded')
    }

    const sessions = smokeHandle.ctx.get('sessions')
    const persistence = smokeHandle.ctx.get('sessionPersistence')
    if (sessions === undefined || persistence === undefined) {
      throw new Error('desktop data reuse smoke: session services missing after settlement')
    }
    const persistedSession = sessions.create(DATA_REUSE_SMOKE_SESSION, { meta: { cwd: process.cwd() } })
    persistedSession.append('todo/write', { todos: [] })
    await sessions.flush(persistedSession)
    const inspection = await persistence.load(DATA_REUSE_SMOKE_SESSION)
    if (inspection.meta.id !== DATA_REUSE_SMOKE_SESSION
      || inspection.events.at(-1)?.type !== 'todo/write') {
      throw new Error('desktop data reuse smoke: healthy session was not readable from custom DSH_HOME')
    }
    console.log(`DESKTOP_DATA_REUSE_OK session=${DATA_REUSE_SMOKE_SESSION} profile=web settings=llm-deepseek`)

    const smokePluginFlag = process.argv.indexOf(PLUGIN_RUNTIME_SMOKE_FLAG)
    if (smokePluginFlag !== -1) {
      const fixturePath = process.argv[smokePluginFlag + 1]
      if (fixturePath === undefined || !isAbsolute(fixturePath) || fixturePath.includes('\0')) {
        throw new Error('desktop plugin smoke: fixture path must be absolute and NUL-free')
      }
      const profiles = smokeHandle.ctx.get('desktopProfiles')
      const packageManager = smokeHandle.ctx.get('desktopPnpm')
      if (profiles === undefined || packageManager === undefined) {
        throw new Error('desktop plugin smoke: Host services missing after settlement')
      }
      const workspacePath = join(profiles.current.dir, 'pnpm-workspace.yaml')
      const workspace = readFileSync(workspacePath, 'utf8')
      const fixtureBuildKey = `${PLUGIN_RUNTIME_SMOKE_PACKAGE}@file:${relative(
        profiles.current.dir,
        fixturePath,
      ).replaceAll('\\', '/')}`
      writeFileSync(
        workspacePath,
        `${workspace.trimEnd()}\n\nallowBuilds:\n`
        + `  '${fixtureBuildKey.replaceAll("'", "''")}': true\n`
        + `  '${MARKET_HTTP_SMOKE_PACKAGE}': true\n`,
      )
      if (process.argv.includes(MARKET_HTTP_SMOKE_FLAG)) {
        const origin = `http://127.0.0.1:${String(smokeHandle.port)}`
        const response = await fetch(`${origin}/dsh-market/install`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            origin,
          },
          body: JSON.stringify({ url: MARKET_HTTP_SMOKE_SOURCE }),
        })
        const responseText = await response.text()
        let payload: unknown
        try {
          payload = JSON.parse(responseText) as unknown
        } catch {
          throw new Error(
            `desktop market HTTP smoke: route returned non-JSON status=${String(response.status)}\n${responseText}`,
          )
        }
        if (!response.ok || typeof payload !== 'object' || payload === null
          || (payload as { ok?: unknown }).ok !== true) {
          throw new Error(
            `desktop market HTTP smoke: install failed status=${String(response.status)}\n${responseText}`,
          )
        }
        const marketManifest = JSON.parse(readFileSync(join(profiles.current.dir, 'package.json'), 'utf8')) as {
          dependencies?: Record<string, string>
          dsh?: { profile?: { bundles?: string[] } }
        }
        if (marketManifest.dependencies?.[MARKET_HTTP_SMOKE_PACKAGE] === undefined
          || !marketManifest.dsh?.profile?.bundles?.includes(MARKET_HTTP_SMOKE_PACKAGE)) {
          throw new Error('desktop market HTTP smoke: install route did not reconcile the fixture bundle')
        }
        if (!existsSync(join(
          profiles.current.dir,
          'node_modules',
          MARKET_HTTP_SMOKE_PACKAGE,
          'lifecycle-ran.txt',
        ))) {
          throw new Error('desktop market HTTP smoke: fixture lifecycle did not run through packaged pnpm')
        }
        console.log(`DESKTOP_MARKET_HTTP_INSTALL_OK package=${MARKET_HTTP_SMOKE_PACKAGE}`)
      }
      const operation = packageManager.runPlugin(['add', `file:${fixturePath}`], process.cwd())
      const collect = async (stream: NodeJS.ReadableStream): Promise<string> => {
        let output = ''
        for await (const chunk of stream) output = (output + String(chunk)).slice(-64 * 1024)
        return output
      }
      const [stdout, stderr, outcome] = await Promise.all([
        collect(operation.stdout),
        collect(operation.stderr),
        operation.done,
      ])
      if (outcome.exitCode !== 0 || outcome.signal !== null) {
        throw new Error(
          `desktop plugin smoke: install failed exit=${String(outcome.exitCode)} signal=${String(outcome.signal)}\n`
          + `${stdout}\n${stderr}`,
        )
      }
      const manifest = JSON.parse(readFileSync(join(profiles.current.dir, 'package.json'), 'utf8')) as {
        dependencies?: Record<string, string>
        dsh?: { profile?: { bundles?: string[] } }
      }
      const bundles = manifest.dsh?.profile?.bundles
      if (manifest.dependencies?.[PLUGIN_RUNTIME_SMOKE_PACKAGE] === undefined
        || bundles === undefined
        || !bundles.includes(PLUGIN_RUNTIME_SMOKE_PACKAGE)
        || !bundles.includes('dsh-better-sidebar')) {
        throw new Error('desktop plugin smoke: DSH CLI did not reconcile the installed bundle')
      }
      const lifecycleMarkers = [
        join(
          profiles.current.dir,
          'node_modules',
          PLUGIN_RUNTIME_SMOKE_PACKAGE,
          'lifecycle-ran.txt',
        ),
        join(fixturePath, 'lifecycle-ran.txt'),
      ]
      if (!lifecycleMarkers.some(marker => existsSync(marker))) {
        throw new Error(
          'desktop plugin smoke: lifecycle marker missing from the installed and file-source locations\n'
          + `${stdout}\n${stderr}`,
        )
      }
      console.log(`DESKTOP_PLUGIN_RUNTIME_OK package=${PLUGIN_RUNTIME_SMOKE_PACKAGE}`)

      let missingGitError: unknown
      try {
        packageManager.runPlugin(['add', 'github:dsh-desktop-community/prerequisite-smoke'], process.cwd())
      } catch (error: unknown) {
        missingGitError = error
      }
      if (!(missingGitError instanceof Error)
        || !missingGitError.message.includes('Git is required to install github: plugins')) {
        throw new Error('desktop plugin smoke: missing Git did not fail before pnpm')
      }
      console.log('DESKTOP_PLUGIN_GIT_PREREQUISITE_OK')

      const gitPluginArgument = process.argv.find(argument => (
        argument.startsWith(GIT_PLUGIN_RUNTIME_SMOKE_PREFIX)
      ))
      if (gitPluginArgument !== undefined) {
        const gitSpec = gitPluginArgument.slice(GIT_PLUGIN_RUNTIME_SMOKE_PREFIX.length)
        const gitDirectoryArgument = process.argv.find(argument => (
          argument.startsWith(GIT_PLUGIN_RUNTIME_SMOKE_DIRECTORY_PREFIX)
        ))
        const gitDirectory = gitDirectoryArgument?.slice(GIT_PLUGIN_RUNTIME_SMOKE_DIRECTORY_PREFIX.length)
        if (!gitSpec.startsWith('git+file:') || gitSpec.includes('\0')) {
          throw new Error('desktop plugin smoke: Git fixture must use a NUL-free git+file: specification')
        }
        if (gitDirectory === undefined || !isAbsolute(gitDirectory) || gitDirectory.includes('\0')) {
          throw new Error('desktop plugin smoke: Git directory must be absolute and NUL-free')
        }
        const inheritedPath = process.env.PATH ?? ''
        process.env.PATH = inheritedPath.length === 0 ? gitDirectory : `${gitDirectory};${inheritedPath}`
        try {
          const gitOperation = packageManager.runPlugin(['add', gitSpec], process.cwd())
          const [gitStdout, gitStderr, gitOutcome] = await Promise.all([
            collect(gitOperation.stdout),
            collect(gitOperation.stderr),
            gitOperation.done,
          ])
          if (gitOutcome.exitCode !== 0 || gitOutcome.signal !== null) {
            throw new Error(
              `desktop plugin smoke: git+file install failed exit=${String(gitOutcome.exitCode)} signal=${String(gitOutcome.signal)}\n`
              + `${gitStdout}\n${gitStderr}`,
            )
          }
        } finally {
          process.env.PATH = inheritedPath
        }
        console.log(`DESKTOP_GIT_PLUGIN_RUNTIME_OK package=${PLUGIN_RUNTIME_SMOKE_PACKAGE}`)
      }
    }
    if (process.argv.includes(PLUGIN_INVENTORY_SMOKE_FLAG)) {
      await runPluginInventorySmoke(smokeHandle)
    }
    console.log(`DESKTOP_STARTUP_OK port=${String(smokeHandle.port)}`)
  } catch (error) {
    exitCode = 1
    console.error('[desktop:smoke] host failed:\n' + describeError(error))
  } finally {
    if (smokeHandle !== undefined) await smokeHandle.dispose().catch(() => {})
    app.exit(exitCode)
  }
}

async function main(focusHandoff: SecondInstanceFocus): Promise<void> {
  await app.whenReady()
  const appReadyMs = Date.now()
  markStartup('app ready')

  // Windows otherwise receives Electron's default File/Edit/View/Window/Help
  // template. Clear it before constructing either startup window.
  Menu.setApplicationMenu(null)
  if (process.platform === 'win32') app.setAppUserModelId('io.github.jiazhengfu912.dshdesktop')

  if (process.argv.includes(STARTUP_SMOKE_FLAG)) {
    await runStartupSmoke()
    return
  }

  let splashWindow: BrowserWindow | undefined
  let mainWindow: BrowserWindow | undefined
  let handle: DesktopHostHandle | undefined
  let booting = false
  let bootGeneration = 0
  let bootTask: Promise<void> = Promise.resolve()
  let handoffStarted = false
  let quitting = false
  let cleanedUp = false
  const rendererAuthority = new RendererAuthority()
  const bridge = new IpcBridge(rendererAuthority)

  const isLive = (window: BrowserWindow | undefined): window is BrowserWindow => (
    window !== undefined && !window.isDestroyed()
  )

  const showSplashError = (message: string): void => {
    if (isLive(splashWindow)) splashWindow.webContents.send(IPC_CHANNELS.hostError, message)
  }

  const createMainWindow = async (port: number, generation: number): Promise<void> => {
    const state = loadWindowState()
    const candidate = new BrowserWindow({
      width: state.width,
      height: state.height,
      ...(state.x !== undefined && state.y !== undefined ? { x: state.x, y: state.y } : {}),
      show: false,
      title: 'DSH Desktop Community',
      icon: join(app.getAppPath(), 'build', 'icon.ico'),
      backgroundColor: '#ffffff',
      autoHideMenuBar: true,
      webPreferences: {
        preload: join(__dirname, '../preload/index.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false,
      },
    })
    candidate.setMenu(null)
    candidate.on('page-title-updated', (event) => { event.preventDefault() })
    if (state.isMaximized) candidate.maximize()
    mainWindow = candidate
    const applicationURL = `http://127.0.0.1:${String(port)}/`
    denyRendererNavigation(candidate.webContents)
    const retireRenderer = rendererAuthority.set('main', candidate.webContents, applicationURL)

    candidate.webContents.on('did-finish-load', () => {
      markStartup('application document loaded')
      console.log('[desktop] application document loaded')
    })
    candidate.webContents.on('render-process-gone', (_event, details) => {
      if (quitting || mainWindow !== candidate) return
      showSplashError(`Application renderer exited: ${details.reason}`)
      mainWindow = undefined
      retireRenderer()
      candidate.destroy()
    })
    candidate.on('close', () => {
      if (handoffStarted && mainWindow === candidate) saveWindowState(candidate)
    })
    candidate.on('closed', () => {
      focusHandoff.clearTarget(candidate)
      retireRenderer()
      if (mainWindow === candidate) mainWindow = undefined
    })

    try {
      await candidate.loadURL(applicationURL)
    } catch (error) {
      retireRenderer()
      if (mainWindow === candidate) mainWindow = undefined
      if (!candidate.isDestroyed()) candidate.destroy()
      throw error
    }
    if (quitting || generation !== bootGeneration || mainWindow !== candidate) {
      retireRenderer()
      if (!candidate.isDestroyed()) candidate.destroy()
      return
    }
    markStartup('application navigation complete')
  }

  const attemptBoot = async (generation: number): Promise<void> => {
    booting = true
    try {
      const previous = handle
      handle = undefined
      if (previous !== undefined) await previous.dispose().catch(() => {})

      const next = await bootHost(hostBootOptions())
      if (quitting || generation !== bootGeneration) {
        await next.dispose().catch(() => {})
        return
      }
      handle = next
      markStartup('host settled')
      // Publish the host before constructing the hidden application window,
      // so its first boot-graph request resolves without a waiter race.
      bridge.setHost(next)
      await createMainWindow(next.port, generation)
      console.log('[desktop] host ready')
    } catch (error) {
      if (quitting || generation !== bootGeneration) return
      bridge.setHostError(error instanceof Error ? error : new Error(String(error)))
      const message = error instanceof Error ? error.message : String(error)
      console.error('[desktop] host failed:\n' + describeError(error))
      showSplashError(message)
    } finally {
      if (generation === bootGeneration) booting = false
    }
  }

  const startBoot = (): void => {
    const generation = ++bootGeneration
    bridge.reset()
    bootTask = attemptBoot(generation)
  }

  const reloadSplash = async (): Promise<void> => {
    if (!isLive(splashWindow)) return
    const window = splashWindow
    const loaded = new Promise<void>((resolve) => { window.webContents.once('did-finish-load', () => { resolve() }) })
    window.webContents.reload()
    await loaded
  }

  const retryBoot = async (): Promise<void> => {
    if (booting || quitting || handoffStarted) return
    if (isLive(mainWindow)) {
      rendererAuthority.clear('main', mainWindow.webContents)
      mainWindow.destroy()
    }
    mainWindow = undefined
    await reloadSplash()
    startBoot()
  }

  const revealMainWindow = (): void => {
    const application = mainWindow
    if (handoffStarted || !isLive(application)) return
    handoffStarted = true

    if (isLive(splashWindow)) {
      const splash = splashWindow
      if (splash.isMaximized()) application.maximize()
      else application.setBounds(splash.getBounds())
      application.show()
      if (splash.isMinimized()) application.minimize()
      splash.close()
    } else {
      application.show()
    }
    focusHandoff.setTarget(application)
    markStartup('application shown')
  }

  bridge.setLogPath(join(app.getPath('userData'), 'logs', 'dsh-desktop-community.log'))
  bridge.setAppReadyMs(appReadyMs)
  bridge.setStoragePath(join(app.getPath('userData'), 'desktop-storage.json'))
  bridge.register()

  ipcMain.on(IPC_CHANNELS.rendererReady, (event) => {
    if (!rendererAuthority.isAuthorized(event, INBOUND_IPC_ROLES[IPC_CHANNELS.rendererReady])) return
    if (!isLive(mainWindow)) return
    revealMainWindow()
  })
  ipcMain.on(IPC_CHANNELS.rendererFailed, (event, message: unknown) => {
    if (!rendererAuthority.isAuthorized(event, INBOUND_IPC_ROLES[IPC_CHANNELS.rendererFailed])) return
    if (!isLive(mainWindow)) return
    const rendered = typeof message === 'string' && message.length > 0
      ? message.slice(0, 16_384)
      : 'Application renderer failed without a diagnostic.'
    const failedWindow = mainWindow
    mainWindow = undefined
    rendererAuthority.clear('main', failedWindow.webContents)
    showSplashError(rendered)
    failedWindow.destroy()
  })
  ipcMain.on(IPC_CHANNELS.retry, (event) => {
    if (!rendererAuthority.isAuthorized(event, INBOUND_IPC_ROLES[IPC_CHANNELS.retry])) return
    void retryBoot()
  })
  ipcMain.on(IPC_CHANNELS.quit, (event) => {
    if (!rendererAuthority.isAuthorized(event, INBOUND_IPC_ROLES[IPC_CHANNELS.quit])) return
    app.quit()
  })

  const state = loadWindowState()
  const splashPath = join(__dirname, '../renderer/splash.html')
  const splashURL = pathToFileURL(splashPath).href
  const splashCandidate = new BrowserWindow({
    width: state.width,
    height: state.height,
    ...(state.x !== undefined && state.y !== undefined ? { x: state.x, y: state.y } : {}),
    show: false,
    title: 'DSH Desktop Community',
    icon: join(app.getAppPath(), 'build', 'icon.ico'),
    backgroundColor: '#ffffff',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  })
  splashWindow = splashCandidate
  denyRendererNavigation(splashCandidate.webContents)
  const retireSplashRenderer = rendererAuthority.set('splash', splashCandidate.webContents, splashURL)
  splashCandidate.setMenu(null)
  if (state.isMaximized) splashCandidate.maximize()
  splashCandidate.on('close', () => {
    if (!handoffStarted && isLive(splashCandidate)) saveWindowState(splashCandidate)
  })
  splashCandidate.on('closed', () => {
    focusHandoff.clearTarget(splashCandidate)
    retireSplashRenderer()
    if (splashWindow === splashCandidate) splashWindow = undefined
    if (!handoffStarted && !quitting) app.quit()
  })

  try {
    await splashCandidate.loadFile(splashPath)
  } catch (error) {
    retireSplashRenderer()
    console.error('[desktop] splash failed:\n' + describeError(error))
    app.quit()
    return
  }
  if (isLive(splashCandidate)) {
    splashCandidate.show()
    focusHandoff.setTarget(splashCandidate)
  }
  markStartup('splash loaded')

  // The visible splash owns its renderer for the whole boot. The application
  // renderer starts once in a separate hidden window after the host settles.
  startBoot()

  app.on('window-all-closed', () => { app.quit() })

  app.on('before-quit', (event) => {
    if (cleanedUp) return
    event.preventDefault()
    cleanedUp = true
    quitting = true
    bootGeneration += 1
    void (async () => {
      await bootTask.catch(() => {})
      if (handle !== undefined) await handle.dispose().catch(() => {})
    })().finally(() => { app.quit() })
  })
}
