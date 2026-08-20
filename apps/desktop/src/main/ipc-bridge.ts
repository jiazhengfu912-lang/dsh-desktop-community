/**
 * Typed IPC bridge: the main-process side of the desktop fetch carrier. It
 * validates every inbound message against the fixed channel/type contract and
 * forwards each fetch to the host's isomorphic fetch handler, streaming the
 * response body back as fixed-size events. The preload never exposes a generic
 * ipcRenderer — only the operations backed by these handlers.
 * @module @deepseek-ai/dsh-desktop/ipc-bridge
 */

import { ipcMain, shell, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron'
import { readFileSync } from 'node:fs'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { IPC_CHANNELS, parseFetchRequest } from '../shared/ipc.ts'
import type { DesktopHostHandle } from './host-boot.ts'
import { INBOUND_IPC_ROLES, type InboundIpcChannel, type RendererAuthority } from './renderer-security.ts'

const INTERNAL_BASE = 'http://dsh.internal'

type HostState =
  | { kind: 'ready'; host: DesktopHostHandle }
  | { kind: 'failed'; error: Error }
  | { kind: 'pending' }

function isAborted(signal: AbortSignal): boolean {
  return signal.aborted
}

/** The fixed main-process side of the desktop transport. */
export class IpcBridge {
  private logPathValue = ''
  private storagePathValue = ''
  private storageCache: Record<string, string> | undefined
  private host: DesktopHostHandle | undefined
  private hostError: Error | undefined
  private appReadyMsValue = 0
  private readonly waiters: (() => void)[] = []
  private readonly controllers = new Map<number, AbortController>()

  /**
   * @param rendererAuthority - current main/splash WebContents and URL registry.
   */
  constructor(private readonly rendererAuthority: RendererAuthority) {}

  /** Record when the app became ready, the renderer's splash timing origin. */
  setAppReadyMs(ms: number): void {
    this.appReadyMsValue = ms
  }

  /** Set the IPC-backed renderer storage file path (stable across random ports). */
  setStoragePath(path: string): void {
    this.storagePathValue = path
  }

  private loadStorage(): Record<string, string> {
    if (this.storageCache !== undefined) return this.storageCache
    let cache: Record<string, string> = {}
    try {
      const parsed = JSON.parse(readFileSync(this.storagePathValue, 'utf8')) as unknown
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        cache = parsed as Record<string, string>
      }
    } catch {
      // Absent or corrupt storage: start empty, like a fresh localStorage origin.
    }
    this.storageCache = cache
    return cache
  }

  private persistStorage(): void {
    if (this.storagePathValue === '' || this.storageCache === undefined) return
    void writeFileAtomic(this.storagePathValue, JSON.stringify(this.storageCache), { mode: 0o600 })
      .catch(() => { /* storage persistence is best-effort, like localStorage */ })
  }

  private onStorageSet(name: unknown, value: unknown): void {
    if (typeof name !== 'string' || name.length === 0 || name.length > 512) return
    if (typeof value !== 'string') return
    this.loadStorage()[name] = value
    this.persistStorage()
  }

  private onStorageRemove(name: unknown): void {
    if (typeof name !== 'string') return
    Reflect.deleteProperty(this.loadStorage(), name)
    this.persistStorage()
  }

  /** Publish the settled host handle (and wake any pending fetches). */
  setHost(host: DesktopHostHandle): void {
    this.host = host
    this.flushWaiters()
  }

  /** Publish a host boot failure (and wake any pending fetches). */
  setHostError(error: Error): void {
    this.hostError = error
    this.flushWaiters()
  }

  /** Clear any prior host/hostError state before a fresh boot attempt. */
  reset(): void {
    this.host = undefined
    this.hostError = undefined
  }

  /** Set the log file path (resolved by the main process before registration). */
  setLogPath(path: string): void {
    this.logPathValue = path
  }

  private flushWaiters(): void {
    const waiters = [...this.waiters]
    this.waiters.length = 0
    for (const waiter of waiters) waiter()
  }

  private readHostState(): HostState {
    if (this.host !== undefined) return { kind: 'ready', host: this.host }
    if (this.hostError !== undefined) return { kind: 'failed', error: this.hostError }
    return { kind: 'pending' }
  }

  private async awaitHost(): Promise<DesktopHostHandle> {
    const initial = this.readHostState()
    if (initial.kind === 'ready') return initial.host
    if (initial.kind === 'failed') throw initial.error
    await new Promise<void>((resolve) => { this.waiters.push(resolve) })
    const settled = this.readHostState()
    if (settled.kind === 'ready') return settled.host
    if (settled.kind === 'failed') throw settled.error
    throw new Error('desktop host unavailable')
  }

  /** Register every fixed channel handler exactly once. */
  register(): void {
    ipcMain.on(IPC_CHANNELS.fetchRequest, (event, payload) => { void this.onFetchRequest(event, payload) })
    ipcMain.on(IPC_CHANNELS.fetchAbort, (event, requestId: unknown) => {
      if (!this.isAuthorized(event, IPC_CHANNELS.fetchAbort)) return
      if (typeof requestId !== 'number') return
      this.controllers.get(requestId)?.abort()
    })
    ipcMain.handle(IPC_CHANNELS.bundleRead, (event, id: unknown) => {
      this.assertAuthorized(event, IPC_CHANNELS.bundleRead)
      return this.onReadBundle(id)
    })
    ipcMain.handle(IPC_CHANNELS.bootGraphGet, (event) => {
      this.assertAuthorized(event, IPC_CHANNELS.bootGraphGet)
      return this.onGetBootGraph()
    })
    ipcMain.handle(IPC_CHANNELS.startupInfo, (event) => {
      this.assertAuthorized(event, IPC_CHANNELS.startupInfo)
      return { appReadyMs: this.appReadyMsValue }
    })
    ipcMain.on(IPC_CHANNELS.storageLoad, (event) => {
      event.returnValue = this.isAuthorized(event, IPC_CHANNELS.storageLoad) ? this.loadStorage() : null
    })
    ipcMain.handle(IPC_CHANNELS.storageSet, (event, name: unknown, value: unknown) => {
      this.assertAuthorized(event, IPC_CHANNELS.storageSet)
      this.onStorageSet(name, value)
    })
    ipcMain.handle(IPC_CHANNELS.storageRemove, (event, name: unknown) => {
      this.assertAuthorized(event, IPC_CHANNELS.storageRemove)
      this.onStorageRemove(name)
    })
    ipcMain.handle(IPC_CHANNELS.logOpen, (event) => {
      this.assertAuthorized(event, IPC_CHANNELS.logOpen)
      void shell.openPath(this.logPathValue)
    })
  }

  private isAuthorized(
    event: IpcMainEvent | IpcMainInvokeEvent,
    channel: InboundIpcChannel,
  ): boolean {
    return this.rendererAuthority.isAuthorized(event, INBOUND_IPC_ROLES[channel])
  }

  private assertAuthorized(
    event: IpcMainEvent | IpcMainInvokeEvent,
    channel: InboundIpcChannel,
  ): void {
    if (!this.isAuthorized(event, channel)) throw new Error('unauthorized desktop IPC sender')
  }

  private async onGetBootGraph(): Promise<unknown> {
    const host = await this.awaitHost()
    return host.graph()
  }

  private async onReadBundle(id: unknown): Promise<string> {
    if (typeof id !== 'string' || id.length === 0 || id.length > 512) {
      throw new Error('invalid bundle id')
    }
    const host = await this.awaitHost()
    const clientPath = host.clientPath(id)
    if (clientPath === undefined) throw new Error(`unknown client bundle: ${id}`)
    const { readFile } = await import('node:fs/promises')
    return readFile(clientPath, 'utf8')
  }

  private async onFetchRequest(event: IpcMainEvent, payload: unknown): Promise<void> {
    if (!this.isAuthorized(event, IPC_CHANNELS.fetchRequest)) return
    const parsed = parseFetchRequest(payload)
    if (parsed === null) {
      this.sendError(event, 0, 'invalid fetch request')
      return
    }
    const requestId = parsed.requestId
    const controller = new AbortController()
    this.controllers.set(requestId, controller)

    let host: DesktopHostHandle
    try {
      host = await this.awaitHost()
    } catch (error) {
      this.sendError(event, requestId, error instanceof Error ? error.message : String(error))
      return
    }
    if (controller.signal.aborted) return

    try {
      const url = INTERNAL_BASE + parsed.path
      const init: RequestInit = {
        method: parsed.method,
        headers: parsed.headers,
        signal: controller.signal,
      }
      if (parsed.method !== 'GET' && parsed.method !== 'HEAD') init.body = parsed.body
      const response = await host.fetch(new Request(url, init))

      event.sender.send(IPC_CHANNELS.fetchResponse, {
        requestId,
        kind: 'response',
        status: response.status,
        statusText: response.statusText,
        headers: [...response.headers.entries()],
      })

      if (response.body === null) {
        event.sender.send(IPC_CHANNELS.fetchEnd, { requestId, kind: 'end' })
        return
      }
      const reader = response.body.getReader()
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        event.sender.send(IPC_CHANNELS.fetchData, { requestId, kind: 'data', chunk: value })
      }
      event.sender.send(IPC_CHANNELS.fetchEnd, { requestId, kind: 'end' })
    } catch (error) {
      if (isAborted(controller.signal)) {
        event.sender.send(IPC_CHANNELS.fetchEnd, { requestId, kind: 'end' })
        return
      }
      this.sendError(event, requestId, error instanceof Error ? error.message : String(error))
    } finally {
      this.controllers.delete(requestId)
    }
  }

  private sendError(event: IpcMainEvent, requestId: number, message: string): void {
    event.sender.send(IPC_CHANNELS.fetchError, { requestId, kind: 'error', message })
  }
}
