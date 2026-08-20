/** Prepare electron-builder's pinned Windows resource-editing toolchain without symlink privileges. */

import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  constants,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { createRequire } from 'node:module'
import { basename, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const WINDOWS_CODE_SIGN_ARTIFACT = Object.freeze({
  electronBuilderVersion: '25.1.8',
  version: '2.6.0',
  url: 'https://github.com/electron-userland/electron-builder-binaries/releases/download/winCodeSign-2.6.0/winCodeSign-2.6.0.7z',
  sha512: 'E8B408D9DF413C2DD7B346684D07B5A37B4F880DBC73BF8F63AF50F62FE90FC958E39A6C32D1EE2F0BF7BD1724895AF7671D5C6CDC8B94147C493C0275C1F0B4',
  requiredFiles: [
    'rcedit-x64.exe',
    join('windows-10', 'x64', 'signtool.exe'),
  ],
})

/**
 * Return an uppercase SHA-512 digest.
 * @param {NodeJS.ArrayBufferView} value Bytes to hash.
 * @returns {string} Uppercase hexadecimal digest.
 */
export function sha512Hex(value) {
  return createHash('sha512').update(value).digest('hex').toUpperCase()
}

/**
 * Resolve the cache directory used by electron-builder on Windows.
 * @param {{ cacheOverride?: string, localAppData?: string }} environment Cache inputs.
 * @returns {string} Absolute cache directory.
 */
export function resolveElectronBuilderCache({ cacheOverride, localAppData }) {
  if (cacheOverride !== undefined && cacheOverride.trim().length !== 0) return resolve(cacheOverride)
  if (localAppData === undefined || localAppData.trim().length === 0) {
    throw new Error('winCodeSign cache: LOCALAPPDATA is unavailable')
  }
  return resolve(localAppData, 'electron-builder', 'Cache')
}

/**
 * List required toolchain files that are absent or empty.
 * @param {string} root Extracted winCodeSign root.
 * @param {(filename: string) => boolean} isUsableFile File predicate for tests and the filesystem implementation.
 * @returns {string[]} Missing relative paths.
 */
export function missingToolchainFiles(root, isUsableFile) {
  return WINDOWS_CODE_SIGN_ARTIFACT.requiredFiles.filter(filename => !isUsableFile(join(root, filename)))
}

/**
 * Reject cleanup paths outside the dedicated cache parent.
 * @param {string} temporaryDirectory Candidate directory.
 * @param {string} cacheParent Dedicated winCodeSign cache parent.
 * @returns {void}
 */
export function assertSafeTemporaryDirectory(temporaryDirectory, cacheParent) {
  const resolvedTemporary = resolve(temporaryDirectory)
  const resolvedParent = resolve(cacheParent)
  const relativePath = relative(resolvedParent, resolvedTemporary)
  if (
    relativePath.length === 0 ||
    relativePath.startsWith('..') ||
    isAbsolute(relativePath) ||
    !basename(resolvedTemporary).startsWith('.prepare-winCodeSign-')
  ) {
    throw new Error(`winCodeSign cache: refusing to clean unexpected path ${resolvedTemporary}`)
  }
}

/**
 * Build the 7-Zip arguments for the Windows-only cache payload.
 * @param {string} archive Official archive path.
 * @param {string} outputDirectory Extraction destination.
 * @returns {string[]} Argument vector that excludes unused Darwin symlinks.
 */
export function windowsExtractionArguments(archive, outputDirectory) {
  return ['x', '-bd', '-y', '-xr!darwin', archive, `-o${outputDirectory}`]
}

function usableFile(filename) {
  try {
    const stats = statSync(filename)
    return stats.isFile() && stats.size > 0
  }
  catch (error) {
    if (error?.code === 'ENOENT') return false
    throw error
  }
}

function validatedArchiveIn(cacheParent) {
  for (const entry of readdirSync(cacheParent, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.endsWith('.7z')) continue
    const candidate = join(cacheParent, entry.name)
    if (sha512Hex(readFileSync(candidate)) === WINDOWS_CODE_SIGN_ARTIFACT.sha512) return candidate
  }
  return undefined
}

async function downloadArchive(filename) {
  const response = await fetch(WINDOWS_CODE_SIGN_ARTIFACT.url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(60_000),
  })
  if (!response.ok) {
    throw new Error(`winCodeSign cache: download failed with HTTP ${response.status}`)
  }
  const archive = Buffer.from(await response.arrayBuffer())
  const digest = sha512Hex(archive)
  if (digest !== WINDOWS_CODE_SIGN_ARTIFACT.sha512) {
    throw new Error(`winCodeSign cache: SHA-512 mismatch, got ${digest}`)
  }
  writeFileSync(filename, archive, { flag: 'wx' })
}

