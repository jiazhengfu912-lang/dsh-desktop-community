/**
 * Boot the packaged Electron main process through a hidden application window.
 * A temporary Harness home, Electron userData, and pnpm store/cache keep user
 * state out of the check while exercising packaged plugin installs with no
 * ambient DSH or pnpm command.
 */

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync,
} from 'node:fs'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { mergeProcessEnvironment, runStartupSmokeProcess } from './startup-smoke-process.mjs'

const DSHMARKET_VERSION = '1.15.0'
const MARKET_SMOKE_PACKAGE = '@dsh-desktop-community/market-smoke-plugin'
const MARKET_SMOKE_SOURCE = 'https://github.com/dsh-desktop-community/market-smoke-plugin'
const MARKET_SMOKE_VERSION = '1.0.0'
const PROCESS_TIMEOUT_MS = 120_000
const MAX_OUTPUT_BYTES = 4 * 1024 * 1024

const defaultUnpacked = fileURLToPath(new URL('../release/win-unpacked', import.meta.url))
const unpackedRoot = resolve(process.argv[2] ?? defaultUnpacked)
const executable = join(unpackedRoot, 'DSH Desktop Community.exe')
const appRoot = join(unpackedRoot, 'resources', 'app')
const pnpmManifestPath = join(appRoot, 'node_modules', 'pnpm', 'package.json')
const packagedInputs = [
  executable,
  join(appRoot, 'dist', 'main', 'plugin-cli.mjs'),
  join(appRoot, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'),
  pnpmManifestPath,
]
for (const filename of packagedInputs) {
  if (!existsSync(filename)) throw new Error(`packaged startup smoke: missing ${filename}`)
}
if (existsSync(join(appRoot, 'node_modules', 'dshmarket'))) {
  throw new Error('packaged startup smoke: dev-only dshmarket leaked into the production package')
}

const pnpmManifest = JSON.parse(readFileSync(pnpmManifestPath, 'utf8'))
const pnpmEntry = typeof pnpmManifest.bin === 'string' ? pnpmManifest.bin : pnpmManifest.bin?.pnpm
if (typeof pnpmEntry !== 'string' || pnpmEntry.length === 0 || pnpmEntry.includes('\0')) {
  throw new Error('packaged startup smoke: pnpm executable is not declared')
}
const pnpmPackageDir = dirname(pnpmManifestPath)
const pnpmBinPath = resolve(pnpmPackageDir, pnpmEntry)
const pnpmRelative = relative(pnpmPackageDir, pnpmBinPath)
if (pnpmRelative.length === 0 || pnpmRelative.startsWith('..') || isAbsolute(pnpmRelative)) {
  throw new Error('packaged startup smoke: pnpm executable escapes its package directory')
}
if (!existsSync(pnpmBinPath)) throw new Error(`packaged startup smoke: missing ${pnpmBinPath}`)

function runSetup(label, args, cwd, isolatedEnvironment) {
  const setup = spawnSync(process.execPath, [pnpmBinPath, ...args], {
    cwd,
    env: mergeProcessEnvironment(process.env, { ...isolatedEnvironment, CI: 'true' }),
    encoding: 'utf8',
    maxBuffer: MAX_OUTPUT_BYTES,
    windowsHide: true,
  })
  if (setup.error !== undefined) throw setup.error
  if (setup.status !== 0) {
    throw new Error(`${label} failed with exit ${String(setup.status)}\n${setup.stdout}\n${setup.stderr}`)
  }
  return setup.stdout
}

function writePluginFixture(directory, name, lifecycle = true) {
  mkdirSync(directory, { recursive: true })
  writeFileSync(join(directory, 'package.json'), JSON.stringify({
    name,
    version: MARKET_SMOKE_VERSION,
    type: 'module',
    main: 'index.js',
    ...(lifecycle ? { scripts: { install: 'node lifecycle.cjs' } } : {}),
    dsh: { bundle: { patch: './cordis.patch.yml' } },
  }, null, 2) + '\n')
  writeFileSync(join(directory, 'index.js'), 'export function apply() {}\n')
  writeFileSync(join(directory, 'cordis.patch.yml'), '[]\n')
  if (lifecycle) {
    writeFileSync(join(directory, 'lifecycle.cjs'), [
      "const { writeFileSync } = require('node:fs')",
      "const { join } = require('node:path')",
      "writeFileSync(join(__dirname, 'lifecycle-ran.txt'), 'completed\\n')",
      '',
    ].join('\n'))
  }
}

function fileSpec(directory) {
  return `file:${directory.replaceAll('\\', '/')}`
}

function copyPackage(source, destination) {
  cpSync(source, destination, {
    recursive: true,
    filter: current => !relative(source, current).split(/[\\/]/u).includes('node_modules'),
  })
}

function writePackageDependencies(directory, dependencies) {
  const manifestPath = join(directory, 'package.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  manifest.dependencies = dependencies
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n')
}

function stageDshmarketPackage(stageRoot) {
  const require = createRequire(import.meta.url)
  const manifestPath = realpathSync(require.resolve('dshmarket/package.json'))
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  if (manifest.version !== DSHMARKET_VERSION) {
    throw new Error(
      `packaged startup smoke: expected dshmarket ${DSHMARKET_VERSION}, got ${String(manifest.version)}`,
    )
  }
  const marketRequire = createRequire(manifestPath)
  const yamlManifest = realpathSync(marketRequire.resolve('js-yaml/package.json'))
  const undiciManifest = realpathSync(marketRequire.resolve('undici/package.json'))
  const argparseManifest = realpathSync(createRequire(yamlManifest).resolve('argparse/package.json'))
  const staged = {
    market: join(stageRoot, 'dshmarket'),
    yaml: join(stageRoot, 'js-yaml'),
    undici: join(stageRoot, 'undici'),
    argparse: join(stageRoot, 'argparse'),
  }
  copyPackage(dirname(manifestPath), staged.market)
  copyPackage(dirname(yamlManifest), staged.yaml)
  copyPackage(dirname(undiciManifest), staged.undici)
  copyPackage(dirname(argparseManifest), staged.argparse)
  writePackageDependencies(staged.market, {
    'js-yaml': fileSpec(staged.yaml),
    undici: fileSpec(staged.undici),
  })
  writePackageDependencies(staged.yaml, { argparse: fileSpec(staged.argparse) })
  return staged.market
}

function packMarketFixture(fixtureDir, packDir, isolatedEnvironment) {
  mkdirSync(packDir, { recursive: true })
  runSetup(
    'packaged startup smoke: market fixture pack',
    ['pack', '--pack-destination', packDir],
    fixtureDir,
    isolatedEnvironment,
  )
  const archives = readdirSync(packDir).filter(filename => filename.endsWith('.tgz'))
  if (archives.length !== 1) {
    throw new Error(`packaged startup smoke: expected one market fixture archive, found ${String(archives.length)}`)
  }
  return readFileSync(join(packDir, archives[0]))
}

function jsonResponse(response, status, value, headOnly) {
  const body = Buffer.from(JSON.stringify(value))
  response.writeHead(status, {
    'content-type': 'application/json',
    'content-length': String(body.length),
    'cache-control': 'no-store',
  })
  response.end(headOnly ? undefined : body)
}

async function startFixtureRegistry(tarball) {
  let origin = ''
  const integrity = `sha512-${createHash('sha512').update(tarball).digest('base64')}`
  const shasum = createHash('sha1').update(tarball).digest('hex')
  const server = createServer((request, response) => {
    const method = request.method ?? 'GET'
    const headOnly = method === 'HEAD'
    if (method !== 'GET' && !headOnly) {
      response.writeHead(405, { allow: 'GET, HEAD' })
      response.end()
      return
    }
    const url = new URL(request.url ?? '/', origin)
    let decodedPath
    try {
      decodedPath = decodeURIComponent(url.pathname)
    } catch {
      jsonResponse(response, 400, { error: 'invalid path encoding' }, headOnly)
      return
    }
    if (decodedPath === '/plugins.json') {
      jsonResponse(response, 200, {
        updated: '2026-08-20T00:00:00.000Z',
        count: 1,
        categories: { tools: { en: 'Tools', zh: '工具' } },
        plugins: [{
          name: 'DSH Desktop market smoke plugin',
          owner: 'DSH Desktop Community',
          url: MARKET_SMOKE_SOURCE,
          category: 'tools',
          description: { en: 'Offline route fixture', zh: '离线路由测试 fixture' },
          npm: MARKET_SMOKE_PACKAGE,
          install: `pnpm add ${MARKET_SMOKE_PACKAGE}`,
          added: '2026-08-20',
        }],
      }, headOnly)
      return
    }
    if (decodedPath === `/${MARKET_SMOKE_PACKAGE}`) {
      jsonResponse(response, 200, {
        name: MARKET_SMOKE_PACKAGE,
        'dist-tags': { latest: MARKET_SMOKE_VERSION },
        versions: {
          [MARKET_SMOKE_VERSION]: {
            name: MARKET_SMOKE_PACKAGE,
            version: MARKET_SMOKE_VERSION,
            dist: {
              tarball: `${origin}/tarballs/market-smoke-plugin-${MARKET_SMOKE_VERSION}.tgz`,
              integrity,
              shasum,
            },
          },
        },
      }, headOnly)
      return
    }
    if (decodedPath === `/tarballs/market-smoke-plugin-${MARKET_SMOKE_VERSION}.tgz`) {
      response.writeHead(200, {
        'content-type': 'application/octet-stream',
        'content-length': String(tarball.length),
        'cache-control': 'no-store',
      })
      response.end(headOnly ? undefined : tarball)
      return
    }
    jsonResponse(response, 404, { error: `fixture route not found: ${decodedPath}` }, headOnly)
  })
  await new Promise((resolveListen, rejectListen) => {
    const fail = error => { rejectListen(error) }
    server.once('error', fail)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', fail)
      resolveListen()
    })
  })
  const address = server.address()
  if (address === null || typeof address === 'string') {
    server.close()
    throw new Error('packaged startup smoke: local registry did not expose a TCP address')
  }
  origin = `http://127.0.0.1:${String(address.port)}`
  return { origin, server }
}

