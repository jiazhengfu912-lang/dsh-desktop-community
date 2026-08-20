/**
 * The desktop (Electron) renderer installs a streaming IPC fetch bridge on
 * `globalThis.__DSH_IPC_FETCH__` before booting the shell; the connection
 * plugin selects the IPC carrier when it is present (undefined in the browser).
 * The bridge carries the core API wire over IPC and resolves to a streaming
 * `Response`, so unary/respond and the SSE event streams share one transport.
 * Generated Remote routes remain on the window's loopback HTTP origin.
 */
export type DesktopIpcFetch = (input: URL, init?: RequestInit) => Promise<Response>

/**
 * Read the installed desktop IPC fetch bridge.
 * @returns installed bridge, or `undefined` outside the Electron renderer.
 */
export function desktopIpcFetch(): DesktopIpcFetch | undefined {
  return (globalThis as { __DSH_IPC_FETCH__?: DesktopIpcFetch }).__DSH_IPC_FETCH__
}
