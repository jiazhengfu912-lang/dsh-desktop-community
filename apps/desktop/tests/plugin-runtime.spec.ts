import { lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { installDesktopPnpmRuntime } from '../src/main/plugin-runtime.ts'

const TEMPORARY_RUNTIME_PREFIX = 'dsh-desktop-plugin-runtime-'
const temporaryRuntimes: string[] = []

afterEach(() => {
  const temporaryRoot = resolve(tmpdir())
  for (const directory of temporaryRuntimes.splice(0)) {
    const target = resolve(directory)
    if (dirname(target) !== temporaryRoot || !basename(target).startsWith(TEMPORARY_RUNTIME_PREFIX)) {
      throw new Error(`refusing to remove unexpected test runtime: ${target}`)
    }
    rmSync(target, { recursive: true, force: true })
  }
})

function temporaryRuntime(): string {
  const root = mkdtempSync(join(tmpdir(), TEMPORARY_RUNTIME_PREFIX))
  temporaryRuntimes.push(root)
  return root
}

describe('Desktop private package-manager commands', () => {
  it('keeps Windows batch files ASCII and passes Unicode paths through the environment', () => {
    const root = temporaryRuntime()
    const stateDir = join(root, '用户 data % path', 'plugin-runtime')
    const appExecutable = join(root, '安装 目录 % value', 'DSH Desktop Community.exe')
    const pnpmBinPath = join(root, '应用', 'node_modules', 'pnpm', 'bin', 'pnpm.cjs')
    const runtime = installDesktopPnpmRuntime({
      platform: 'win32',
      appExecutable,
      pnpmBinPath,
      electronVersion: '36.9.5',
      stateDir,
    })

    const pnpmCommand = readFileSync(join(runtime.pathDir, 'pnpm.cmd'))
    const nodeCommand = readFileSync(runtime.nodeShimPath)
    expect([...pnpmCommand, ...nodeCommand].every(byte => byte < 0x80)).toBe(true)
    expect(pnpmCommand.toString('ascii')).toContain('"%DSH_DESKTOP_APP_EXECUTABLE%"')
    expect(nodeCommand.toString('ascii')).toContain('"%DSH_DESKTOP_CLEAR_ENVIRONMENT_URL%"')
    expect(runtime.environment).toMatchObject({
      DSH_DESKTOP_APP_EXECUTABLE: appExecutable,
      DSH_DESKTOP_PNPM_ENTRY: pnpmBinPath,
      DSH_DESKTOP_NODE_SHIM: runtime.nodeShimPath,
      DSH_DESKTOP_ELECTRON_VERSION: '36.9.5',
      npm_config_store_dir: join(stateDir, 'store'),
      npm_config_cache: join(stateDir, 'cache'),
    })
    expect(runtime.storeDir).toBe(join(stateDir, 'store'))
    expect(runtime.cacheDir).toBe(join(stateDir, 'cache'))
    expect(lstatSync(runtime.storeDir).isDirectory()).toBe(true)
    expect(lstatSync(runtime.storeDir).isSymbolicLink()).toBe(false)
    expect(lstatSync(runtime.cacheDir).isDirectory()).toBe(true)
    expect(lstatSync(runtime.cacheDir).isSymbolicLink()).toBe(false)
  })

  it.each([
    ['bin', 'pnpm.exe'],
    ['bin', 'git.cmd'],
    [join('private', 'node-bin'), 'node.exe'],
  ])('rejects unexpected PATH entry %s/%s', (relativeDir, filename) => {
    const root = temporaryRuntime()
    const stateDir = join(root, 'plugin-runtime')
    mkdirSync(join(stateDir, relativeDir), { recursive: true })
    writeFileSync(join(stateDir, relativeDir, filename), 'unexpected')

    expect(() => installDesktopPnpmRuntime({
      platform: 'win32',
      appExecutable: join(root, 'DSH Desktop Community.exe'),
      pnpmBinPath: join(root, 'pnpm.cjs'),
      electronVersion: '36.9.5',
      stateDir,
    })).toThrow('unexpected entry in private command directory')
  })
})
