// Browser acceptance for the desktop-only document-viewer composition. The
// scenario applies a test overlay over the shipped Web tree instead of adding
// the plugin to the shared Web profile.
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Browser, Page } from 'playwright'
import { chromium } from 'playwright'
import { Document, Packer, Paragraph } from 'docx'
import PptxGenJS from 'pptxgenjs'
import { afterAll, beforeAll, describe, expect, it, onTestFailed } from 'vitest'
import {
  assertFixtureInventory, captureStableAria, compareOrRefreshGolden,
  launchWebScaffold, watchConsole, webSnapshotMode, type WebScaffold,
} from './scaffold.ts'
import { connectFreshWorkspace, newEnglishPage, saveFailureShot } from './support.ts'

const OVERLAY = fileURLToPath(new URL('../../desktop/tests/document-viewer.overlay.yml', import.meta.url))
const DESKTOP_MANIFEST = fileURLToPath(new URL('../../desktop/package.json', import.meta.url))
const SNAPSHOT_DIR = fileURLToPath(new URL('./snapshots/document-viewer', import.meta.url))
const UI_EXPECTED = join(SNAPSHOT_DIR, 'ui.expected.md')
const MODE = webSnapshotMode()

describe('web e2e: desktop document viewer', () => {
  let scaffold: WebScaffold
  let browser: Browser
  let page: Page
  let tripwire: ReturnType<typeof watchConsole>

  beforeAll(async () => {
    scaffold = await launchWebScaffold({
      extraOverlayPath: OVERLAY,
      resolverAnchor: DESKTOP_MANIFEST,
    })
    const workspace = join(scaffold.workspaceCwd, 'workspace')
    await mkdir(workspace, { recursive: true })
    const docx = await Packer.toBuffer(new Document({
      sections: [{ children: [new Paragraph('DOCX Preview Marker')] }],
    }))
    const pptx = new PptxGenJS()
    pptx.addSlide().addText('PPTX Preview Marker', { x: 1, y: 1, w: 5, h: 1 })
    const pptxBytes = await pptx.write({ outputType: 'nodebuffer' })
    await Promise.all([
      writeFile(join(workspace, 'README.md'), '# Workspace Preview\n\n- GFM item\n\n$E = mc^2$\n'),
      writeFile(join(workspace, 'sample.pdf'), '%PDF-1.4\n% document-viewer fixture\n'),
      writeFile(join(workspace, 'sample.docx'), docx),
      writeFile(join(workspace, 'sample.pptx'), Buffer.from(pptxBytes as Uint8Array)),
    ])
    const executablePath = process.env.DSH_PLAYWRIGHT_EXECUTABLE_PATH
    browser = await chromium.launch(executablePath === undefined ? {} : { executablePath })
    page = await newEnglishPage(browser)
    tripwire = watchConsole(page)
    await page.goto(scaffold.baseUrl, { waitUntil: 'load' })
    await page.waitForSelector('[class*="frame"]', { timeout: 30_000 })
    await connectFreshWorkspace(page, scaffold.workspaceCwd)
  }, 120_000)

  afterAll(async () => {
    await browser?.close()
    await scaffold?.close()
  })

  it('opens Markdown from the existing Better Sidebar file tree', async () => {
    onTestFailed(() => saveFailureShot(page, 'web-e2e-document-viewer'))
    const expand = page.getByRole('button', { name: 'Expand sidebar' })
    await expand.waitFor({ timeout: 15_000 })
    await expand.click()
    const sidebar = page.locator('[data-dsh-better-sidebar]')
    const markdownFile = sidebar.getByRole('button', { name: /README\.md/ }).first()
    await markdownFile.waitFor({ timeout: 15_000 })
    await markdownFile.click()
    const viewer = sidebar.locator('[data-document-viewer="README.md"]')
    await viewer.getByRole('heading', { name: 'Workspace Preview' }).waitFor({ timeout: 15_000 })

    const sidebarSnapshot = await captureStableAria(page, '[data-dsh-better-sidebar]', scaffold.workspaceCwd)
    await compareOrRefreshGolden(
      UI_EXPECTED,
      `## Better Sidebar document preview\n\n${sidebarSnapshot}`,
      MODE,
    )

    await page.setViewportSize({ width: 680, height: 800 })
    const viewerWidth = await viewer.evaluate(element => element.getBoundingClientRect().width)
    expect(viewerWidth).toBeGreaterThan(300)
    expect(tripwire.pageErrors).toEqual([])
    expect(tripwire.warnings).toEqual([])
  }, 60_000)

  it('uses the same-origin sandboxed PDF frame and keeps fixture inventory closed', async () => {
    await page.setViewportSize({ width: 1280, height: 900 })
    const sidebar = page.locator('[data-dsh-better-sidebar]')
    await sidebar.getByRole('button', { name: /sample\.pdf/ }).first().click()
    const frame = sidebar.locator('iframe[title="sample.pdf"]')
    await frame.waitFor({ timeout: 15_000 })
    expect(await frame.getAttribute('sandbox')).toBe('allow-same-origin')
    const source = new URL((await frame.getAttribute('src'))!, scaffold.baseUrl)
    expect(source.origin).toBe(new URL(scaffold.baseUrl).origin)
    expect(source.pathname).toBe('/document-viewer/content')
    expect(source.searchParams.get('path')).toBe('sample.pdf')
    expect(source.searchParams.get('workspaceId')).not.toBeNull()
    await assertFixtureInventory(SNAPSHOT_DIR, ['ui.expected.md'])
  }, 60_000)

  it('renders DOCX and PPTX through the registered Better Sidebar viewer', async () => {
    const sidebar = page.locator('[data-dsh-better-sidebar]')
    await sidebar.getByRole('button', { name: /sample\.docx/ }).first().click()
    const docxViewer = sidebar.locator('[data-document-viewer="sample.docx"]')
    await docxViewer.getByText('DOCX Preview Marker').waitFor({ timeout: 15_000 })
    expect(await docxViewer.locator('[data-ready="true"]').count()).toBe(1)

    await sidebar.getByRole('button', { name: /sample\.pptx/ }).first().click()
    const pptxViewer = sidebar.locator('[data-document-viewer="sample.pptx"]')
    await pptxViewer.locator('[data-ready="true"]').waitFor({ timeout: 15_000 })
    await pptxViewer.getByText('PPTX Preview Marker').waitFor({ timeout: 15_000 })
    expect(tripwire.pageErrors).toEqual([])
  }, 60_000)
})
