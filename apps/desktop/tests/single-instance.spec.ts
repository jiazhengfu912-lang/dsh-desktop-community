import { describe, expect, it, vi } from 'vitest'
import type { App } from 'electron'
import { acquireSingleInstance, SecondInstanceFocus, type FocusTarget } from '../src/main/single-instance.ts'

interface TargetFixture {
  readonly target: FocusTarget
  readonly restore: ReturnType<typeof vi.fn>
  readonly show: ReturnType<typeof vi.fn>
  readonly focus: ReturnType<typeof vi.fn>
}

function targetFixture(options: { destroyed?: boolean; minimized?: boolean; visible?: boolean } = {}): TargetFixture {
  let minimized = options.minimized ?? false
  let visible = options.visible ?? true
  const restore = vi.fn(() => {
    minimized = false
    visible = true
  })
  const show = vi.fn(() => { visible = true })
  const focus = vi.fn()
  return {
    target: {
      isDestroyed: () => options.destroyed ?? false,
      isMinimized: () => minimized,
      isVisible: () => visible,
      restore,
      show,
      focus,
    },
    restore,
    show,
    focus,
  }
}

function appFixture(lockGranted: boolean): {
  readonly app: App
  readonly requestLock: ReturnType<typeof vi.fn>
  readonly quit: ReturnType<typeof vi.fn>
  secondInstance(): void
} {
  let secondInstance: (() => void) | undefined
  const requestLock = vi.fn(() => lockGranted)
  const quit = vi.fn()
  return {
    app: {
      requestSingleInstanceLock: requestLock,
      quit,
      on: vi.fn((name: string, listener: () => void) => {
        if (name === 'second-instance') secondInstance = listener
      }),
    } as unknown as App,
    requestLock,
    quit,
    secondInstance: () => { secondInstance?.() },
  }
}

describe('SecondInstanceFocus', () => {
  it('retains a second-instance request that arrives before a window is ready', () => {
    const handoff = new SecondInstanceFocus()
    const fixture = targetFixture()
    const electron = appFixture(true)

    expect(acquireSingleInstance(electron.app, handoff)).toBe(true)
    electron.secondInstance()
    expect(fixture.focus).not.toHaveBeenCalled()
    handoff.setTarget(fixture.target)

    expect(fixture.focus).toHaveBeenCalledOnce()
  })

  it('focuses the current window immediately after it is ready', () => {
    const handoff = new SecondInstanceFocus()
    const fixture = targetFixture({ minimized: true, visible: false })
    const electron = appFixture(true)
    expect(acquireSingleInstance(electron.app, handoff)).toBe(true)
    handoff.setTarget(fixture.target)

    electron.secondInstance()

    expect(fixture.restore).toHaveBeenCalledOnce()
    expect(fixture.show).not.toHaveBeenCalled()
    expect(fixture.focus).toHaveBeenCalledOnce()
  })

  it('quits immediately when Electron denies the atomic instance lock', () => {
    const handoff = new SecondInstanceFocus()
    const electron = appFixture(false)

    expect(acquireSingleInstance(electron.app, handoff)).toBe(false)
    expect(electron.requestLock).toHaveBeenCalledOnce()
    expect(electron.quit).toHaveBeenCalledOnce()
  })

  it('retains a request when the published target has already been destroyed', () => {
    const handoff = new SecondInstanceFocus()
    const stale = targetFixture({ destroyed: true })
    const current = targetFixture()
    handoff.setTarget(stale.target)

    handoff.request()
    handoff.setTarget(current.target)

    expect(stale.focus).not.toHaveBeenCalled()
    expect(current.focus).toHaveBeenCalledOnce()
  })
})
