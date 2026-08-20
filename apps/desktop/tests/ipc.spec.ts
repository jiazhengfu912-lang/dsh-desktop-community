import { describe, expect, it } from 'vitest'
import { parseFetchRequest } from '../src/shared/ipc.ts'
import { collectHeaders } from '../src/renderer/ipc-fetch.ts'

describe('parseFetchRequest (IPC input validation)', () => {
  it('accepts a valid fetch request', () => {
    expect(parseFetchRequest({
      requestId: 3,
      method: 'POST',
      path: '/api/session.list',
      headers: [['content-type', 'application/json']],
      body: '{"rpcId":"r1"}',
    })).toEqual({
      requestId: 3,
      method: 'POST',
      path: '/api/session.list',
      headers: [['content-type', 'application/json']],
      body: '{"rpcId":"r1"}',
    })
  })

  it('rejects a non-object payload', () => {
    expect(parseFetchRequest(null)).toBeNull()
    expect(parseFetchRequest('x')).toBeNull()
    expect(parseFetchRequest(42)).toBeNull()
  })

  it('rejects a lowercase or empty method', () => {
    expect(parseFetchRequest({ requestId: 1, method: 'post', path: '/api', headers: [], body: '' })).toBeNull()
    expect(parseFetchRequest({ requestId: 1, method: '', path: '/api', headers: [], body: '' })).toBeNull()
  })

  it('rejects a path without a leading slash', () => {
    expect(parseFetchRequest({ requestId: 1, method: 'GET', path: 'api/x', headers: [], body: '' })).toBeNull()
  })

  it('rejects a non-integer or negative requestId', () => {
    expect(parseFetchRequest({ requestId: 1.5, method: 'GET', path: '/api', headers: [], body: '' })).toBeNull()
    expect(parseFetchRequest({ requestId: -1, method: 'GET', path: '/api', headers: [], body: '' })).toBeNull()
  })

  it('rejects malformed headers', () => {
    expect(parseFetchRequest({ requestId: 1, method: 'GET', path: '/api', headers: 'x', body: '' })).toBeNull()
    expect(parseFetchRequest({ requestId: 1, method: 'GET', path: '/api', headers: [['x', 'y', 'z']], body: '' })).toBeNull()
    expect(parseFetchRequest({ requestId: 1, method: 'GET', path: '/api', headers: [[1, 2]], body: '' })).toBeNull()
  })
})

describe('collectHeaders (request header serialization)', () => {
  it('normalizes Headers, tuple-array, and plain-object shapes', () => {
    expect(collectHeaders({ headers: new Headers([['a', '1'], ['b', '2']]) })).toEqual([['a', '1'], ['b', '2']])
    expect(collectHeaders({ headers: [['a', '1']] })).toEqual([['a', '1']])
    expect(collectHeaders({ headers: { a: '1', b: '2' } })).toEqual([['a', '1'], ['b', '2']])
  })

  it('returns an empty list when headers are absent', () => {
    expect(collectHeaders(undefined)).toEqual([])
    expect(collectHeaders({})).toEqual([])
    expect(collectHeaders({ method: 'GET' })).toEqual([])
  })
})
