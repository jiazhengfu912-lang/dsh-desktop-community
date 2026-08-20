/**
 * Workspace-confined document routes for the desktop document viewer.
 * @module @deepseek-ai/dsh-document-viewer
 */

import { createReadStream } from 'node:fs'
import { lstat, open, realpath } from 'node:fs/promises'
import type { FileHandle } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { basename, isAbsolute, join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import type { Workspace } from '@deepseek-ai/dsh-workspace'
import * as yauzl from 'yauzl'
import type { Entry as ZipEntry } from 'yauzl'
import type { DocumentErrorBody, DocumentFormat } from './types.ts'
import { mapFilesystemError as mapFilesystemErrorResult } from './filesystem-error.ts'
import { isWithin } from './path-containment.ts'

const CONTENT_ROUTE = '/document-viewer/content'
const DEFAULT_MAX_FILE_BYTES = 64 * 1024 * 1024
const DEFAULT_MAX_EXPANDED_BYTES = 256 * 1024 * 1024
const DEFAULT_MAX_ARCHIVE_ENTRIES = 4096

const FORMATS: Readonly<Record<string, { format: DocumentFormat; mime: string }>> = {
  '.pdf': { format: 'pdf', mime: 'application/pdf' },
  '.docx': {
    format: 'docx',
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  },
  '.pptx': {
    format: 'pptx',
    mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  },
  '.md': { format: 'markdown', mime: 'text/markdown; charset=utf-8' },
  '.markdown': { format: 'markdown', mime: 'text/markdown; charset=utf-8' },
}

/** Resource limits enforced by the document host routes. */
export interface Config {
  /** Maximum compressed file size served to the browser. */
  maxFileBytes: number
  /** Maximum summed uncompressed size accepted from one Office archive. */
  maxExpandedBytes: number
  /** Maximum entry count accepted from one Office archive. */
  maxArchiveEntries: number
}

/** Validated document-viewer configuration. */
export const Config: z<Config> = z.object({
  maxFileBytes: z.natural().min(1).default(DEFAULT_MAX_FILE_BYTES),
  maxExpandedBytes: z.natural().min(1).default(DEFAULT_MAX_EXPANDED_BYTES),
  maxArchiveEntries: z.natural().min(1).default(DEFAULT_MAX_ARCHIVE_ENTRIES),
})

/** Cordis plugin name. */
export const name = 'document-viewer'

/** Host services required by the document routes. */
export const inject = ['webServer', 'workspaceRegistry']

class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly headers?: Readonly<Record<string, string>>,
  ) {
    super(code)
    this.name = 'DocumentViewerHttpError'
  }
}

interface ResolvedDocumentPath {
  absolute: string
  relative: string
  workspace: Workspace
}

interface ByteRange {
  start: number
  end: number
}

/** Register the package-owned content route for the plugin fiber lifetime. */
export function apply(ctx: Context, config: Config): void {
  const host = new DocumentRouteHost(ctx, config)
  ctx.effect(() => {
    return ctx.webServer.register({
      kind: 'exact',
      path: CONTENT_ROUTE,
      handler: (req, res) => host.serveContent(req, res),
    })
  }, 'document-viewer: content route')
}

class DocumentRouteHost {
  constructor(
    private readonly ctx: Context,
    private readonly config: Config,
  ) {}

  async serveContent(req: IncomingMessage, res: ServerResponse): Promise<void> {
    await this.respond(res, async () => {
      requireMethod(req, ['GET', 'HEAD'])
      const url = requestUrl(req)
      const workspace = this.workspace(url)
      const requestedPath = requiredQuery(url, 'path')
      const format = formatOf(requestedPath)
      if (format === undefined) throw new HttpError(415, 'unsupported-format')
      const resolved = await resolveWorkspacePath(workspace, requestedPath)
      await this.writeDocument(req, res, resolved, format)
    })
  }

  private workspace(url: URL): Workspace {
    const workspaceId = requiredQuery(url, 'workspaceId')
    const workspace = this.ctx.workspaceRegistry.get(WorkspaceId(workspaceId))
    if (workspace === undefined) throw new HttpError(404, 'workspace-not-found')
    return workspace
  }

