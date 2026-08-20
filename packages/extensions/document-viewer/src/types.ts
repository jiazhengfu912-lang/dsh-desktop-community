/** Types shared by the document viewer's host and browser halves. */

/** Document formats the viewer accepts. */
export type DocumentFormat = 'pdf' | 'docx' | 'pptx' | 'markdown'

/** JSON body returned for a document-viewer request failure. */
export interface DocumentErrorBody {
  /** Stable machine-readable error category. */
  code: string
}
