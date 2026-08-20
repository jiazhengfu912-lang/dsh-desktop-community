import { Context } from '@deepseek-ai/cordis'
import WebServer from '@deepseek-ai/dsh-host-webserver'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { get as httpGet } from 'node:http'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { afterEach, describe, expect, it } from 'vitest'
import {
  Config, apply, inject, name, type Config as DocumentViewerConfig,
} from '../src/index.ts'
import { mapFilesystemError } from '../src/filesystem-error.ts'
import { isWithin } from '../src/path-containment.ts'
import type { DocumentErrorBody } from '../src/types.ts'

const DEFAULTS: DocumentViewerConfig = {
  maxFileBytes: 64 * 1024 * 1024,
  maxExpandedBytes: 256 * 1024 * 1024,
  maxArchiveEntries: 4096,
}

const cleanups: (() => Promise<void>)[] = []

afterEach(async () => {
  await Promise.all(cleanups.splice(0).map(cleanup => cleanup()))
})

async function bench(overrides: Partial<DocumentViewerConfig> = {}) {
  const root = await mkdtemp(join(tmpdir(), 'dsh-document-viewer-'))
  const id = WorkspaceId('workspace-test')
  const workspace = {
    id,
    path: root,
    title: 'Documents',
    createdAt: '',
    updatedAt: '',
    sessionIds: [],
  }
  const ctx = new Context()
  ctx.provide('workspaceRegistry', {
    get: (candidate: string) => {
      if (candidate === 'throws-error') throw new Error('registry failed')
      if (candidate === 'throws-value') throw Object.create(null)
      return candidate === id ? workspace : undefined
    },
  } as never)
  const webFiber = ctx.plugin(WebServer, { host: '127.0.0.1', port: 0 })
  await webFiber.await()
  const pluginFiber = ctx.plugin({ name, inject, Config, apply }, {
    maxFileBytes: overrides.maxFileBytes ?? DEFAULTS.maxFileBytes,
    maxExpandedBytes: overrides.maxExpandedBytes ?? DEFAULTS.maxExpandedBytes,
    maxArchiveEntries: overrides.maxArchiveEntries ?? DEFAULTS.maxArchiveEntries,
  })
  await pluginFiber.await()
  const base = `http://127.0.0.1:${ctx.webServer.port}`
  const url = (path: string, workspaceId: string = id): string => {
    const query = new URLSearchParams({ workspaceId, path })
    return `${base}/document-viewer/content?${query.toString()}`
  }
  cleanups.push(async () => {
    await ctx.fiber.dispose()
    await rm(root, { recursive: true, force: true })
  })
  return { root, ctx, pluginFiber, workspace, base, url }
}

async function json<T>(response: Response): Promise<T> {
  return await response.json() as T
}

