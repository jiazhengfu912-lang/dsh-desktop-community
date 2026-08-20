/**
 * Run both shipped worker-thread implementations through the packaged Electron
 * runtime. This verifies the electron-builder directory, package resolution,
 * sibling worker files, and a real host-to-worker dispatch without opening a
 * GUI or requiring credentials.
 */

import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { extname, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const defaultUnpacked = fileURLToPath(new URL('../release/win-unpacked', import.meta.url))
const unpackedRoot = resolve(process.argv[2] ?? defaultUnpacked)
const executable = join(unpackedRoot, 'DSH Desktop Community.exe')
const appRoot = join(unpackedRoot, 'resources', 'app')
const appPackage = join(appRoot, 'package.json')

for (const file of [executable, appPackage]) {
  if (!existsSync(file)) throw new Error(`packaged worker smoke: missing ${file}`)
}

const forbiddenBrandPackages = [
  'dsh-client-ui-brand-official',
  'dsh-skill-badge',
  'dsh-web-frontend',
]
for (const packageName of forbiddenBrandPackages) {
  const packagePath = join(appRoot, 'node_modules', '@deepseek-ai', packageName)
  if (existsSync(packagePath)) {
    throw new Error(`packaged brand closure: forbidden package is present at ${packagePath}`)
  }
}

const textExtensions = new Set([
  '.cjs', '.css', '.html', '.js', '.json', '.md', '.mjs', '.svg', '.txt', '.yaml', '.yml',
])
const forbiddenArtifactNames = new Set(['dsh-badge.png'])
const forbiddenArtifactText = ['logo=deepseek']
const inspectForbiddenArtifacts = (directory) => {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const child = join(directory, entry.name)
    if (entry.isDirectory()) {
      inspectForbiddenArtifacts(child)
      continue
    }
    if (!entry.isFile()) continue
    if (forbiddenArtifactNames.has(entry.name)) {
      throw new Error(`packaged brand closure: forbidden artwork remains in ${relative(appRoot, child)}`)
    }
    if (!textExtensions.has(extname(entry.name).toLowerCase())) continue
    const contents = readFileSync(child, 'utf8')
    for (const token of forbiddenArtifactText) {
      if (contents.includes(token)) {
        throw new Error(
          `packaged brand closure: ${JSON.stringify(token)} remains in ${relative(appRoot, child)}`,
        )
      }
    }
  }
}
inspectForbiddenArtifacts(appRoot)

const productTextRoots = [
  join(appRoot, 'dist', 'renderer'),
  join(appRoot, 'config'),
  join(appRoot, 'desktop.patch.yml'),
]
const productTextFiles = []
const collectProductText = (path) => {
  if (!existsSync(path)) throw new Error(`packaged brand closure: missing text root ${path}`)
  const entries = readdirSync(path, { withFileTypes: true })
  for (const entry of entries) {
    const child = join(path, entry.name)
    if (entry.isDirectory()) collectProductText(child)
    else if (entry.isFile() && textExtensions.has(extname(entry.name).toLowerCase())) {
      productTextFiles.push(child)
    }
  }
}
for (const path of productTextRoots) {
  if (extname(path) === '') collectProductText(path)
  else if (existsSync(path)) productTextFiles.push(path)
  else throw new Error(`packaged brand closure: missing text root ${path}`)
}

const forbiddenProductText = ['FishLogo', 'dsh-wordmark-whale', 'DeepSeek Harness']
for (const file of productTextFiles) {
  const contents = readFileSync(file, 'utf8')
  for (const token of forbiddenProductText) {
    if (contents.includes(token)) {
      throw new Error(
        `packaged brand closure: ${JSON.stringify(token)} remains in ${relative(appRoot, file)}`,
      )
    }
  }
}
console.log(`DESKTOP_BRAND_CLOSURE_OK files=${String(productTextFiles.length)}`)

