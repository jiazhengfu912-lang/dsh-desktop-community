import { EventEmitter } from 'node:events'
import type { ChildProcessWithoutNullStreams } from 'node:child_process'
import { PassThrough } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mergeProcessEnvironment, runStartupSmokeProcess } from '../build/startup-smoke-process.mjs'

function fakeChild(pid = 4321): {
  child: ChildProcessWithoutNullStreams
  events: EventEmitter
  kill: ReturnType<typeof vi.fn>
} {
  const events = new EventEmitter()
  const kill = vi.fn(() => true)
  Object.assign(events, {
    pid,
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    stdio: [],
    kill,
  })
  return { child: events as unknown as ChildProcessWithoutNullStreams, events, kill }
}

afterEach(() => { vi.useRealTimers() })

describe('packaged startup smoke process timeout', () => {
  it('replaces ambient Windows environment aliases case-insensitively', () => {
    expect(mergeProcessEnvironment(
      { NPM_CONFIG_STORE_DIR: 'C:\\global-store', Path: 'C:\\ambient-bin' },
      { npm_config_store_dir: 'C:\\private-store', PATH: 'C:\\Windows\\System32' },
      'win32',
    )).toEqual({
      npm_config_store_dir: 'C:\\private-store',
      PATH: 'C:\\Windows\\System32',
    })
  })

  it('uses System32 taskkill for the Windows tree and waits for child close', async () => {
    vi.useFakeTimers()
    const { child, events, kill } = fakeChild()
    const runTaskkill = vi.fn(() => ({ status: 0 }))
    let settled = false
    const running = runStartupSmokeProcess({
      executable: 'C:\\release\\DSH Desktop Community.exe',
      args: ['--smoke-test'],
      env: {},
      timeoutMs: 100,
      maxOutputBytes: 1024,
      platform: 'win32',
      systemRoot: 'C:\\Windows',
      spawnProcess: () => child,
      runTaskkill,
    }).finally(() => { settled = true })

    await vi.advanceTimersByTimeAsync(100)
    expect(runTaskkill).toHaveBeenCalledWith(
      'C:\\Windows\\System32\\taskkill.exe',
      ['/PID', '4321', '/T', '/F'],
      { stdio: 'ignore', timeout: 5_000, windowsHide: true },
    )
    expect(kill).not.toHaveBeenCalled()
    expect(settled).toBe(false)

    events.emit('close', null, 'SIGKILL')
    await expect(running).resolves.toMatchObject({ status: null, signal: 'SIGKILL', timedOut: true })
    expect(settled).toBe(true)
  })

  it('keeps the non-Windows TERM-to-KILL fallback', async () => {
    vi.useFakeTimers()
    const { child, events, kill } = fakeChild()
    const running = runStartupSmokeProcess({
      executable: '/opt/dsh/desktop',
      args: ['--smoke-test'],
      env: {},
      timeoutMs: 100,
      forceKillGraceMs: 25,
      maxOutputBytes: 1024,
      platform: 'linux',
      spawnProcess: () => child,
    })

    await vi.advanceTimersByTimeAsync(100)
    expect(kill).toHaveBeenNthCalledWith(1, undefined)
    await vi.advanceTimersByTimeAsync(25)
    expect(kill).toHaveBeenNthCalledWith(2, 'SIGKILL')
    events.emit('close', null, 'SIGKILL')
    await expect(running).resolves.toMatchObject({ timedOut: true })
  })

  it('does not arm a fallback timer after a synchronous timeout close', async () => {
    vi.useFakeTimers()
    const { child, events } = fakeChild()
    const running = runStartupSmokeProcess({
      executable: 'C:\\release\\DSH Desktop Community.exe',
      args: ['--smoke-test'],
      env: {},
      timeoutMs: 100,
      maxOutputBytes: 1024,
      platform: 'win32',
      systemRoot: 'C:\\Windows',
      spawnProcess: () => child,
      runTaskkill: () => {
        events.emit('close', null, 'SIGKILL')
        return { status: 0 }
      },
    })

    await vi.advanceTimersByTimeAsync(100)
    await expect(running).resolves.toMatchObject({ timedOut: true })
    expect(vi.getTimerCount()).toBe(0)
  })

  it('records a child error but settles only once after close', async () => {
    const { child, events } = fakeChild()
    const failure = new Error('spawn failed')
    const settled = vi.fn()
    const running = runStartupSmokeProcess({
      executable: '/opt/dsh/desktop',
      args: ['--smoke-test'],
      env: {},
      timeoutMs: 1_000,
      maxOutputBytes: 1024,
      platform: 'linux',
      spawnProcess: () => child,
    })
    void running.then(settled, settled)

    events.emit('error', failure)
    await Promise.resolve()
    expect(settled).not.toHaveBeenCalled()
    events.emit('close', null, null)
    await expect(running).rejects.toBe(failure)
    events.emit('close', 0, null)
    expect(settled).toHaveBeenCalledOnce()
  })
})
