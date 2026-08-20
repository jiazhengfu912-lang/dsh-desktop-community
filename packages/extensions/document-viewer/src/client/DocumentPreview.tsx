/** Format adapters rendered inside Better Sidebar's existing editor tab. */

import { useEffect, useRef, useState } from 'react'
import { PptxViewer, RECOMMENDED_ZIP_LIMITS } from '@aiden0z/pptx-renderer/browser'
import { MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import { renderAsync } from 'docx-preview'
import type { LoadedDocument } from './gateway.ts'
import css from './DocumentViewer.module.css'

/** Preview adapter props shared by every document format. */
export interface DocumentPreviewProps {
  /** File name shown to assistive technology by the PDF frame. */
  title: string
  /** Data returned by Better Sidebar's package-owned custom loader. */
  document: LoadedDocument
  /** Localized loading text. */
  loadingLabel: string
  /** Localized failure text. */
  errorLabel: string
}

/** Select and render the adapter for one loaded document. */
export function DocumentPreview(props: DocumentPreviewProps) {
  if (props.document.format === 'pdf') {
    return (
      <iframe
        className={css.pdfFrame}
        src={props.document.url}
        title={props.title}
        sandbox="allow-same-origin"
      />
    )
  }
  if (props.document.format === 'markdown') {
    return (
      <div className={css.markdownViewport}>
        <div className={css.markdown}><MarkdownText text={props.document.text} /></div>
      </div>
    )
  }
  if (props.document.format === 'docx') return <DocxPreview {...props} document={props.document} />
  return <PptxPreview {...props} document={props.document} />
}

function DocxPreview(props: Omit<DocumentPreviewProps, 'document'> & { document: Extract<LoadedDocument, { format: 'docx' }> }) {
  const container = useRef<HTMLDivElement | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  useEffect(() => {
    const element = committedRef(container.current)
    let cancelled = false
    element.replaceChildren()
    setState('loading')
    element.addEventListener('click', blockLinkNavigation, true)
    void renderAsync(props.document.blob, element, element, {
      inWrapper: true,
      breakPages: true,
      renderHeaders: true,
      renderFooters: true,
      renderFootnotes: true,
      renderEndnotes: true,
      renderAltChunks: false,
      useBase64URL: true,
    })
      .then(() => { if (!cancelled) setState('ready') })
      .catch(() => { if (!cancelled) setState('error') })
    return () => {
      cancelled = true
      element.removeEventListener('click', blockLinkNavigation, true)
      element.replaceChildren()
    }
  }, [props.document.blob])
  return (
    <div className={css.officeViewport}>
      {state === 'loading' && <PreviewMessage text={props.loadingLabel} />}
      {state === 'error' && <PreviewMessage text={props.errorLabel} error />}
      <div ref={container} className={css.docx} data-ready={state === 'ready' || undefined} />
    </div>
  )
}

function PptxPreview(props: Omit<DocumentPreviewProps, 'document'> & { document: Extract<LoadedDocument, { format: 'pptx' }> }) {
  const viewport = useRef<HTMLDivElement | null>(null)
  const container = useRef<HTMLDivElement | null>(null)
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  useEffect(() => {
    const controller = new AbortController()
    const element = committedRef(container.current)
    const scrollContainer = committedRef(viewport.current)
    element.replaceChildren()
    setState('loading')
    let viewer: PptxViewer | undefined
    element.addEventListener('click', blockLinkNavigation, true)
    void PptxViewer.open(props.document.blob, element, {
      fitMode: 'contain',
      scrollContainer,
      zipLimits: {
        ...RECOMMENDED_ZIP_LIMITS,
        maxEntries: 4096,
        maxTotalUncompressedBytes: 256 * 1024 * 1024,
      },
      pdfjs: false,
      renderMode: 'list',
      listOptions: { windowed: true, batchSize: 4, initialSlides: 2, showSlideLabels: true },
      lazyMedia: true,
      lazySlides: true,
      signal: controller.signal,
    })
      .then((opened) => {
        viewer = opened
        if (controller.signal.aborted) opened.destroy()
        else setState('ready')
      })
      .catch(() => { if (!controller.signal.aborted) setState('error') })
    return () => {
      controller.abort()
      viewer?.destroy()
      element.removeEventListener('click', blockLinkNavigation, true)
      element.replaceChildren()
    }
  }, [props.document.blob])
  return (
    <div ref={viewport} className={css.officeViewport}>
      {state === 'loading' && <PreviewMessage text={props.loadingLabel} />}
      {state === 'error' && <PreviewMessage text={props.errorLabel} error />}
      <div ref={container} className={css.pptx} data-ready={state === 'ready' || undefined} />
    </div>
  )
}

function PreviewMessage({ text, error = false }: { text: string; error?: boolean }) {
  return <div className={error ? css.previewError : css.previewMessage}>{text}</div>
}

function blockLinkNavigation(event: MouseEvent): void {
  if ((event.target as Element | null)?.closest('a') !== null) {
    event.preventDefault()
    event.stopPropagation()
  }
}

function committedRef<T>(value: T | null): T {
  /* v8 ignore next -- React runs this effect only after assigning the rendered element's ref. */
  if (value === null) throw new Error('document renderer ref is unavailable after commit')
  return value
}
