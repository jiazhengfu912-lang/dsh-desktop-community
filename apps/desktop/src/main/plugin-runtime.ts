/** App-private pnpm and Node command shims used by Desktop plugin operations. */

import { randomUUID } from 'node:crypto'
import { chmodSync, lstatSync, mkdirSync, readdirSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { basename, dirname, isAbsolute, join } from 'node:path'
import { pathToFileURL } from 'node:url'

const DIRECTORY_MODE = 0o700
const EXECUTABLE_MODE = 0o700
const PRIVATE_FILE_MODE = 0o600
const RUN_AS_NODE = 'ELECTRON_RUN_AS_NODE'
const ELECTRON_HEADERS_URL = 'https://electronjs.org/headers'
const SINGLE_QUOTE = String.fromCharCode(39)
const APP_EXECUTABLE_ENV = 'DSH_DESKTOP_APP_EXECUTABLE'
const PNPM_ENTRY_ENV = 'DSH_DESKTOP_PNPM_ENTRY'
const NODE_BIN_ENV = 'DSH_DESKTOP_NODE_BIN'
const NODE_SHIM_ENV = 'DSH_DESKTOP_NODE_SHIM'
const CLEAR_ENVIRONMENT_URL_ENV = 'DSH_DESKTOP_CLEAR_ENVIRONMENT_URL'
const ELECTRON_VERSION_ENV = 'DSH_DESKTOP_ELECTRON_VERSION'

/** Immutable paths generated for one Desktop package-manager runtime. */
export interface DesktopPnpmRuntime {
  /** Directory containing the public `pnpm` command shim. */
  readonly pathDir: string
  /** Physical packaged pnpm JavaScript entry. */
  readonly pnpmBinPath: string
  /** Private directory containing the Electron-backed Node command. */
  readonly nodeBinDir: string
  /** Private Electron-backed Node command used by lifecycle scripts. */
  readonly nodeShimPath: string
  /** Preloaded module that removes Electron's RunAsNode marker. */
  readonly clearEnvironmentPath: string
  /** App-private pnpm content-addressable store. */
  readonly storeDir: string
  /** App-private pnpm metadata and request cache. */
  readonly cacheDir: string
  /** Unicode-safe values consumed by the generated command shims. */
  readonly environment: Readonly<Record<string, string>>
}

/** Inputs required to generate the app-private package-manager runtime. */
export interface DesktopPnpmRuntimeOptions {
  platform: NodeJS.Platform
  appExecutable: string
  pnpmBinPath: string
  electronVersion: string
  stateDir: string
}

function assertPath(label: string, value: string): void {
  if (!isAbsolute(value) || /[\0\r\n]/u.test(value)) {
    throw new Error(`desktop plugin runtime: ${label} must be an absolute path without NUL or newlines`)
  }
}

function assertScriptValue(label: string, value: string): void {
  if (value.length === 0 || /[\0\r\n]/u.test(value)) {
    throw new Error(`desktop plugin runtime: ${label} must not be empty or contain NUL or newlines`)
  }
}

function lstatOptional(filename: string): ReturnType<typeof lstatSync> | undefined {
  try {
    return lstatSync(filename)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}

function preparePrivateDirectory(directory: string): void {
  mkdirSync(directory, { recursive: true, mode: DIRECTORY_MODE })
  const stat = lstatSync(directory)
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`desktop plugin runtime: command path is not a real directory: ${directory}`)
  }
  chmodSync(directory, DIRECTORY_MODE)
}

function assertPrivateCommandDirectory(directory: string, allowed: string): void {
  const normalizedAllowed = allowed.toLowerCase()
  for (const entry of readdirSync(directory)) {
    const normalized = entry.toLowerCase()
    if (normalized === normalizedAllowed) continue
    throw new Error(`desktop plugin runtime: unexpected entry in private command directory: ${join(directory, entry)}`)
  }
}

