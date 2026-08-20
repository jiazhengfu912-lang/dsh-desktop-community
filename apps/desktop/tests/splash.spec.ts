// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mountSplash, wireSplashActions, type SplashController } from '../src/renderer/splash-view.ts'

const MARK = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 50 50"><path d="M5 5 25 25 5 45"/></svg>'

function setMediaPreferences(reduced: boolean): void {
  window.matchMedia = (query: string): MediaQueryList => ({
    matches: reduced && query.includes('reduce'),
    media: query,
    onchange: null,
    // oxlint-disable-next-line typescript/no-deprecated -- required by the MediaQueryList compatibility interface.
    addListener: () => {},
    // oxlint-disable-next-line typescript/no-deprecated -- required by the MediaQueryList compatibility interface.
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })
}

beforeEach(() => {
  setMediaPreferences(true)
})

afterEach(() => { vi.restoreAllMocks() })

function mount(): { container: HTMLElement; splash: SplashController } {
  const container = document.createElement('div')
  document.body.appendChild(container)
  const splash = mountSplash(container, MARK)
  return { container, splash }
}

describe('desktop splash', () => {
  it('renders the community mark, label, and Host progress', () => {
    const { container } = mount()
    expect(container.querySelector('.dsh-splash-mark svg')).not.toBeNull()
    expect(container.querySelector('.dsh-splash-label')?.textContent).toBe('DSH Desktop Community')
    expect(container.querySelector('.dsh-splash-loading')?.textContent).toBe('Starting local DSH Host…')
    expect(container.classList.contains('dsh-splash--reduced-motion')).toBe(true)
  })

  it('does not require a renderer animation frame loop', () => {
    setMediaPreferences(false)
    const requestFrame = vi.spyOn(window, 'requestAnimationFrame')
    mount()
    expect(requestFrame).not.toHaveBeenCalled()
  })

  it('routes error actions through the desktop bridge callbacks', () => {
    const calls: string[] = []
    wireSplashActions(
      () => { calls.push('retry') },
      () => { calls.push('log') },
      () => { calls.push('quit') },
    )
    const { container, splash } = mount()
    splash.showError('something exploded')
    const panel = container.querySelector('.dsh-splash-error-panel')
    expect(panel).not.toBeNull()
    expect(panel?.querySelector('.dsh-splash-error-title')?.textContent).toContain('failed to start')
    expect(panel?.querySelector('.dsh-splash-error-detail')?.textContent).toContain('something exploded')
    const buttons = [...(panel?.querySelectorAll('button') ?? [])].map(b => b.textContent)
    expect(buttons).toEqual(['Retry', 'Open Log', 'Exit'])
    for (const button of panel?.querySelectorAll('button') ?? []) button.click()
    expect(calls).toEqual(['retry', 'log', 'quit'])
  })

  it('fades out and removes the splash', async () => {
    const { container, splash } = mount()
    await splash.fadeOut()
    expect(document.body.contains(container)).toBe(false)
  })

  it('dispose stops without throwing', () => {
    const { splash } = mount()
    expect(() => { splash.dispose() }).not.toThrow()
  })
})
