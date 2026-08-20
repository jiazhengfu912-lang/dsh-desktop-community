// @vitest-environment jsdom

import { Context } from '@deepseek-ai/cordis'
import { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import {
  type SessionId, type WorkspaceId, type WorkspaceView,
} from '@deepseek-ai/dsh-client-runtime/client'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import type { BetterSidebarService, FileViewerDescriptor, FileViewerProps } from 'dsh-better-sidebar'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DocumentFileViewer } from '../src/client/DocumentFileViewer.tsx'
import { DocumentPreview } from '../src/client/DocumentPreview.tsx'
import {
  createDocumentGateway, DocumentGatewayError, relativeWorkspaceFile, type LoadedDocument,
} from '../src/client/gateway.ts'
import { apply, inject } from '../src/client/index.ts'
import { en, zh } from '../src/client/locales.ts'

interface TestPptxOptions {
  lazyMedia: boolean
  lazySlides: boolean
  pdfjs: false
  zipLimits: { maxEntries: number; maxTotalUncompressedBytes: number }
  listOptions: { windowed: boolean }
}

const rendererMocks = vi.hoisted(() => ({
  destroy: vi.fn<() => void>(),
  open: vi.fn<(
    blob: Blob,
    element: HTMLElement,
    options: TestPptxOptions,
  ) => Promise<{ destroy: () => void }>>(),
  renderAsync: vi.fn<(
    blob: Blob,
    body: HTMLElement,
    style: HTMLElement,
    options: Record<string, unknown>,
  ) => Promise<void>>(),
}))

vi.mock('docx-preview', () => ({ renderAsync: rendererMocks.renderAsync }))
vi.mock('@aiden0z/pptx-renderer/browser', () => ({
  PptxViewer: { open: rendererMocks.open },
  RECOMMENDED_ZIP_LIMITS: { maxEntries: 100, maxTotalUncompressedBytes: 1024 },
}))

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  rendererMocks.destroy.mockReset()
  rendererMocks.open.mockReset()
  rendererMocks.renderAsync.mockReset()
})

const sid = (value: string): SessionId => value as SessionId
const wid = (value: string): WorkspaceId => value as WorkspaceId

function workspace(id: string, path: string, sessions: string[] = ['session']): WorkspaceView {
  return {
    workspaceId: wid(id), path, title: id,
    sessionIds: sessions.map(sid),
    createdAt: '2026-08-20T00:00:00.000Z', updatedAt: '2026-08-20T00:00:00.000Z',
  }
}

function locale() {
  const ctx = new Context()
  const runtime = new LocaleRuntime(ctx)
  runtime.register('documentViewer', { zh, en })
  runtime.setLocale('zh')
  return runtime
}

describe('Better Sidebar registration', () => {
  it('registers one high-priority custom viewer and disposes it with the client fiber', async () => {
    const ctx = new Context()
    const disposeViewer = vi.fn()
    const registerFileViewer = vi.fn((_descriptor: FileViewerDescriptor) => disposeViewer)
    ctx.provide('betterSidebar', { registerFileViewer } as unknown as BetterSidebarService)
    ctx.provide('workspaces', {
      list: { getSnapshot: () => ({ items: [workspace('work', 'D:/workspace')] }) },
    } as never)
    const runtime = new LocaleRuntime(ctx)
    runtime.setLocale('zh')
    ctx.provide('locale', runtime)

    const fiber = ctx.plugin({ inject: [...inject], apply })
    await fiber.await()
    expect(inject).toEqual(['betterSidebar', 'workspaces', 'locale'])
    expect(registerFileViewer).toHaveBeenCalledOnce()
    const descriptor = registerFileViewer.mock.calls[0]![0]
    expect(descriptor).toMatchObject({
      id: 'dsh-document-viewer',
      exts: ['pdf', 'docx', 'pptx', 'md', 'markdown'],
      priority: 100,
      fetchStrategy: 'custom',
    })
    expect(typeof descriptor.title).toBe('function')
    expect((descriptor.title as () => string)()).toBe('PDF、Office 与 Markdown 文档')

    vi.stubGlobal('fetch', vi.fn(async () => new Response('# body')))
    const loaded = await descriptor.load?.('D:\\workspace\\notes.md', { sessionId: 'session' })
    expect(loaded).toEqual(expect.objectContaining({ format: 'markdown' }))
    render(descriptor.component({ title: 'notes.md', customData: loaded } as FileViewerProps))
    expect(screen.getByText('body')).toBeTruthy()

    await fiber.dispose()
    expect(disposeViewer).toHaveBeenCalledOnce()
  })
})

