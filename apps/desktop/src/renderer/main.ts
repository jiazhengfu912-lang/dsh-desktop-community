/**
 * Main desktop renderer. The hidden application window loads this entry once
 * from the settled loopback host, boots the shared web shell, and reports its
 * terminal startup state to the Electron main process. The separate splash
 * renderer remains visible until this entry reports ready.
 * @module @deepseek-ai/dsh-desktop/renderer
 */

import { AppWebEntry } from '@deepseek-ai/dsh-client-web'
import type { DesktopBridge } from '../shared/ipc.ts'
import { installIpcFetch } from './ipc-fetch.ts'

const BOOT_TIMEOUT_MS = 30_000

const rawBridge = (window as unknown as { __DSH_BRIDGE__?: DesktopBridge }).__DSH_BRIDGE__
if (rawBridge === undefined) {
  document.body.textContent = 'Desktop bridge missing — the preload did not run.'
  throw new Error('desktop bridge missing')
}
const bridge: DesktopBridge = rawBridge

const rawRoot = document.getElementById('root')
if (rawRoot === null) throw new Error('desktop renderer: missing #root')
const rootEl: HTMLElement = rawRoot

/** Emit one renderer startup phase mark relative to this document load. */
function markStartup(label: string): void {
  console.log(`[renderer:startup] ${label} +${Math.round(performance.now())}ms`)
}

/** Extract the package id from a `/plugins/<id>/client.js?rev=…` bundle URL. */
function bundleIdFromUrl(url: string): string {
  const path = url.split('?', 1)[0] ?? url
  const prefix = '/plugins/'
  const suffix = '/client.js'
  if (path.startsWith(prefix) && path.endsWith(suffix)) {
    return path.slice(prefix.length, -suffix.length)
  }
  return path.replace(/^\/plugins\//, '').replace(/\/client\.js$/, '')
}

function runBundle(content: string): void {
  // The bundle is a classic script that registers its factory via
  // window.__ModuleLoader__.load; evaluate it in global scope.
  // oxlint-disable-next-line typescript/no-implied-eval -- the installed plugin protocol ships classic script text.
  const runner = new Function(content) as () => void
  runner()
}

async function bootApp(): Promise<void> {
  installIpcFetch(bridge)

  try {
    const graph = await bridge.getBootGraph()
    markStartup('boot graph received')
    ;(window as unknown as { __DSH_BOOT__?: unknown }).__DSH_BOOT__ = graph
    const entry = new AppWebEntry(rootEl, {
      loadBundle: async (url: string) => {
        const id = bundleIdFromUrl(url)
        const content = await bridge.readBundle(id)
        runBundle(content)
      },
    })
    await Promise.race([
      entry.run(),
      new Promise<void>((_resolve, reject) => {
        setTimeout(() => {
          reject(new Error('Startup timed out after 30 seconds. The host or client plugins did not become ready.'))
        }, BOOT_TIMEOUT_MS)
      }),
    ])
    markStartup('client plugins settled')
  } catch (error) {
    bridge.rendererFailed(error instanceof Error ? error.message : String(error))
    return
  }

  bridge.rendererReady()
  markStartup('ready reported')
  console.log('[renderer] boot settled')
}

void bootApp()
