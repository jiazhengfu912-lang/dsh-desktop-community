/**
 * Restricted preload bridge. Runs in a sandboxed, context-isolated renderer:
 * it exposes ONLY the typed desktop operations below — never a generic
 * ipcRenderer, and never Node/fs/child_process access.
 * @module @deepseek-ai/dsh-desktop/preload
 */

import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IPC_CHANNELS, type DesktopBridge, type FetchEvent, type FetchRequest, type StartupInfo, type StorageLike } from '../shared/ipc.ts'

let requestSeq = 0

const bridge: DesktopBridge = {
  platform: 'desktop',

  startFetch(request) {
    const requestId = ++requestSeq
    const full: FetchRequest = { requestId, ...request }
    ipcRenderer.send(IPC_CHANNELS.fetchRequest, full)
    return requestId
  },

  abortFetch(requestId) {
    if (typeof requestId !== 'number') return
    ipcRenderer.send(IPC_CHANNELS.fetchAbort, requestId)
  },

  onFetchEvent(cb) {
    const handler = (_event: IpcRendererEvent, payload: FetchEvent): void => { cb(payload) }
    ipcRenderer.on(IPC_CHANNELS.fetchResponse, handler)
    ipcRenderer.on(IPC_CHANNELS.fetchData, handler)
    ipcRenderer.on(IPC_CHANNELS.fetchEnd, handler)
    ipcRenderer.on(IPC_CHANNELS.fetchError, handler)
    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.fetchResponse, handler)
      ipcRenderer.removeListener(IPC_CHANNELS.fetchData, handler)
      ipcRenderer.removeListener(IPC_CHANNELS.fetchEnd, handler)
      ipcRenderer.removeListener(IPC_CHANNELS.fetchError, handler)
    }
  },

  readBundle(id) {
    return ipcRenderer.invoke(IPC_CHANNELS.bundleRead, id) as Promise<string>
  },

  getBootGraph() {
    return ipcRenderer.invoke(IPC_CHANNELS.bootGraphGet) as Promise<unknown>
  },

  getStartupInfo() {
    return ipcRenderer.invoke(IPC_CHANNELS.startupInfo) as Promise<StartupInfo>
  },

  rendererReady() {
    ipcRenderer.send(IPC_CHANNELS.rendererReady)
  },

  rendererFailed(message) {
    ipcRenderer.send(IPC_CHANNELS.rendererFailed, message)
  },

  openLog() {
    void ipcRenderer.invoke(IPC_CHANNELS.logOpen)
  },

  retry() {
    ipcRenderer.send(IPC_CHANNELS.retry)
  },

  quit() {
    ipcRenderer.send(IPC_CHANNELS.quit)
  },

  onHostError(cb) {
    const handler = (_event: IpcRendererEvent, message: string): void => { cb(message) }
    ipcRenderer.on(IPC_CHANNELS.hostError, handler)
    return () => { ipcRenderer.removeListener(IPC_CHANNELS.hostError, handler) }
  },
}

contextBridge.exposeInMainWorld('__DSH_BRIDGE__', bridge)

// IPC-backed renderer storage: the desktop's localStorage replacement, stable
// across the random loopback port each launch binds. The full map is loaded
// synchronously once; writes update the local cache and persist via IPC.
let storageCache: Record<string, string> | null = null
const ensureStorage = (): Record<string, string> => {
  if (storageCache === null) storageCache = ipcRenderer.sendSync(IPC_CHANNELS.storageLoad) as Record<string, string>
  return storageCache
}
const storage: StorageLike = {
  getItem(name) {
    return ensureStorage()[name] ?? null
  },
  setItem(name, value) {
    ensureStorage()[name] = value
    void ipcRenderer.invoke(IPC_CHANNELS.storageSet, name, value)
  },
  removeItem(name) {
    Reflect.deleteProperty(ensureStorage(), name)
    void ipcRenderer.invoke(IPC_CHANNELS.storageRemove, name)
  },
}
contextBridge.exposeInMainWorld('__DSH_STORAGE__', storage)
