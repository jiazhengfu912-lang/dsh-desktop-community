/** Create deterministic companion metadata for the Windows release asset. */

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const desktopRoot = fileURLToPath(new URL('..', import.meta.url))
const repositoryRoot = resolve(desktopRoot, '../..')
const releaseRoot = resolve(process.argv[2] ?? join(desktopRoot, 'release'))
const installerName = 'DSH-Desktop-Community-Setup-x64.exe'
const installerPath = join(releaseRoot, installerName)

function readJson(filename) {
  return JSON.parse(readFileSync(filename, 'utf8'))
}

function desktopDependencyVersion(packageName) {
  return readJson(join(desktopRoot, 'node_modules', packageName, 'package.json')).version
}

const installer = readFileSync(installerPath)
const sha256 = createHash('sha256').update(installer).digest('hex').toUpperCase()
const desktopManifest = readJson(join(desktopRoot, 'package.json'))
const repositoryManifest = readJson(join(repositoryRoot, 'package.json'))
const communityCommit = execFileSync('git', ['rev-parse', 'HEAD'], {
  cwd: repositoryRoot,
  encoding: 'utf8',
}).trim()
const upstreamCommit = readFileSync(join(repositoryRoot, 'UPSTREAM_BASE'), 'utf8').trim()
for (const [label, commit] of Object.entries({ communityCommit, upstreamCommit })) {
  if (!/^[0-9a-f]{40}$/iu.test(commit)) {
    throw new Error(`release metadata: ${label} is not a full Git commit ID`)
  }
}

writeFileSync(join(releaseRoot, 'SHA256SUMS.txt'), `${sha256}  ${installerName}\n`)
writeFileSync(join(releaseRoot, 'build-info.json'), JSON.stringify({
  product: desktopManifest.productName,
  version: desktopManifest.version,
  unsigned: true,
  communityCommit,
  upstreamCommit,
  repositoryVersion: repositoryManifest.version,
  nodeVersion: process.versions.node,
  electronVersion: desktopDependencyVersion('electron'),
  pnpmVersion: desktopDependencyVersion('pnpm'),
  platform: 'win32',
  arch: 'x64',
  installer: {
    name: installerName,
    bytes: installer.byteLength,
    sha256,
  },
}, null, 2) + '\n')

console.log(`DESKTOP_RELEASE_METADATA_OK sha256=${sha256} commit=${communityCommit}`)
