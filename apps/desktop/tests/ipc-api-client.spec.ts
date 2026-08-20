import { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DesktopIpcFetch } from '../../../packages/client/connection/src/client/desktop-bridge.ts'
import { desktopIpcFetch } from '../../../packages/client/connection/src/client/desktop-bridge.ts'
import { IpcApiClient } from '../../../packages/client/connection/src/client/ipc-api-client.ts'
import { apply as applyConnection, type ConnectionHandle } from '../../../packages/client/connection/src/client/index.ts'

function setBridge(fetch: DesktopIpcFetch): void {
  ;(globalThis as { __DSH_IPC_FETCH__?: DesktopIpcFetch }).__DSH_IPC_FETCH__ = fetch
}

afterEach(() => {
  delete (globalThis as { __DSH_IPC_FETCH__?: DesktopIpcFetch }).__DSH_IPC_FETCH__
})

describe('desktop IPC carrier selection', () => {
  it('detects no bridge before install and the bridge after install', () => {
    expect(desktopIpcFetch()).toBeUndefined()
    const fake: DesktopIpcFetch = async () => new Response('{}', { status: 200 })
    setBridge(fake)
    expect(desktopIpcFetch()).toBe(fake)
  })

  it('throws when the carrier is used without a bridge', async () => {
    const client = new IpcApiClient()
    await expect(client.host.describe({})).rejects.toThrow(/bridge is not installed/)
  })

  it('keeps generic Remote RPC on loopback HTTP while core API calls use IPC', async () => {
    const ipcFetch = vi.fn(async () => new Response('not found', { status: 404 }))
    setBridge(ipcFetch)
    ;(globalThis as { location?: { hostname: string; origin: string; search: string } }).location = {
      hostname: '127.0.0.1',
      origin: 'http://127.0.0.1:43123',
      search: '',
    }
    const originalFetch = globalThis.fetch
    const httpFetch = vi.fn(async (_input: URL | RequestInfo, init?: RequestInit) => {
      const request = JSON.parse(typeof init?.body === 'string' ? init.body : '') as { rpcId: string }
      return Response.json({
        type: 'server-response',
        rpcId: request.rpcId,
        result: { ok: true, value: { entries: [] } },
      })
    })
    globalThis.fetch = httpFetch
    const ctx = new Context()
    try {
      await ctx.plugin({ apply: applyConnection, inject: [] })
      const connection = ctx.get('connection') as ConnectionHandle | undefined
      if (connection === undefined) throw new Error('connection service missing')
      await expect(connection.rpc.call('/api', 'pluginInventory/list', { args: {} }))
        .resolves.toEqual({ ok: true, value: { entries: [] } })
      expect(httpFetch).toHaveBeenCalledOnce()
      expect(ipcFetch).not.toHaveBeenCalled()
    } finally {
      await ctx.fiber.dispose()
      globalThis.fetch = originalFetch
      delete (globalThis as { location?: unknown }).location
    }
  })
})

describe('IpcApiClient unary transport', () => {
  it('sends a POST through the installed bridge and parses the response', async () => {
    let captured: { method?: string; path?: string; body?: string } = {}
    setBridge(async (input, init) => {
      captured = { method: init?.method, path: input.pathname, body: typeof init?.body === 'string' ? init.body : undefined }
      const request = JSON.parse(captured.body ?? '{}') as { rpcId?: unknown }
      if (typeof request.rpcId !== 'string') throw new Error('missing rpcId')
      const rpcId = request.rpcId
      const body = JSON.stringify({
        type: 'server-response',
        rpcId,
        result: { ok: true, value: { version: '0.0.1', cwd: '/w', home: '/home/test', provider: 'deepseek-official', model: 'deepseek-v4-flash', attachedSessions: 0, canOpenPath: false } },
      })
      return new Response(body, { status: 200, headers: { 'content-type': 'application/json' } })
    })

    const client = new IpcApiClient()
    const response = await client.host.describe({})
    expect(response.result.ok).toBe(true)
    expect(captured.method).toBe('POST')
    expect(captured.path).toBe('/api/host.describe')
    expect(captured.body).toContain('"method":"host.describe"')
  })
})

describe('IpcApiClient mux/host event streams', () => {
  function streamResponse(frames: unknown[]): Response {
    const payload = frames.map(f => `data: ${JSON.stringify(f)}\n\n`).join('')
    return new Response(payload, { status: 200, headers: { 'content-type': 'text/event-stream' } })
  }

  it('establishes a mux stream, yields frames, and fires onOpen', async () => {
    const frame = {
      type: 'server-request',
      rpcId: 'm1',
      method: 'stream/error',
      payload: { type: 'stream/error', error: { code: 'internal', message: 'boom', details: {} } },
    }
    let opened = false
    let path: string | undefined
    setBridge(async (input) => {
      path = input.pathname
      return streamResponse([frame])
    })

    const client = new IpcApiClient()
    const envelopes: unknown[] = []
    for await (const envelope of client.events.mux({}, new AbortController().signal, () => { opened = true })) {
      envelopes.push(envelope)
    }
    expect(path).toBe('/api/events.mux')
    expect(opened).toBe(true)
    expect(envelopes).toHaveLength(1)
    expect((envelopes[0] as { payload: { type: string } }).payload.type).toBe('stream/error')
  })

  it('passes the caller signal so abort propagates to the host', async () => {
    let receivedSignal: AbortSignal | null | undefined
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(': connected\n\n'))
        controller.close()
      },
    })
    setBridge(async (_input, init) => {
      receivedSignal = init?.signal
      return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } })
    })

    const client = new IpcApiClient()
    const controller = new AbortController()
    // A comment-only SSE body yields zero frames; iteration completes.
    for await (const _envelope of client.events.host({}, controller.signal)) {
      // no frames expected
    }
    expect(receivedSignal).toBe(controller.signal)
  })
})