describe('Better Sidebar custom loader', () => {
  it('maps Windows, UNC, and POSIX selections to workspace-relative POSIX paths', () => {
    expect(relativeWorkspaceFile('D:\\Work', 'd:\\work\\Docs\\A.PDF')).toBe('Docs/A.PDF')
    expect(relativeWorkspaceFile('D:/', 'D:/root.pdf')).toBe('root.pdf')
    expect(relativeWorkspaceFile('\\\\server\\share\\root', '\\\\SERVER\\SHARE\\root\\a.docx')).toBe('a.docx')
    expect(relativeWorkspaceFile('/srv/work', '/srv/work/docs/a.md')).toBe('docs/a.md')
  })

  it('rejects roots, relatives, malformed paths, other volumes, siblings, and POSIX case changes', () => {
    for (const [root, file] of [
      ['D:/work', 'D:/work'],
      ['D:/work', 'docs/a.pdf'],
      ['D:/work', 'D:/work/../secret.pdf'],
      ['D:/work', 'D:/work//a.pdf'],
      ['D:/work', 'E:/work/a.pdf'],
      ['D:/work', 'D:/workspace/a.pdf'],
      ['/srv/work', '/srv/Work/a.pdf'],
      ['', 'D:/work/a.pdf'],
      ['//server', '//server/share/a.pdf'],
      ['D:/work', 'D:/work/'],
      ['D:/work', 'D:/work/\0.pdf'],
    ]) {
      expect(() => relativeWorkspaceFile(root!, file!)).toThrow(new DocumentGatewayError(403, 'forbidden-path'))
    }
  })

  it('loads PDF by same-origin URL and fetches Markdown, DOCX, and PPTX with the caller signal', async () => {
    const source = { getSnapshot: () => ({ items: [workspace('work space', 'D:/workspace')] }) }
    const gateway = createDocumentGateway(source)
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response('# body'))
      .mockResolvedValueOnce(new Response(new Blob(['docx'])))
      .mockResolvedValueOnce(new Response(new Blob(['pptx'])))
    vi.stubGlobal('fetch', fetcher)
    const controller = new AbortController()

    expect(await gateway.loadDocument('D:/workspace/a.pdf', { sessionId: 'session' }, controller.signal)).toEqual({
      format: 'pdf', url: '/document-viewer/content?workspaceId=work+space&path=a.pdf',
    })
    expect(await gateway.loadDocument('D:/workspace/docs/a.MARKDOWN', { sessionId: 'session' }, controller.signal))
      .toEqual({ format: 'markdown', text: '# body' })
    const loadedDocx = await gateway.loadDocument('D:/workspace/a.DOCX', { sessionId: 'session' }, controller.signal)
    expect(loadedDocx.format).toBe('docx')
    expect('blob' in loadedDocx ? loadedDocx.blob : undefined).toBeInstanceOf(Blob)
    const loadedPptx = await gateway.loadDocument('D:/workspace/a.PPTX', { sessionId: 'session' }, controller.signal)
    expect(loadedPptx.format).toBe('pptx')
    expect('blob' in loadedPptx ? loadedPptx.blob : undefined).toBeInstanceOf(Blob)
    expect(fetcher).toHaveBeenCalledTimes(3)
    expect(fetcher.mock.calls[0]?.[1]).toEqual({ signal: controller.signal })
  })

  it('reports missing workspaces, unsupported extensions, host errors, and non-JSON errors without paths', async () => {
    const missing = createDocumentGateway({ getSnapshot: () => ({ items: [] }) })
    await expect(missing.loadDocument('D:/workspace/a.pdf', { sessionId: 'session' }))
      .rejects.toEqual(new DocumentGatewayError(404, 'workspace-not-found'))

    const gateway = createDocumentGateway({
      getSnapshot: () => ({ items: [workspace('work', 'D:/workspace', ['other', 'session'])] }),
    })
    await expect(gateway.loadDocument('D:/workspace/a.txt', { sessionId: 'session' }))
      .rejects.toEqual(new DocumentGatewayError(415, 'unsupported-format'))
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ code: 'forbidden-path' }), { status: 403 }))
      .mockResolvedValueOnce(new Response('not-json', { status: 500 })))
    await expect(gateway.loadDocument('D:/workspace/a.md', { sessionId: 'session' }))
      .rejects.toEqual(new DocumentGatewayError(403, 'forbidden-path'))
    await expect(gateway.loadDocument('D:/workspace/b.md', { sessionId: 'session' }))
      .rejects.toEqual(new DocumentGatewayError(500, 'http-500'))
  })
})

