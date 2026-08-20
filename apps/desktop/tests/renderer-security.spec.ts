import { describe, expect, it, vi } from 'vitest'
import type { WebContents } from 'electron'
import { IPC_CHANNELS } from '../src/shared/ipc.ts'
import {
  denyRendererNavigation,
  INBOUND_IPC_ROLES,
  RendererAuthority,
} from '../src/main/renderer-security.ts'

interface FakeFrame {
  url: string
}

interface FakeContents {
  mainFrame: FakeFrame
}

function contents(url: string): FakeContents {
  return { mainFrame: { url } }
}

function event(sender: FakeContents, senderFrame: FakeFrame = sender.mainFrame): never {
  return { sender, senderFrame } as never
}

describe('RendererAuthority', () => {
  it('assigns every renderer-to-main fixed channel to one renderer role', () => {
    expect(INBOUND_IPC_ROLES).toEqual({
      [IPC_CHANNELS.fetchRequest]: 'main',
      [IPC_CHANNELS.fetchAbort]: 'main',
      [IPC_CHANNELS.bundleRead]: 'main',
      [IPC_CHANNELS.bootGraphGet]: 'main',
      [IPC_CHANNELS.startupInfo]: 'main',
      [IPC_CHANNELS.storageLoad]: 'main',
      [IPC_CHANNELS.storageSet]: 'main',
      [IPC_CHANNELS.storageRemove]: 'main',
      [IPC_CHANNELS.logOpen]: 'splash',
      [IPC_CHANNELS.rendererReady]: 'main',
      [IPC_CHANNELS.rendererFailed]: 'main',
      [IPC_CHANNELS.retry]: 'splash',
      [IPC_CHANNELS.quit]: 'splash',
    })
  })

  it('rejects a stale WebContents after the main role is replaced', () => {
    const authority = new RendererAuthority()
    const stale = contents('http://127.0.0.1:4100/')
    const current = contents('http://127.0.0.1:4200/')
    authority.set('main', stale as never, stale.mainFrame.url)
    authority.set('main', current as never, current.mainFrame.url)

    expect(authority.isAuthorized(event(stale), 'main')).toBe(false)
    expect(authority.isAuthorized(event(current), 'main')).toBe(true)
  })

  it('retires a renderer without reading its destroyed BrowserWindow again', () => {
    const authority = new RendererAuthority()
    const main = contents('http://127.0.0.1:4200/')
    let destroyed = false
    let reads = 0
    const window = {
      get webContents(): FakeContents {
        reads += 1
        if (destroyed) throw new TypeError('Object has been destroyed')
        return main
      },
    }

    const retire = authority.set('main', window.webContents as never, main.mainFrame.url)
    destroyed = true

    expect(() => { retire() }).not.toThrow()
    expect(reads).toBe(1)
    expect(authority.isAuthorized(event(main), 'main')).toBe(false)
  })

  it('rejects a subframe from the registered WebContents', () => {
    const authority = new RendererAuthority()
    const main = contents('http://127.0.0.1:4200/')
    authority.set('main', main as never, main.mainFrame.url)

    expect(authority.isAuthorized(event(main, { url: main.mainFrame.url }), 'main')).toBe(false)
  })

  it('rejects the registered main frame after its URL leaves the fixed origin', () => {
    const authority = new RendererAuthority()
    const main = contents('http://127.0.0.1:4200/')
    authority.set('main', main as never, main.mainFrame.url)
    main.mainFrame.url = 'https://external.invalid/'

    expect(authority.isAuthorized(event(main), 'main')).toBe(false)
  })

  it('rejects the registered main frame at another URL on the fixed origin', () => {
    const authority = new RendererAuthority()
    const main = contents('http://127.0.0.1:4200/')
    authority.set('main', main as never, main.mainFrame.url)
    main.mainFrame.url = 'http://127.0.0.1:4200/settings'

    expect(authority.isAuthorized(event(main), 'main')).toBe(false)
  })

  it('keeps main and splash identities in separate roles', () => {
    const authority = new RendererAuthority()
    const main = contents('http://127.0.0.1:4200/')
    const splash = contents('file:///C:/Program%20Files/DSH/resources/app/dist/renderer/splash.html')
    authority.set('main', main as never, main.mainFrame.url)
    authority.set('splash', splash as never, splash.mainFrame.url)

    expect(authority.isAuthorized(event(main), 'splash')).toBe(false)
    expect(authority.isAuthorized(event(splash), 'main')).toBe(false)
    expect(authority.isAuthorized(event(splash), 'splash')).toBe(true)
  })
})

describe('denyRendererNavigation', () => {
  it('denies renderer navigation, redirects, and window.open requests', () => {
    const listeners = new Map<string, (event: { preventDefault(): void }) => void>()
    let openHandler: ((details: { url: string }) => { action: string }) | undefined
    const fakeContents = {
      on: vi.fn((name: string, listener: (event: { preventDefault(): void }) => void) => {
        listeners.set(name, listener)
        return fakeContents
      }),
      setWindowOpenHandler: vi.fn((handler: (details: { url: string }) => { action: string }) => {
        openHandler = handler
      }),
    }
    denyRendererNavigation(fakeContents as unknown as WebContents)

    const navigationPrevented = vi.fn()
    listeners.get('will-navigate')?.({ preventDefault: navigationPrevented })
    expect(navigationPrevented).toHaveBeenCalledOnce()

    const redirectPrevented = vi.fn()
    listeners.get('will-redirect')?.({ preventDefault: redirectPrevented })
    expect(redirectPrevented).toHaveBeenCalledOnce()
    expect(openHandler?.({ url: 'https://external.invalid/' })).toEqual({ action: 'deny' })
  })
})
