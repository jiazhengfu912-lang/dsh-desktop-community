/**
 * Desktop IPC contract: fixed, private channels shared by the main process,
 * the sandboxed preload bridge, and the renderer. Every inbound message is
 * validated by the main process before use (see ipc-bridge.ts); the preload
 * never exposes a generic `ipcRenderer` — only these typed operations.
 */

/** Fixed IPC channel names (renderer⇄main). */
export const IPC_CHANNELS = {
  fetchRequest: 'dsh:fetch:request',
  fetchResponse: 'dsh:fetch:response',
  fetchData: 'dsh:fetch:data',
  fetchEnd: 'dsh:fetch:end',
  fetchError: 'dsh:fetch:error',
  fetchAbort: 'dsh:fetch:abort',
  bundleRead: 'dsh:bundle:read',
  bootGraphGet: 'dsh:boot:get',
  startupInfo: 'dsh:startup:info',
  storageLoad: 'dsh:storage:load',
  storageSet: 'dsh:storage:set',
  storageRemove: 'dsh:storage:remove',
  hostError: 'dsh:host:error',
  rendererReady: 'dsh:renderer:ready',
  rendererFailed: 'dsh:renderer:failed',
  logOpen: 'dsh:log:open',
  retry: 'dsh:retry',
  quit: 'dsh:quit',
} as const

/** One serialized fetch request the renderer sends to the host carrier. */
export interface FetchRequest {
  requestId: number
  method: string
  path: string
  headers: [string, string][]
  body: string
}

/** One fetch progress/result event the main process streams back. */
export type FetchEvent =
  | { requestId: number; kind: 'response'; status: number; statusText: string; headers: [string, string][] }
  | { requestId: number; kind: 'data'; chunk: Uint8Array }
  | { requestId: number; kind: 'end' }
  | { requestId: number; kind: 'error'; message: string }

/** Validate an inbound fetch request payload; returns null when malformed. */
export function parseFetchRequest(value: unknown): FetchRequest | null {
  if (typeof value !== 'object' || value === null) return null
  const v = value as Record<string, unknown>
  if (typeof v.requestId !== 'number' || !Number.isInteger(v.requestId) || v.requestId < 0) return null
  if (typeof v.method !== 'string' || !/^[A-Z]+$/.test(v.method)) return null
  if (typeof v.path !== 'string' || !v.path.startsWith('/')) return null
  if (typeof v.body !== 'string') return null
  if (!Array.isArray(v.headers)) return null
  const headers: [string, string][] = []
  for (const entry of v.headers) {
    if (!Array.isArray(entry) || entry.length !== 2
      || typeof entry[0] !== 'string' || typeof entry[1] !== 'string') return null
    headers.push([entry[0], entry[1]])
  }
  return { requestId: v.requestId, method: v.method, path: v.path, headers, body: v.body }
}

/** A localStorage-shaped key/value backend the client snapshot store uses. */
export interface StorageLike {
  getItem(name: string): string | null
  setItem(name: string, value: string): void
  removeItem(name: string): void
}

/** Process-start facts the renderer needs to time the splash from launch. */
export interface StartupInfo {
  /** Epoch-ms when the Electron app became ready (the splash timing origin). */
  appReadyMs: number
}

/** The typed bridge surface the preload exposes as `window.__DSH_BRIDGE__`. */
export interface DesktopBridge {
  readonly platform: 'desktop'
  startFetch(request: Omit<FetchRequest, 'requestId'>): number
  abortFetch(requestId: number): void
  onFetchEvent(cb: (event: FetchEvent) => void): () => void
  readBundle(id: string): Promise<string>
  getBootGraph(): Promise<unknown>
  getStartupInfo(): Promise<StartupInfo>
  rendererReady(): void
  rendererFailed(message: string): void
  openLog(): void
  retry(): void
  quit(): void
  onHostError(cb: (message: string) => void): () => void
}