  private async writeDocument(
    req: IncomingMessage,
    res: ServerResponse,
    resolved: ResolvedDocumentPath,
    supported: { format: DocumentFormat; mime: string },
  ): Promise<void> {
    let handle: FileHandle | undefined
    try {
      handle = await open(resolved.absolute, 'r')
      const info = await handle.stat()
      if (!info.isFile()) throw new HttpError(404, 'document-not-found')
      if (info.size > this.config.maxFileBytes) throw new HttpError(413, 'file-too-large')
      if (supported.format === 'docx' || supported.format === 'pptx') {
        await inspectOfficeArchive(await handle.readFile(), this.config)
      }

      const etag = `W/\"${info.size.toString(16)}-${Math.trunc(info.mtimeMs).toString(16)}\"`
      const baseHeaders: Record<string, string> = {
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'no-cache',
        'Content-Disposition': inlineDisposition(basename(resolved.relative)),
        'Content-Type': supported.mime,
        ETag: etag,
        'X-Content-Type-Options': 'nosniff',
      }
      if (req.headers['if-none-match'] === etag && req.headers.range === undefined) {
        res.writeHead(304, baseHeaders)
        res.end()
        return
      }

      const range = req.headers.range === undefined
        ? undefined
        : parseRange(req.headers.range, info.size)
      const start = range?.start ?? 0
      const end = range?.end ?? Math.max(0, info.size - 1)
      const contentLength = range === undefined ? info.size : end - start + 1
      const headers = {
        ...baseHeaders,
        'Content-Length': String(contentLength),
        ...(range === undefined ? {} : { 'Content-Range': `bytes ${start}-${end}/${info.size}` }),
      }
      res.writeHead(range === undefined ? 200 : 206, headers)
      if (req.method === 'HEAD' || info.size === 0) {
        res.end()
        return
      }
      const stream = createReadStream(resolved.absolute, {
        fd: handle.fd,
        autoClose: false,
        start,
        end,
      })
      await pipeline(stream, res)
    } catch (error) {
      if (error instanceof HttpError) throw error
      throw mapFilesystemError(error)
    } finally {
      /* v8 ignore next 3 -- close fails only after an independent descriptor invalidation during transport teardown. */
      await handle?.close().catch(() => {
        // A completed pipeline or aborted response may already have invalidated the descriptor.
      })
    }
  }

  private async respond(res: ServerResponse, operation: () => Promise<void>): Promise<void> {
    try {
      await operation()
    } catch (error) {
      if (res.headersSent) {
        res.destroy()
        return
      }
      const mapped = error instanceof HttpError ? error : new HttpError(500, 'internal-error')
      if (!(error instanceof HttpError)) {
        this.ctx.logger.warn(error instanceof Error ? error : new Error('document viewer internal failure'))
      }
      writeJson(res, mapped.status, { code: mapped.code }, mapped.headers)
    }
  }
}

function requestUrl(req: IncomingMessage): URL {
  const target = req.url
  /* v8 ignore next -- Node supplies a request target before WebServer exact-route dispatch. */
  if (target === undefined) throw new HttpError(400, 'invalid-request')
  return new URL(target, 'http://document-viewer.local')
}

function requireMethod(req: IncomingMessage, allowed: readonly string[]): void {
  if (req.method !== undefined && allowed.includes(req.method)) return
  throw new HttpError(400, 'invalid-method')
}

function requiredQuery(url: URL, name: string): string {
  const values = url.searchParams.getAll(name)
  if (values.length !== 1 || values[0] === '') {
    throw new HttpError(400, 'invalid-request')
  }
  return values[0] as string
}

function validateRelativePath(input: string): string[] {
  if (input.length === 0
    || input.includes('\0')
    || input.includes('\\')
    || isAbsolute(input)
    || /^[A-Za-z]:/.test(input)
    || /%2f|%5c/i.test(input)) {
    throw new HttpError(400, 'invalid-path')
  }
  const segments = input.split('/')
  if (segments.some(segment => segment === '' || segment === '.' || segment === '..')) {
    throw new HttpError(400, 'invalid-path')
  }
  return segments
}

