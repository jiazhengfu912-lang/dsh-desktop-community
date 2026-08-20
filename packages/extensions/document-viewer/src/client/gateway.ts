/** Browser transport adapter for Better Sidebar document previews. */

import type { WorkspaceView } from '@deepseek-ai/dsh-client-runtime/client'
import type { DocumentErrorBody, DocumentFormat } from '../types.ts'

/** Session identity supplied by Better Sidebar when it opens a file. */
export interface DocumentSessionScope {
  /** Session whose explorer selected the file. */
  sessionId: string
  /** Session working directory, carried by Better Sidebar but not trusted for authorization. */
  cwd?: string
}

/** Workspace fields needed to authorize a Better Sidebar file selection. */
export interface DocumentWorkspaceSource {
  /** Return the current registered Workspace projection. */
  getSnapshot: () => { items: readonly WorkspaceView[] }
}

/** Data handed to the renderer after Better Sidebar's custom loader finishes. */
export type LoadedDocument =
  | { format: 'pdf'; url: string }
  | { format: 'markdown'; text: string }
  | { format: 'docx'; blob: Blob }
  | { format: 'pptx'; blob: Blob }

/** A document host request failed with a stable, path-free category. */
export class DocumentGatewayError extends Error {
  /** @param status - HTTP status. @param code - stable host error category. */
  constructor(
    readonly status: number,
    readonly code: string,
  ) {
    super(`document viewer request failed: ${status} ${code}`)
    this.name = 'DocumentGatewayError'
  }
}

/** Better Sidebar custom-loader callbacks owned by this package. */
export interface DocumentViewerGateway {
  /** Load one selected file through the workspace-confined host route. */
  loadDocument: (
    path: string,
    scope: DocumentSessionScope,
    signal?: AbortSignal,
  ) => Promise<LoadedDocument>
  /** Build the same-origin URL used by the native PDF frame. */
  contentUrl: (workspaceId: string, path: string) => string
}

/**
 * Create the Better Sidebar loader over the live Workspace projection.
 * @param workspaces - registered Workspace read face.
 * @returns the custom loader and content URL builder.
 */
export function createDocumentGateway(workspaces: DocumentWorkspaceSource): DocumentViewerGateway {
  const contentUrl = (workspaceId: string, path: string): string => {
    const query = new URLSearchParams({ workspaceId, path })
    return `/document-viewer/content?${query.toString()}`
  }
  const ensureOk = async (response: Response): Promise<Response> => {
    if (response.ok) return response
    const body = await response.json().catch(() => undefined) as DocumentErrorBody | undefined
    throw new DocumentGatewayError(response.status, body?.code ?? `http-${response.status}`)
  }
  return {
    contentUrl,
    async loadDocument(path, scope, signal) {
      const workspace = workspaceForSession(workspaces.getSnapshot().items, scope.sessionId)
      const relativePath = relativeWorkspaceFile(workspace.path, path)
      const format = formatOf(relativePath)
      if (format === undefined) throw new DocumentGatewayError(415, 'unsupported-format')
      const url = contentUrl(String(workspace.workspaceId), relativePath)
      if (format === 'pdf') return { format, url }
      const response = await ensureOk(await fetch(url, signal === undefined ? {} : { signal }))
      const blob = await response.blob()
      if (format === 'markdown') return { format, text: await blob.text() }
      return { format, blob }
    },
  }
}

/**
 * Convert one native absolute file path to a POSIX path relative to a Workspace.
 * @param workspacePath - absolute Workspace root from the registered projection.
 * @param filePath - absolute path selected by Better Sidebar.
 * @returns the non-empty relative file path.
 */
export function relativeWorkspaceFile(workspacePath: string, filePath: string): string {
  const root = parseAbsolutePath(workspacePath, true)
  const file = parseAbsolutePath(filePath, false)
  if (root === undefined
    || file === undefined
    || root.kind !== file.kind
    || !compare(root.anchor, file.anchor, root.kind)
    || file.segments.length <= root.segments.length
    || root.segments.some((segment, index) => !compare(segment, file.segments[index] as string, root.kind))) {
    throw new DocumentGatewayError(403, 'forbidden-path')
  }
  return file.segments.slice(root.segments.length).join('/')
}

function workspaceForSession(workspaces: readonly WorkspaceView[], sessionId: string): WorkspaceView {
  const workspace = workspaces.find(candidate => candidate.sessionIds.some(id => String(id) === sessionId))
  if (workspace === undefined) throw new DocumentGatewayError(404, 'workspace-not-found')
  return workspace
}

function formatOf(path: string): DocumentFormat | undefined {
  const dot = path.lastIndexOf('.')
  if (dot < 0) return undefined
  switch (path.slice(dot).toLowerCase()) {
    case '.pdf': return 'pdf'
    case '.docx': return 'docx'
    case '.pptx': return 'pptx'
    case '.md':
    case '.markdown': return 'markdown'
    default: return undefined
  }
}

interface ParsedAbsolutePath {
  kind: 'windows' | 'posix'
  anchor: string
  segments: string[]
}

function parseAbsolutePath(input: string, allowRoot: boolean): ParsedAbsolutePath | undefined {
  if (input.length === 0 || input.includes('\0')) return undefined
  const value = input.replaceAll('\\', '/')
  let kind: ParsedAbsolutePath['kind']
  let anchor: string
  let tail: string
  if (/^[A-Za-z]:\//.test(value)) {
    kind = 'windows'
    anchor = value.slice(0, 2)
    tail = value.slice(3)
  } else if (value.startsWith('//')) {
    const unc = value.slice(2).split('/')
    if (unc.length < 2 || unc[0] === '' || unc[1] === '') return undefined
    kind = 'windows'
    anchor = `//${unc[0]}/${unc[1]}`
    tail = unc.slice(2).join('/')
  } else if (value.startsWith('/')) {
    kind = 'posix'
    anchor = '/'
    tail = value.slice(1)
  } else {
    return undefined
  }
  if (tail.endsWith('/')) tail = tail.slice(0, -1)
  const segments = tail === '' ? [] : tail.split('/')
  if ((!allowRoot && segments.length === 0)
    || segments.some(segment => segment === '' || segment === '.' || segment === '..')) {
    return undefined
  }
  return { kind, anchor, segments }
}

function compare(left: string, right: string, kind: ParsedAbsolutePath['kind']): boolean {
  return kind === 'windows' ? left.toLocaleLowerCase('en-US') === right.toLocaleLowerCase('en-US') : left === right
}