async function closeServer(server) {
  server.closeAllConnections?.()
  if (!server.listening) return
  await new Promise(resolveClose => { server.close(() => { resolveClose() }) })
}

const smokeRoot = mkdtempSync(join(tmpdir(), 'dsh-desktop-startup-'))
const dshHome = join(smokeRoot, '用户 dsh-home % path')
const userData = join(smokeRoot, '用户 electron-data % path')
const fixtureDir = join(smokeRoot, '插件 fixture & 100% path')
const gitFixtureDir = join(smokeRoot, 'Git fixture path')
const marketFixtureDir = join(smokeRoot, 'market registry fixture')
const packDir = join(smokeRoot, 'market package tarball')
const stagedMarketRoot = join(smokeRoot, 'offline dshmarket dependency graph')
const stagingStoreDir = join(smokeRoot, 'packaged pnpm staging store')
const stagingCacheDir = join(smokeRoot, 'packaged pnpm staging cache')
const stagingEnvironment = {
  npm_config_store_dir: stagingStoreDir,
  npm_config_cache: stagingCacheDir,
}
const profileDir = join(dshHome, 'profiles', 'web')
let registryServer
let result
let gitFixtureExpected = false

try {
  mkdirSync(dshHome)
  mkdirSync(userData)
  mkdirSync(stagingStoreDir)
  mkdirSync(stagingCacheDir)
  writePluginFixture(fixtureDir, 'dsh-desktop-smoke-plugin', false)
  writePluginFixture(gitFixtureDir, 'dsh-desktop-smoke-plugin', false)
  writePluginFixture(marketFixtureDir, MARKET_SMOKE_PACKAGE)
  writeFileSync(join(dshHome, 'settings.yaml'), [
    'llm-deepseek:',
    '  baseURL: https://desktop-reuse-smoke.invalid/v1',
    '',
  ].join('\n'))

  const dshmarketPackageDir = stageDshmarketPackage(stagedMarketRoot)
  mkdirSync(profileDir, { recursive: true })
  writeFileSync(join(profileDir, 'pnpm-workspace.yaml'), [
    'packages:',
    '  - .',
    '',
    'nodeLinker: hoisted',
    'autoInstallPeers: false',
    '',
  ].join('\n'))
  writeFileSync(join(profileDir, 'package.json'), JSON.stringify({
    name: 'dsh-profile-web-smoke',
    private: true,
    dependencies: {
      dshmarket: fileSpec(dshmarketPackageDir),
    },
    dsh: {
      profile: {
        bundles: [
          '@deepseek-ai/dsh-base',
          '@deepseek-ai/dsh-web-app',
          'dshmarket',
          'dsh-better-sidebar',
        ],
      },
    },
  }, null, 2) + '\n')
  runSetup(
    'packaged startup smoke: offline dshmarket staging',
    ['install', '--offline', '--ignore-scripts'],
    profileDir,
    stagingEnvironment,
  )

  const marketTarball = packMarketFixture(marketFixtureDir, packDir, stagingEnvironment)
  const registry = await startFixtureRegistry(marketTarball)
  registryServer = registry.server
  writeFileSync(
    join(profileDir, '.npmrc'),
    `registry=${registry.origin}/\n@dsh-desktop-community:registry=${registry.origin}/\n`,
  )

  const gitProbe = spawnSync('git', ['--version'], { encoding: 'utf8', windowsHide: true })
  let gitSmokeArgs = []
  if (gitProbe.status === 0) {
    const gitSetup = [
      ['init'],
      ['config', 'user.name', 'DSH Desktop Smoke'],
      ['config', 'user.email', 'desktop-smoke@example.invalid'],
      ['add', 'package.json', 'index.js', 'cordis.patch.yml'],
      ['commit', '-m', 'fixture'],
    ]
    for (const args of gitSetup) {
      const setup = spawnSync('git', ['-C', gitFixtureDir, ...args], {
        encoding: 'utf8',
        windowsHide: true,
      })
      if (setup.status !== 0) {
        throw new Error(
          `packaged startup smoke: Git fixture setup failed for ${args.join(' ')}\n`
          + `${setup.stdout}\n${setup.stderr}`,
        )
      }
    }
    const whereGit = spawnSync('where.exe', ['git'], { encoding: 'utf8', windowsHide: true })
    const gitExecutable = whereGit.status === 0
      ? whereGit.stdout.split(/\r?\n/u).map(value => value.trim()).find(Boolean)
      : undefined
    if (gitExecutable === undefined || !isAbsolute(gitExecutable)) {
      throw new Error('packaged startup smoke: Git is available but its executable directory was not resolved')
    }
    gitSmokeArgs = [
      `--smoke-git-plugin-runtime=git+${pathToFileURL(gitFixtureDir).href}`,
      `--smoke-git-plugin-directory=${dirname(gitExecutable)}`,
    ]
    gitFixtureExpected = true
  }

  const systemRoot = process.env.SystemRoot ?? 'C:\\Windows'
  const smokePath = join(systemRoot, 'System32')
  result = await runStartupSmokeProcess({
    executable,
    args: [
      `--user-data-dir=${userData}`,
      '--smoke-test',
      '--smoke-plugin-runtime',
      fixtureDir,
      '--smoke-market-http',
      ...gitSmokeArgs,
      '--smoke-plugin-inventory',
    ],
    env: mergeProcessEnvironment(process.env, {
      PATH: smokePath,
      DSH_HOME: dshHome,
      DSH_TELEMETRY_DISABLED: '1',
      DSHM_REGISTRY_URL: `${registry.origin}/plugins.json`,
      NO_PROXY: '127.0.0.1,localhost',
      no_proxy: '127.0.0.1,localhost',
    }),
    timeoutMs: PROCESS_TIMEOUT_MS,
    maxOutputBytes: MAX_OUTPUT_BYTES,
  })
} finally {
  if (registryServer !== undefined) await closeServer(registryServer)
  const expectedPrefix = 'dsh-desktop-startup-'
  if (resolve(smokeRoot).startsWith(resolve(tmpdir())) && basename(smokeRoot).startsWith(expectedPrefix)) {
    rmSync(smokeRoot, { recursive: true, force: true })
  }
}