describe('document render adapters', () => {
  const labels = { loadingLabel: 'loading', errorLabel: 'failed' }

  it('renders a same-origin sandboxed PDF frame and Markdown through MarkdownText', () => {
    const pdf: LoadedDocument = { format: 'pdf', url: '/document-viewer/content?x=1' }
    const view = render(<DocumentPreview title="a.pdf" document={pdf} {...labels} />)
    const frame = screen.getByTitle('a.pdf')
    expect(frame.getAttribute('src')).toBe('/document-viewer/content?x=1')
    expect(frame.getAttribute('sandbox')).toBe('allow-same-origin')

    view.rerender(<DocumentPreview title="a.md" document={{ format: 'markdown', text: '# Preview' }} {...labels} />)
    expect(screen.getByRole('heading', { name: 'Preview' })).toBeTruthy()
  })

  it('renders DOCX with altChunk disabled, blocks links, reports failures, and ignores late settlement', async () => {
    rendererMocks.renderAsync.mockImplementationOnce(async (_blob, body) => {
      const link = document.createElement('a')
      link.href = 'https://example.com'
      link.textContent = 'external'
      body.append(link)
    })
    const docx: LoadedDocument = { format: 'docx', blob: new Blob(['docx']) }
    const view = render(<DocumentPreview title="a.docx" document={docx} {...labels} />)
    const link = await screen.findByText('external')
    const event = new MouseEvent('click', { bubbles: true, cancelable: true })
    link.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    expect(rendererMocks.renderAsync).toHaveBeenCalledWith(
      docx.blob, expect.any(HTMLElement), expect.any(HTMLElement),
      expect.objectContaining({ renderAltChunks: false, useBase64URL: true }),
    )
    view.unmount()

    rendererMocks.renderAsync.mockRejectedValueOnce(new Error('bad document'))
    const failed = render(<DocumentPreview title="bad.docx" document={{ ...docx, blob: new Blob(['bad']) }} {...labels} />)
    await screen.findByText('failed')
    failed.unmount()

    let resolveLate: (() => void) | undefined
    rendererMocks.renderAsync.mockImplementationOnce(() => new Promise<void>((resolve) => { resolveLate = resolve }))
    const late = render(<DocumentPreview title="late.docx" document={{ ...docx, blob: new Blob(['late']) }} {...labels} />)
    late.unmount()
    resolveLate?.()
    await Promise.resolve()

    let rejectLate: ((reason: Error) => void) | undefined
    rendererMocks.renderAsync.mockImplementationOnce(() => new Promise<void>((_resolve, reject) => { rejectLate = reject }))
    const rejected = render(<DocumentPreview title="late-error.docx" document={{ ...docx, blob: new Blob(['late-error']) }} {...labels} />)
    rejected.unmount()
    rejectLate?.(new Error('late'))
    await Promise.resolve()
  })

  it('opens PPTX lazily, blocks links, reports failures, and destroys active or late viewers', async () => {
    rendererMocks.open.mockImplementationOnce(async (_blob, element) => {
      const link = document.createElement('a')
      link.href = 'https://example.com'
      link.textContent = 'pptx external'
      element.append(link)
      return { destroy: rendererMocks.destroy }
    })
    const pptx: LoadedDocument = { format: 'pptx', blob: new Blob(['pptx']) }
    const view = render(<DocumentPreview title="a.pptx" document={pptx} {...labels} />)
    const link = await screen.findByText('pptx external')
    const event = new MouseEvent('click', { bubbles: true, cancelable: true })
    link.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)
    expect(rendererMocks.open.mock.calls[0]?.[2]).toMatchObject({
      lazyMedia: true, lazySlides: true, pdfjs: false,
      zipLimits: { maxEntries: 4096, maxTotalUncompressedBytes: 256 * 1024 * 1024 },
      listOptions: { windowed: true },
    })
    view.unmount()
    expect(rendererMocks.destroy).toHaveBeenCalledOnce()

    rendererMocks.open.mockRejectedValueOnce(new Error('bad presentation'))
    const failed = render(<DocumentPreview title="bad.pptx" document={{ ...pptx, blob: new Blob(['bad']) }} {...labels} />)
    await screen.findByText('failed')
    failed.unmount()

    let resolveLate: ((viewer: { destroy: () => void }) => void) | undefined
    rendererMocks.open.mockImplementationOnce(() => new Promise((resolve) => { resolveLate = resolve }))
    const late = render(<DocumentPreview title="late.pptx" document={{ ...pptx, blob: new Blob(['late']) }} {...labels} />)
    late.unmount()
    resolveLate?.({ destroy: rendererMocks.destroy })
    await waitFor(() => { expect(rendererMocks.destroy).toHaveBeenCalledTimes(2) })

    let rejectLate: ((reason: Error) => void) | undefined
    rendererMocks.open.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectLate = reject }))
    const rejected = render(<DocumentPreview title="late-error.pptx" document={{ ...pptx, blob: new Blob(['late-error']) }} {...labels} />)
    rejected.unmount()
    rejectLate?.(new Error('late'))
    await Promise.resolve()
  })

  it('keeps Better Sidebar component copy synchronized with the DSH locale', async () => {
    const runtime = locale()
    let resolveDocx: (() => void) | undefined
    rendererMocks.renderAsync.mockImplementation(() => new Promise<void>((resolve) => { resolveDocx = resolve }))
    const view = render(<DocumentFileViewer
      title="a.docx"
      customData={{ format: 'docx', blob: new Blob(['docx']) }}
      locale={runtime}
    />)
    expect(screen.getByText('正在加载文档…')).toBeTruthy()
    runtime.setLocale('en')
    await screen.findByText('Loading document…')
    expect(document.querySelector('[data-document-viewer="a.docx"]')).toBeTruthy()
    view.unmount()
    resolveDocx?.()
  })
})