function unlinkTemporary(filename: string): void {
  try {
    unlinkSync(filename)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
}

/** Atomically replace one app-owned regular file without following a link. */
function replacePrivateFile(filename: string, contents: string, mode: number): void {
  const existing = lstatOptional(filename)
  if (existing !== undefined && (!existing.isFile() || existing.isSymbolicLink())) {
    throw new Error(`desktop plugin runtime: generated command target is not a regular file: ${filename}`)
  }
  const temporary = join(dirname(filename), `.${basename(filename)}.${process.pid}.${randomUUID()}.tmp`)
  try {
    writeFileSync(temporary, contents, { encoding: 'utf8', flag: 'wx', mode })
    chmodSync(temporary, mode)
    renameSync(temporary, filename)
  } finally {
    unlinkTemporary(temporary)
  }
}

function quoteShell(value: string): string {
  const escaped = value.replaceAll(SINGLE_QUOTE, `${SINGLE_QUOTE}"${SINGLE_QUOTE}"${SINGLE_QUOTE}`)
  return `${SINGLE_QUOTE}${escaped}${SINGLE_QUOTE}`
}

function clearEnvironmentModule(): string {
  return [
    'for (const name of Object.keys(process.env)) {',
    `  if (name.toUpperCase() === '${RUN_AS_NODE}') delete process.env[name]`,
    '}',
    '',
  ].join('\n')
}

function windowsNodeShim(): string {
  return [
    '@echo off',
    'setlocal DisableDelayedExpansion',
    `set "${RUN_AS_NODE}=1"`,
    `"%${APP_EXECUTABLE_ENV}%" --import "%${CLEAR_ENVIRONMENT_URL_ENV}%" %*`,
    'exit /b %errorlevel%',
    '',
  ].join('\r\n')
}

function windowsPnpmShim(): string {
  return [
    '@echo off',
    'setlocal DisableDelayedExpansion',
    `set "PATH=%${NODE_BIN_ENV}%;%PATH%"`,
    `set "NODE=%${NODE_SHIM_ENV}%"`,
    `set "${RUN_AS_NODE}=1"`,
    'set "npm_config_runtime=electron"',
    `set "npm_config_target=%${ELECTRON_VERSION_ENV}%"`,
    `set "npm_config_disturl=${ELECTRON_HEADERS_URL}"`,
    `"%${APP_EXECUTABLE_ENV}%" --import "%${CLEAR_ENVIRONMENT_URL_ENV}%" "%${PNPM_ENTRY_ENV}%" %*`,
    'exit /b %errorlevel%',
    '',
  ].join('\r\n')
}

function posixNodeShim(appExecutable: string, clearEnvironmentUrl: string): string {
  return [
    '#!/bin/sh',
    `${RUN_AS_NODE}=1 exec ${quoteShell(appExecutable)} --import ${quoteShell(clearEnvironmentUrl)} "$@"`,
    '',
  ].join('\n')
}

function posixPnpmShim(
  options: DesktopPnpmRuntimeOptions,
  nodeBinDir: string,
  nodeShimPath: string,
  clearEnvironmentUrl: string,
): string {
  return [
    '#!/bin/sh',
    [
      `PATH=${quoteShell(nodeBinDir)}:"\${PATH:-}"`,
      `NODE=${quoteShell(nodeShimPath)}`,
      `${RUN_AS_NODE}=1`,
      'npm_config_runtime=electron',
      `npm_config_target=${quoteShell(options.electronVersion)}`,
      `npm_config_disturl=${quoteShell(ELECTRON_HEADERS_URL)}`,
      `exec ${quoteShell(options.appExecutable)} --import ${quoteShell(clearEnvironmentUrl)} ${quoteShell(options.pnpmBinPath)} "$@"`,
    ].join(' '),
    '',
  ].join('\n')
}

/**
 * Generate app-private pnpm and Node commands without mutating the system PATH.
 * @param options - packaged executable, pnpm, Electron, and state paths.
 * @returns immutable paths consumed only by the Desktop Host generation.
 */
export function installDesktopPnpmRuntime(options: DesktopPnpmRuntimeOptions): DesktopPnpmRuntime {
  if (!['darwin', 'linux', 'win32'].includes(options.platform)) {
    throw new Error(`desktop plugin runtime: unsupported platform ${options.platform}`)
  }
  assertPath('application executable', options.appExecutable)
  assertPath('pnpm entry', options.pnpmBinPath)
  assertPath('state directory', options.stateDir)
  assertScriptValue('Electron version', options.electronVersion)

  const pathDir = join(options.stateDir, 'bin')
  const privateDir = join(options.stateDir, 'private')
  const nodeBinDir = join(privateDir, 'node-bin')
  const storeDir = join(options.stateDir, 'store')
  const cacheDir = join(options.stateDir, 'cache')
  preparePrivateDirectory(options.stateDir)
  preparePrivateDirectory(pathDir)
  preparePrivateDirectory(privateDir)
  preparePrivateDirectory(nodeBinDir)
  preparePrivateDirectory(storeDir)
  preparePrivateDirectory(cacheDir)

  const windows = options.platform === 'win32'
  const pnpmShimPath = join(pathDir, windows ? 'pnpm.cmd' : 'pnpm')
  const nodeShimPath = join(nodeBinDir, windows ? 'node.cmd' : 'node')
  const clearEnvironmentPath = join(privateDir, 'clear-env.mjs')
  assertPrivateCommandDirectory(pathDir, basename(pnpmShimPath))
  assertPrivateCommandDirectory(nodeBinDir, basename(nodeShimPath))
  replacePrivateFile(clearEnvironmentPath, clearEnvironmentModule(), PRIVATE_FILE_MODE)
  const clearEnvironmentUrl = pathToFileURL(clearEnvironmentPath).href
  replacePrivateFile(
    nodeShimPath,
    windows
      ? windowsNodeShim()
      : posixNodeShim(options.appExecutable, clearEnvironmentUrl),
    windows ? PRIVATE_FILE_MODE : EXECUTABLE_MODE,
  )
  replacePrivateFile(
    pnpmShimPath,
    windows
      ? windowsPnpmShim()
      : posixPnpmShim(options, nodeBinDir, nodeShimPath, clearEnvironmentUrl),
    windows ? PRIVATE_FILE_MODE : EXECUTABLE_MODE,
  )

  const environment = Object.freeze({
    [APP_EXECUTABLE_ENV]: options.appExecutable,
    [PNPM_ENTRY_ENV]: options.pnpmBinPath,
    [NODE_BIN_ENV]: nodeBinDir,
    [NODE_SHIM_ENV]: nodeShimPath,
    [CLEAR_ENVIRONMENT_URL_ENV]: clearEnvironmentUrl,
    [ELECTRON_VERSION_ENV]: options.electronVersion,
    npm_config_store_dir: storeDir,
    npm_config_cache: cacheDir,
  })
  return {
    pathDir,
    pnpmBinPath: options.pnpmBinPath,
    nodeBinDir,
    nodeShimPath,
    clearEnvironmentPath,
    storeDir,
    cacheDir,
    environment,
  }
}