describe('document viewer host routes', () => {
  it('serves full, HEAD, conditional, and single-range PDF responses', async () => {
    const { root, url } = await bench()
    await writeFile(join(root, 'sample.PDF'), Buffer.from('0123456789'))

    const full = await fetch(url('sample.PDF'))
    expect(full.status).toBe(200)
    expect(full.headers.get('content-type')).toBe('application/pdf')
    expect(full.headers.get('accept-ranges')).toBe('bytes')
    expect(full.headers.get('x-content-type-options')).toBe('nosniff')
    expect(await full.text()).toBe('0123456789')

    const range = await fetch(url('sample.PDF'), { headers: { Range: 'bytes=2-5' } })
    expect(range.status).toBe(206)
    expect(range.headers.get('content-range')).toBe('bytes 2-5/10')
    expect(await range.text()).toBe('2345')

    const suffix = await fetch(url('sample.PDF'), { headers: { Range: 'bytes=-3' } })
    expect(await suffix.text()).toBe('789')
    expect(await (await fetch(url('sample.PDF'), { headers: { Range: 'bytes=-30' } })).text()).toBe('0123456789')
    expect(await (await fetch(url('sample.PDF'), { headers: { Range: 'bytes=7-' } })).text()).toBe('789')
    expect(await (await fetch(url('sample.PDF'), { headers: { Range: 'bytes=7-30' } })).text()).toBe('789')

    const head = await fetch(url('sample.PDF'), { method: 'HEAD' })
    expect(head.status).toBe(200)
    expect(head.headers.get('content-length')).toBe('10')
    expect(await head.text()).toBe('')

    const cached = await fetch(url('sample.PDF'), {
      headers: { 'If-None-Match': full.headers.get('etag') ?? '' },
    })
    expect(cached.status).toBe(304)

    const unsatisfied = await fetch(url('sample.PDF'), { headers: { Range: 'bytes=8-3' } })
    expect(unsatisfied.status).toBe(416)
    expect(unsatisfied.headers.get('content-range')).toBe('bytes */10')
    expect((await fetch(url('sample.PDF'), { headers: { Range: 'bytes=0-1,4-5' } })).status).toBe(416)
    for (const invalid of ['items=0-1', 'bytes=-', 'bytes=-0', 'bytes=x-y', 'bytes=10-', `bytes=${'9'.repeat(30)}-`]) {
      expect((await fetch(url('sample.PDF'), { headers: { Range: invalid } })).status).toBe(416)
    }

    await writeFile(join(root, 'empty.pdf'), '')
    expect((await fetch(url('empty.pdf'))).status).toBe(200)
    expect((await fetch(url('empty.pdf'), { headers: { Range: 'bytes=0-' } })).status).toBe(416)

    await writeFile(join(root, '报告.md'), '# 文档')
    const named = await fetch(url('报告.md'))
    expect(named.headers.get('content-disposition')).toContain('filename="__.md"')
    expect(named.headers.get('content-disposition')).toContain("filename*=UTF-8''%E6%8A%A5%E5%91%8A.md")
  })

  it('rejects invalid workspaces, methods, formats, traversal, and links without leaking paths', async () => {
    const { root, base, workspace, url } = await bench()
    await writeFile(join(root, 'plain.txt'), 'no')
    await writeFile(join(root, 'target.pdf'), 'pdf')
    const link = join(root, 'linked.pdf')
    let linked = true
    try {
      await symlink(join(root, 'target.pdf'), link, 'file')
    } catch {
      linked = false
    }

    expect((await fetch(url('target.pdf', 'missing'))).status).toBe(404)
    expect((await fetch(url('plain.txt'))).status).toBe(415)
    expect((await fetch(url('missing.pdf'))).status).toBe(404)
    expect((await fetch(url('target'))).status).toBe(415)
    expect((await fetch(url('../target.pdf'))).status).toBe(400)
    expect((await fetch(url('C:/target.pdf'))).status).toBe(400)
    for (const invalid of ['', '\0.pdf', '\\target.pdf', '/target.pdf', 'a//target.pdf', './target.pdf', 'a/../target.pdf', '%2f.pdf']) {
      expect((await fetch(url(invalid))).status).toBe(400)
    }
    expect((await fetch(url('target.pdf'), { method: 'POST' })).status).toBe(400)
    expect((await fetch(`${base}/document-viewer/content?workspaceId=workspace-test`)).status).toBe(400)
    expect((await fetch(`${base}/document-viewer/content?workspaceId=workspace-test&path=a.pdf&path=b.pdf`)).status).toBe(400)
    expect((await fetch(`${base}/document-viewer/list?workspaceId=workspace-test&path=`)).status).toBe(404)
    if (linked) expect((await fetch(url('linked.pdf'))).status).toBe(403)

    const linkedDirectory = join(root, 'linked-dir')
    await mkdir(join(root, 'target-dir'))
    await writeFile(join(root, 'target-dir', 'nested.pdf'), 'pdf')
    await symlink(join(root, 'target-dir'), linkedDirectory, 'junction')
    expect((await fetch(url('linked-dir/nested.pdf'))).status).toBe(403)

    await mkdir(join(root, 'folder.pdf'))
    expect((await fetch(url('folder.pdf'))).status).toBe(404)
    workspace.path = join(root, 'target.pdf')
    expect((await fetch(url('target.pdf'))).status).toBe(403)
    workspace.path = join(root, 'gone')
    expect((await fetch(url('target.pdf'))).status).toBe(404)
    workspace.path = root
    expect((await fetch(url('target.pdf', 'throws-error'))).status).toBe(500)
    expect((await fetch(url('target.pdf', 'throws-value'))).status).toBe(500)

    const failure = await json<DocumentErrorBody>(await fetch(url('../target.pdf')))
    expect(failure).toEqual({ code: 'invalid-path' })
    expect(JSON.stringify(failure)).not.toContain(root)
  })

  it('preflights Office archives and applies file, entry, expansion, and encryption limits', async () => {
    const { root, url } = await bench({
      maxFileBytes: 1024,
      maxArchiveEntries: 1,
      maxExpandedBytes: 32,
    })
    await writeFile(join(root, 'valid.docx'), zip([{ name: '[Content_Types].xml', data: Buffer.from('<Types/>') }]))
    await writeFile(join(root, 'entries.docx'), zip([
      { name: 'a.xml', data: Buffer.from('a') },
      { name: 'b.xml', data: Buffer.from('b') },
    ]))
    await writeFile(join(root, 'expanded.pptx'), zip([
      { name: 'ppt/presentation.xml', data: Buffer.alloc(33) },
    ]))
    await writeFile(join(root, 'encrypted.docx'), zip([
      { name: 'word/document.xml', data: Buffer.alloc(13), declaredSize: 1, flags: 1 },
    ]))
    await writeFile(join(root, 'broken.docx'), 'not-a-zip')
    const corrupt = zip([{ name: 'word/document.xml', data: Buffer.from('x') }])
    corrupt.writeUInt32LE(0, corrupt.indexOf(Buffer.from([0x50, 0x4B, 0x01, 0x02])))
    await writeFile(join(root, 'corrupt.docx'), corrupt)
    await writeFile(join(root, 'large.pdf'), Buffer.alloc(1025))

    expect((await fetch(url('valid.docx'))).status).toBe(200)
    expect((await fetch(url('entries.docx'))).status).toBe(413)
    expect((await fetch(url('expanded.pptx'))).status).toBe(413)
    const encrypted = await fetch(url('encrypted.docx'))
    expect(encrypted.status).toBe(415)
    expect(await json<DocumentErrorBody>(encrypted)).toEqual({ code: 'encrypted-office-archive' })
    expect((await fetch(url('broken.docx'))).status).toBe(415)
    expect((await fetch(url('corrupt.docx'))).status).toBe(415)
    expect((await fetch(url('large.pdf'))).status).toBe(413)
  })

  it('closes a response whose client disconnects after headers', async () => {
    const { root, url } = await bench({ maxFileBytes: 8 * 1024 * 1024 })
    await writeFile(join(root, 'large.pdf'), Buffer.alloc(4 * 1024 * 1024, 1))
    await new Promise<void>((resolveRequest, rejectRequest) => {
      const request = httpGet(url('large.pdf'), (response) => {
        response.once('data', () => {
          response.destroy()
          resolveRequest()
        })
        response.once('error', rejectRequest)
      })
      request.once('error', rejectRequest)
    })
    await delay(20)
  })

  it('removes the content route when the plugin fiber unloads', async () => {
    const { root, pluginFiber, url } = await bench()
    await writeFile(join(root, 'sample.pdf'), 'pdf')
    expect((await fetch(url('sample.pdf'))).status).toBe(200)
    await pluginFiber.dispose()
    expect((await fetch(url('sample.pdf'))).status).toBe(404)
  })

  it('normalizes filesystem errors without retaining host messages', () => {
    expect(mapFilesystemError({ code: 'ENOENT' })).toEqual({ status: 404, code: 'document-not-found' })
    expect(mapFilesystemError({ code: 'ENOTDIR' })).toEqual({ status: 404, code: 'document-not-found' })
    expect(mapFilesystemError({ code: 'EACCES' })).toEqual({ status: 403, code: 'forbidden-path' })
    expect(mapFilesystemError({ code: 'EPERM' })).toEqual({ status: 403, code: 'forbidden-path' })
    expect(mapFilesystemError(new Error('private absolute path'))).toEqual({ status: 500, code: 'filesystem-error' })
  })

  it('checks canonical path containment without accepting siblings or parents', () => {
    const parent = resolve('document-viewer-containment')
    const root = join(parent, 'workspace')
    expect(isWithin(root, root)).toBe(true)
    expect(isWithin(root, join(root, 'docs', 'a.pdf'))).toBe(true)
    expect(isWithin(root, join(parent, 'workspace-other'))).toBe(false)
    expect(isWithin(root, parent)).toBe(false)
  })
})

interface ZipFixtureEntry {
  name: string
  data: Buffer
  flags?: number
  declaredSize?: number
}

function zip(entries: ZipFixtureEntry[]): Buffer {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const entry of entries) {
    const name = Buffer.from(entry.name)
    const flags = entry.flags ?? 0
    const declaredSize = entry.declaredSize ?? entry.data.length
    const crc = crc32(entry.data)
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(flags, 6)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(entry.data.length, 18)
    local.writeUInt32LE(declaredSize, 22)
    local.writeUInt16LE(name.length, 26)
    locals.push(local, name, entry.data)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(flags, 8)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(entry.data.length, 20)
    central.writeUInt32LE(declaredSize, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt32LE(offset, 42)
    centrals.push(central, name)
    offset += local.length + name.length + entry.data.length
  }
  const centralDirectory = Buffer.concat(centrals)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(centralDirectory.length, 12)
  end.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, centralDirectory, end])
}

function crc32(input: Buffer): number {
  let crc = 0xFFFFFFFF
  for (const byte of input) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0)
    }
  }
  return (crc ^ 0xFFFFFFFF) >>> 0
}
