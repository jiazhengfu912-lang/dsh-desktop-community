/** Better Sidebar component adapter for the package's format renderers. */

import { useCallback, useSyncExternalStore } from 'react'
import type { LocaleRuntime } from '@deepseek-ai/dsh-client-locale/client'
import type { FileViewerProps } from 'dsh-better-sidebar'
import { DocumentPreview } from './DocumentPreview.tsx'
import type { LoadedDocument } from './gateway.ts'
import css from './DocumentViewer.module.css'

/** Props passed by the Better Sidebar descriptor closure. */
export interface DocumentFileViewerProps extends Pick<FileViewerProps, 'title' | 'customData'> {
  /** Shared DSH locale service; the component never receives the Cordis context. */
  locale: LocaleRuntime
}

/** Render a loaded document inside Better Sidebar's existing editor content area. */
export function DocumentFileViewer(props: DocumentFileViewerProps) {
  const subscribe = useCallback((listener: () => void) => props.locale.subscribe(listener), [props.locale])
  const getRevision = useCallback(() => props.locale.getSnapshot().revision, [props.locale])
  useSyncExternalStore(subscribe, getRevision, getRevision)
  const t = props.locale.bind('documentViewer')
  return (
    <div className={css.viewer} data-document-viewer={props.title}>
      <DocumentPreview
        title={props.title}
        document={props.customData as LoadedDocument}
        loadingLabel={t('preview.loading')}
        errorLabel={t('preview.failed')}
      />
    </div>
  )
}
