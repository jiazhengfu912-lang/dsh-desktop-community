/** Document viewer browser plugin: Better Sidebar file-viewer contribution. */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { createElement } from 'react'
import type {} from 'dsh-better-sidebar'
import { DocumentFileViewer } from './DocumentFileViewer.tsx'
import { createDocumentGateway } from './gateway.ts'
import { en, zh, type DocumentViewerKey } from './locales.ts'

export { DocumentFileViewer } from './DocumentFileViewer.tsx'
export type { DocumentFileViewerProps } from './DocumentFileViewer.tsx'
export { DocumentPreview } from './DocumentPreview.tsx'
export type { DocumentPreviewProps } from './DocumentPreview.tsx'
export { DocumentGatewayError, createDocumentGateway, relativeWorkspaceFile } from './gateway.ts'
export type {
  DocumentSessionScope, DocumentViewerGateway, DocumentWorkspaceSource, LoadedDocument,
} from './gateway.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** Better Sidebar document-preview copy. */
    documentViewer: DocumentViewerKey
  }
}

const NS = 'documentViewer'

/** Client services required to register the Better Sidebar previewer. */
export const inject = ['betterSidebar', 'workspaces', 'locale']

/** Register one high-priority viewer for PDF, DOCX, PPTX, and Markdown files. */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'document-viewer: dictionaries')
  const gateway = createDocumentGateway(ctx.workspaces.list)
  ctx.effect(() => ctx.betterSidebar.registerFileViewer({
    id: 'dsh-document-viewer',
    title: () => ctx.locale.bind(NS)('viewer.title'),
    exts: ['pdf', 'docx', 'pptx', 'md', 'markdown'],
    priority: 100,
    fetchStrategy: 'custom',
    load: gateway.loadDocument,
    component: props => createElement(DocumentFileViewer, {
      title: props.title,
      customData: props.customData,
      locale: ctx.locale,
    }),
  }), 'document-viewer: Better Sidebar file viewer')
}