const driver = `
import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'

const require = createRequire(${JSON.stringify(pathToFileURL(appPackage).href)})
const load = async (name) => await import(pathToFileURL(require.resolve(name)).href)

const documentViewerHost = require.resolve('@deepseek-ai/dsh-document-viewer')
const documentViewerClient = require.resolve('@deepseek-ai/dsh-document-viewer/client')
const betterSidebarHost = require.resolve('dsh-better-sidebar')
const betterSidebarClient = require.resolve('dsh-better-sidebar/client')
if (!documentViewerHost.replaceAll('\\\\', '/').endsWith('lib/index.js')
  || !documentViewerClient.replaceAll('\\\\', '/').endsWith('lib/client.js')
  || !betterSidebarHost.replaceAll('\\\\', '/').endsWith('lib/index.js')
  || !betterSidebarClient.replaceAll('\\\\', '/').endsWith('lib/client.js')) {
  throw new Error('desktop document artifacts missing: ' + JSON.stringify({
    documentViewerHost,
    documentViewerClient,
    betterSidebarHost,
    betterSidebarClient,
  }))
}
const documentViewer = await load('@deepseek-ai/dsh-document-viewer')
if (documentViewer.name !== 'document-viewer') throw new Error('document viewer host entry failed to load')
const betterSidebar = await load('dsh-better-sidebar')
if (betterSidebar.name !== 'dsh-better-sidebar') throw new Error('Better Sidebar host entry failed to load')

const { Context } = await load('@deepseek-ai/cordis')
const { WorkerThreadCodeRuntime } = await load('@deepseek-ai/dsh-code-runtime-worker-thread')

const codeCtx = new Context()
await codeCtx.plugin(WorkerThreadCodeRuntime, {})
const codeResult = await codeCtx.codeRuntime.run({ program: 'return 6 * 7', bindings: [] })
if (codeResult.value !== 42 || codeResult.error !== undefined) {
  throw new Error('code worker failed: ' + JSON.stringify(codeResult))
}
await codeCtx.fiber.dispose()

const { default: SubagentRuntime } = await load('@deepseek-ai/dsh-subagent')
const { default: WorkflowEngine } = await load('@deepseek-ai/dsh-workflow-worker-thread')

const workflowCtx = new Context()
await workflowCtx.plugin(SubagentRuntime)
let starts = 0
workflowCtx.subagents.registerProvider({
  name: 'packaged-smoke',
  capabilities: { outputSchema: true, depthLimit: false, toolFilter: false, persona: false },
  inheritsParentContext: false,
  async start() {
    starts += 1
    return {
      id: 'child',
      result: Promise.resolve({ output: [], structured: { answer: 42 }, stopReason: 'completed' }),
      dispose: () => Promise.resolve(),
    }
  },
})
await workflowCtx.plugin(WorkflowEngine, { provider: 'unused' })
const run = workflowCtx.workflowEngine.start({
  script: "const value = await agent('answer', { schema: { type: 'object', properties: { answer: { type: 'number' } }, required: ['answer'] } }); return value.answer",
  meta: { name: 'packaged-smoke', description: 'packaged worker dispatch' },
  subagentProvider: 'packaged-smoke',
  parent: { id: 'parent', options: {} },
})
const workflowResult = await run.result
await run.dispose()
await workflowCtx.fiber.dispose()
if (workflowResult.stopReason !== 'completed' || workflowResult.value !== 42 || starts !== 1) {
  throw new Error('workflow worker failed: ' + JSON.stringify({ workflowResult, starts }))
}
console.log('PACKAGED_WORKERS_OK code=42 workflow=42 document-viewer=host+client better-sidebar=host+client electron=' + process.versions.electron)
`

const result = spawnSync(executable, ['--input-type=module', '-e', driver], {
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  encoding: 'utf8',
  timeout: 60_000,
  maxBuffer: 1024 * 1024,
  windowsHide: true,
})

if (result.stdout) process.stdout.write(result.stdout)
if (result.stderr) process.stderr.write(result.stderr)
if (result.error !== undefined) throw result.error
if (result.status !== 0) throw new Error(`packaged worker smoke exited ${String(result.status)}`)
if (!result.stdout.includes('PACKAGED_WORKERS_OK code=42 workflow=42')) {
  throw new Error('packaged worker smoke: success sentinel missing')
}