function resolveSevenZip(desktopRoot) {
  const desktopRequire = createRequire(join(desktopRoot, 'package.json'))
  const electronBuilderManifest = desktopRequire.resolve('electron-builder/package.json')
  const installedVersion = JSON.parse(readFileSync(electronBuilderManifest, 'utf8')).version
  if (installedVersion !== WINDOWS_CODE_SIGN_ARTIFACT.electronBuilderVersion) {
    throw new Error(
      `winCodeSign cache: electron-builder ${installedVersion} does not match pinned ${WINDOWS_CODE_SIGN_ARTIFACT.electronBuilderVersion}`,
    )
  }
  const electronBuilderRequire = createRequire(electronBuilderManifest)
  const sevenZip = electronBuilderRequire('7zip-bin').path7za
  if (!usableFile(sevenZip)) throw new Error(`winCodeSign cache: missing 7-Zip executable ${sevenZip}`)
  return sevenZip
}

/** Prepare the exact cache key consumed by electron-builder 25.1.8 on Windows. */
export async function prepareWindowsCodeSignCache() {
  if (process.platform !== 'win32') {
    console.log('WINDOWS_BUILDER_CACHE_SKIPPED platform=' + process.platform)
    return
  }

  const desktopRoot = fileURLToPath(new URL('..', import.meta.url))
  const cacheRoot = resolveElectronBuilderCache({
    cacheOverride: process.env.ELECTRON_BUILDER_CACHE,
    localAppData: process.env.LOCALAPPDATA,
  })
  const cacheParent = join(cacheRoot, 'winCodeSign')
  const target = join(cacheParent, `winCodeSign-${WINDOWS_CODE_SIGN_ARTIFACT.version}`)
  mkdirSync(cacheParent, { recursive: true })

  if (existsSync(target)) {
    const missing = missingToolchainFiles(target, usableFile)
    if (missing.length !== 0) {
      throw new Error(`winCodeSign cache: incomplete existing cache ${target}; missing ${missing.join(', ')}`)
    }
    console.log(`WINDOWS_BUILDER_CACHE_OK version=${WINDOWS_CODE_SIGN_ARTIFACT.version} source=existing`)
    return
  }

  const temporaryRoot = mkdtempSync(join(cacheParent, '.prepare-winCodeSign-'))
  assertSafeTemporaryDirectory(temporaryRoot, cacheParent)
  try {
    const archivePath = join(temporaryRoot, `winCodeSign-${WINDOWS_CODE_SIGN_ARTIFACT.version}.7z`)
    const cachedArchive = validatedArchiveIn(cacheParent)
    if (cachedArchive === undefined) await downloadArchive(archivePath)
    else copyFileSync(cachedArchive, archivePath, constants.COPYFILE_EXCL)
    const digest = sha512Hex(readFileSync(archivePath))
    if (digest !== WINDOWS_CODE_SIGN_ARTIFACT.sha512) {
      throw new Error(`winCodeSign cache: SHA-512 mismatch, got ${digest}`)
    }

    const payload = join(temporaryRoot, 'payload')
    mkdirSync(payload)
    const sevenZip = resolveSevenZip(desktopRoot)
    execFileSync(sevenZip, windowsExtractionArguments(archivePath, payload), {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const missing = missingToolchainFiles(payload, usableFile)
    if (missing.length !== 0) {
      throw new Error(`winCodeSign cache: extracted archive is missing ${missing.join(', ')}`)
    }

    try {
      renameSync(payload, target)
    }
    catch (error) {
      if (!existsSync(target) || missingToolchainFiles(target, usableFile).length !== 0) throw error
    }
    console.log(`WINDOWS_BUILDER_CACHE_OK version=${WINDOWS_CODE_SIGN_ARTIFACT.version} source=prepared`)
  }
  finally {
    assertSafeTemporaryDirectory(temporaryRoot, cacheParent)
    rmSync(temporaryRoot, { recursive: true, force: true })
  }
}

const invokedPath = process.argv[1] === undefined ? undefined : resolve(process.argv[1])
if (invokedPath === fileURLToPath(import.meta.url)) {
  await prepareWindowsCodeSignCache()
}
