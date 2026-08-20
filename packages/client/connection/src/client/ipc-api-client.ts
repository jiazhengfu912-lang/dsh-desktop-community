import { AbstractApiClient } from './api.ts'
import { desktopIpcFetch } from './desktop-bridge.ts'

/**
 * Desktop IPC carrier for core API unary/respond operations and SSE streams.
 * Generated Remote calls remain on the loopback HTTP route and do not use this
 * client.
 */
export class IpcApiClient extends AbstractApiClient {
  protected doFetch(input: URL, init?: RequestInit): Promise<Response> {
    const bridge = desktopIpcFetch()
    if (bridge === undefined) throw new Error('desktop IPC fetch bridge is not installed')
    return bridge(input, init)
  }
}