async function resolveWorkspacePath(
  workspace: Workspace,
  input: string,
): Promise<ResolvedDocumentPath> {
  const segments = validateRelativePath(input)
  let canonicalRoot: string
  try {
    const rootInfo = await lstat(workspace.path)
    if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) {
      throw new HttpError(403, 'forbidden-path')
    }
    canonicalRoot = await realpath(workspace.path)
  } catch (error) {
    if (error instanceof HttpError) throw error
    throw mapFilesystemError(error)
  }

  let cursor = canonicalRoot
  try {
    for (const segment of segments) {
      cursor = join(cursor, segment)
      const info = await lstat(cursor)
      if (info.isSymbolicLink()) throw new HttpError(403, 'forbidden-path')
    }
    const canonicalTarget = await realpath(cursor)
    /* v8 ignore next -- the per-segment link rejection makes escape unreachable; the pure containment policy is tested directly. */
    if (!isWithin(canonicalRoot, canonicalTarget)) throw new HttpError(403, 'forbidden-path')
    return { absolute: canonicalTarget, relative: segments.join('/'), workspace }
  } catch (error) {
    if (error instanceof HttpError) throw error
    throw mapFilesystemError(error)
  }
}

function formatOf(path: string): { format: DocumentFormat; mime: string } | undefined {
  const dot = path.lastIndexOf('.')
  if (dot < 0) return undefined
  return FORMATS[path.slice(dot).toLowerCase()]
}

function mapFilesystemError(error: unknown): HttpError {
  const mapped = mapFilesystemErrorResult(error)
  return new HttpError(mapped.status, mapped.code)
}

function parseRange(header: string, size: number): ByteRange {
  if (!header.startsWith('bytes=') || header.includes(',') || size === 0) {
    throw invalidRange(size)
  }
  const match = /^(\d*)-(\d*)$/.exec(header.slice('bytes='.length))
  if (match === null || (match[1] === '' && match[2] === '')) {
    throw invalidRange(size)
  }
  if (match[1] === '') {
    const suffix = Number(match[2])
    if (!Number.isSafeInteger(suffix) || suffix <= 0) throw invalidRange(size)
    return { start: Math.max(0, size - suffix), end: size - 1 }
  }
  const start = Number(match[1])
  const requestedEnd = match[2] === '' ? size - 1 : Number(match[2])
  if (!Number.isSafeInteger(start)
    || !Number.isSafeInteger(requestedEnd)
    || start < 0
    || requestedEnd < start
    || start >= size) {
    throw invalidRange(size)
  }
  return { start, end: Math.min(requestedEnd, size - 1) }
}

function invalidRange(size: number): HttpError {
  return new HttpError(416, 'invalid-range', { 'Content-Range': `bytes */${size}` })
}

function inlineDisposition(name: string): string {
  const ascii = name.replaceAll(/[^\x20-\x7E]/g, '_').replaceAll(/["\\]/g, '_')
  return `inline; filename=\"${ascii}\"; filename*=UTF-8''${encodeURIComponent(name)}`
}

function writeJson(
  res: ServerResponse,
  status: number,
  body: DocumentErrorBody,
  extraHeaders?: Readonly<Record<string, string>>,
): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'Cache-Control': 'no-store',
    'Content-Length': String(Buffer.byteLength(payload)),
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    ...extraHeaders,
  })
  res.end(payload)
}

function inspectOfficeArchive(archive: Buffer, config: Config): Promise<void> {
  return new Promise((resolveArchive, rejectArchive) => {
    yauzl.fromBuffer(archive, { lazyEntries: true }, (openError, zip) => {
      if (openError !== null) {
        rejectArchive(new HttpError(415, 'invalid-office-archive'))
        return
      }
      let settled = false
      let expandedBytes = 0
      const finish = (error?: HttpError): void => {
        /* v8 ignore next -- finish removes every listener before settling, so no later callback can re-enter it. */
        if (settled) return
        settled = true
        zip.removeAllListeners()
        try { zip.close() } catch {
          // yauzl may already have closed after a malformed central directory.
        }
        if (error === undefined) resolveArchive()
        else rejectArchive(error)
      }
      if (zip.entryCount > config.maxArchiveEntries) {
        finish(new HttpError(413, 'archive-too-large'))
        return
      }
      zip.once('error', () => { finish(new HttpError(415, 'invalid-office-archive')) })
      zip.once('end', () => { finish() })
      zip.on('entry', (entry: ZipEntry) => {
        if ((entry.generalPurposeBitFlag & 0x1) !== 0) {
          finish(new HttpError(415, 'encrypted-office-archive'))
          return
        }
        expandedBytes += entry.uncompressedSize
        if (expandedBytes > config.maxExpandedBytes) {
          finish(new HttpError(413, 'archive-too-large'))
          return
        }
        zip.readEntry()
      })
      zip.readEntry()
    })
  })
}