if (result === undefined) throw new Error('packaged startup smoke: desktop process was not launched')
if (result.stdout) process.stdout.write(result.stdout)
if (result.stderr) process.stderr.write(result.stderr)
if (result.timedOut) throw new Error(`packaged startup smoke timed out after ${String(PROCESS_TIMEOUT_MS)}ms`)
if (result.status !== 0) {
  throw new Error(
    `packaged startup smoke exited ${String(result.status)} signal=${String(result.signal)}`,
  )
}
if (!result.stdout.includes('DESKTOP_STARTUP_OK')) {
  throw new Error('packaged startup smoke: success sentinel missing')
}
if (!result.stdout.includes('DESKTOP_PLUGIN_RUNTIME_OK package=dsh-desktop-smoke-plugin')) {
  throw new Error('packaged startup smoke: plugin runtime sentinel missing')
}
if (!result.stdout.includes(`DESKTOP_MARKET_HTTP_INSTALL_OK package=${MARKET_SMOKE_PACKAGE}`)) {
  throw new Error('packaged startup smoke: market HTTP install sentinel missing')
}
if (!result.stdout.includes('DESKTOP_PLUGIN_INVENTORY_OK entries=')) {
  throw new Error('packaged startup smoke: plugin inventory sentinel missing')
}
if (!result.stdout.includes('DESKTOP_PLUGIN_GIT_PREREQUISITE_OK')) {
  throw new Error('packaged startup smoke: missing-Git prerequisite sentinel missing')
}
if (gitFixtureExpected
  && !result.stdout.includes('DESKTOP_GIT_PLUGIN_RUNTIME_OK package=dsh-desktop-smoke-plugin')) {
  throw new Error('packaged startup smoke: git+file plugin sentinel missing')
}
if (!result.stdout.includes('DESKTOP_DATA_REUSE_OK session=desktop-data-reuse-smoke profile=web settings=llm-deepseek')) {
  throw new Error('packaged startup smoke: DSH_HOME data reuse sentinel missing')
}
