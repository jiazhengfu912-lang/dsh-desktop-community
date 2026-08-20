/** Document-viewer product copy. */

/** Simplified Chinese dictionary. */
export const zh = {
  'viewer.title': 'PDF、Office 与 Markdown 文档',
  'preview.loading': '正在加载文档…',
  'preview.failed': '无法预览此文档',
} satisfies Record<string, string>

/** Dictionary key union. */
export type DocumentViewerKey = keyof typeof zh

/** English dictionary. */
export const en = {
  'viewer.title': 'PDF, Office, and Markdown documents',
  'preview.loading': 'Loading document…',
  'preview.failed': 'Unable to preview this document',
} satisfies Record<DocumentViewerKey, string>
