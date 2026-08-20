/**
 * Renderer trust checks for the Electron main process. Privileged IPC accepts
 * only the registered application or splash main frame at its fixed URL, and
 * renderer-initiated document/window navigation is denied.
 * @module @deepseek-ai/dsh-desktop/renderer-security
 */

import type { IpcMainEvent, IpcMainInvokeEvent, WebContents } from 'electron'
import { IPC_CHANNELS } from '../shared/ipc.ts'

/** The two renderer documents that receive the restricted preload. */
export type RendererRole = 'main' | 'splash'

/** Required renderer role for every fixed renderer-to-main IPC channel. */
export const INBOUND_IPC_ROLES = {
  [IPC_CHANNELS.fetchRequest]: 'main',
  [IPC_CHANNELS.fetchAbort]: 'main',
  [IPC_CHANNELS.bundleRead]: 'main',
  [IPC_CHANNELS.bootGraphGet]: 'main',
  [IPC_CHANNELS.startupInfo]: 'main',
  [IPC_CHANNELS.storageLoad]: 'main',
  [IPC_CHANNELS.storageSet]: 'main',
  [IPC_CHANNELS.storageRemove]: 'main',
  [IPC_CHANNELS.logOpen]: 'splash',
  [IPC_CHANNELS.rendererReady]: 'main',
  [IPC_CHANNELS.rendererFailed]: 'main',
  [IPC_CHANNELS.retry]: 'splash',
  [IPC_CHANNELS.quit]: 'splash',
} as const satisfies Record<string, RendererRole>

/** One channel whose renderer-to-main messages require authorization. */
export type InboundIpcChannel = keyof typeof INBOUND_IPC_ROLES

type RendererEvent = Pick<IpcMainEvent | IpcMainInvokeEvent, 'sender' | 'senderFrame'>

interface RegisteredRenderer {
  readonly webContents: WebContents
  readonly expectedURL: string
  readonly expectedOrigin: string
}

/** Mutable registry of the currently authoritative renderer for each role. */
export class RendererAuthority {
  private readonly renderers = new Map<RendererRole, RegisteredRenderer>()

  /**
   * Replace the authoritative renderer for one role.
   * @param role - application or splash role.
   * @param webContents - exact Electron WebContents instance for the role.
   * @param expectedURL - fixed top-level document URL for that instance.
   * @returns cleanup that retires this instance without consulting its BrowserWindow.
   */
  set(role: RendererRole, webContents: WebContents, expectedURL: string): () => void {
    const normalized = new URL(expectedURL)
    this.renderers.set(role, {
      webContents,
      expectedURL: normalized.href,
      expectedOrigin: normalized.origin,
    })
    return () => { this.clear(role, webContents) }
  }

  /**
   * Remove a role only when it still points at the supplied WebContents.
   * @param role - application or splash role.
   * @param webContents - instance being retired.
   */
  clear(role: RendererRole, webContents: WebContents): void {
    if (this.renderers.get(role)?.webContents === webContents) this.renderers.delete(role)
  }

  /**
   * Check WebContents identity, top-frame identity, and the fixed URL/origin.
   * @param event - inbound Electron IPC event.
   * @param role - role required by the fixed channel.
   * @returns true only for the currently registered role document.
   */
  isAuthorized(event: RendererEvent, role: RendererRole): boolean {
    const registered = this.renderers.get(role)
    if (registered === undefined || event.sender !== registered.webContents) return false
    const frame = event.senderFrame
    if (frame === null || frame !== registered.webContents.mainFrame) return false
    try {
      const actual = new URL(frame.url)
      return actual.origin === registered.expectedOrigin && actual.href === registered.expectedURL
    } catch {
      return false
    }
  }
}

/**
 * Deny every renderer-requested document redirect/navigation and child window.
 * Main-process `loadURL`, `loadFile`, and `reload` calls do not emit
 * `will-navigate`, so lifecycle-owned loads remain available.
 * @param contents - WebContents to lock to its main-process-owned document.
 */
export function denyRendererNavigation(contents: WebContents): void {
  contents.on('will-navigate', (event) => { event.preventDefault() })
  contents.on('will-redirect', (event) => { event.preventDefault() })
  contents.setWindowOpenHandler(() => ({ action: 'deny' }))
}
