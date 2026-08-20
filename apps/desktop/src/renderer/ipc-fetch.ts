/**
 * Streaming fetch over the desktop IPC bridge. The renderer installs this as
 * `globalThis.__DSH_IPC_FETCH__` before booting the shell; the connection
 * plugin's IPC carrier (IpcApiClient) drives it. It returns a real `Response`
 * whose body is a `ReadableStream` fed by the main process's chunked events,
 * so both unary and SSE streams share one path. Generated Remote routes use
 * the window's loopback HTTP origin instead.
 * @module @deepseek-ai/dsh-desktop/ipc-fetch
 */

import type { DesktopBridge } from '../shared/ipc.ts'

/**
 * Extract headers from any `RequestInit` representation.
 * @param init - optional fetch initialization.
 * @returns flat header tuples for the IPC request.
 */
export function collectHeaders(init: RequestInit | undefined): [string, string][] {
  if (init?.headers === undefined) return []
  if (init.headers instanceof Headers) {
    const out: [string, string][] = []
    init.headers.forEach((value, key) => { out.push([key, value]) })
    return out
  }
  if (Array.isArray(init.headers)) {
    return init.headers.map(([key, value]): [string, string] => [key, value])
  }
  return Object.entries(init.headers)
}

/**
 * Install the renderer IPC fetch implementation.
 * @param bridge - restricted preload bridge exposed to the renderer.
 * @returns fetch-compatible function backed by chunked IPC events.
 */
export function installIpcFetch(bridge: DesktopBridge): (input: URL, init?: RequestInit) => Promise<Response> {
  const fetchImpl = (input: URL, init?: RequestInit): Promise<Response> => {
    const path = input.pathname + input.search
    const method = (init?.method ?? 'GET').toUpperCase()
    const headers = collectHeaders(init)
    const body = typeof init?.body === 'string' ? init.body : ''

    return new Promise<Response>((resolve, reject) => {
      let requestId = 0
      let controller: ReadableStreamDefaultController<Uint8Array> | undefined
      const buffered: Uint8Array[] = []
      let ended = false
      let failure: Error | undefined
      let resolved = false

      const bodyStream = new ReadableStream<Uint8Array>({
        start(c) {
          controller = c
          for (const chunk of buffered) c.enqueue(chunk)
          buffered.length = 0
          if (failure !== undefined) c.error(failure)
          else if (ended) c.close()
        },
        cancel() {
          bridge.abortFetch(requestId)
        },
      })

      const unsubscribe = bridge.onFetchEvent((event) => {
        if (event.requestId !== requestId) return
        if (event.kind === 'response') {
          resolved = true
          resolve(new Response(bodyStream, {
            status: event.status,
            statusText: event.statusText,
            headers: event.headers,
          }))
        } else if (event.kind === 'data') {
          if (controller !== undefined) controller.enqueue(event.chunk)
          else buffered.push(event.chunk)
        } else if (event.kind === 'end') {
          ended = true
          if (controller !== undefined) controller.close()
          unsubscribe()
        } else {
          failure = new Error(event.message)
          if (controller !== undefined) controller.error(failure)
          else if (!resolved) reject(failure)
          unsubscribe()
        }
      })

      requestId = bridge.startFetch({ method, path, headers, body })

      const signal = init?.signal
      if (signal !== undefined && signal !== null) {
        const onAbort = (): void => { bridge.abortFetch(requestId) }
        if (signal.aborted) onAbort()
        else signal.addEventListener('abort', onAbort, { once: true })
      }
    })
  }

  const globalWithFetch = globalThis as { __DSH_IPC_FETCH__?: (input: URL, init?: RequestInit) => Promise<Response> }
  globalWithFetch.__DSH_IPC_FETCH__ = fetchImpl
  return fetchImpl
}
