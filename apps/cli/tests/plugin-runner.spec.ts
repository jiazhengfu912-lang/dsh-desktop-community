/** Desktop-owned pnpm invocation selection. */

import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { describe, expect, it } from 'vitest'
import { resolvePnpmInvocation } from '../src/plugin.ts'

describe('pnpm invocation selection', () => {
  it('preserves the ordinary Windows CLI PATH command', () => {
    expect(resolvePnpmInvocation(['add', '@example/plugin'], {}, 'win32')).toEqual({
      file: 'pnpm',
      args: ['add', '@example/plugin'],
      shell: true,
    })
  })

  it('passes Desktop arguments with command metacharacters directly to the packaged pnpm entry', () => {
    const executable = resolve('安装 path % value', 'DSH Desktop Community.exe')
    const pnpmEntry = resolve('安装 path % value', 'node_modules', 'pnpm', 'bin', 'pnpm.cjs')
    const preloader = pathToFileURL(resolve('用户 data & state', 'clear-env.mjs')).href
    const pluginSpec = `file:${resolve('插件 checkout & 100%')}`
    const environment = {
      PATH: resolve('private runtime'),
      DSH_DESKTOP_APP_EXECUTABLE: executable,
      DSH_DESKTOP_PNPM_ENTRY: pnpmEntry,
      DSH_DESKTOP_CLEAR_ENVIRONMENT_URL: preloader,
    }

    expect(resolvePnpmInvocation(['add', pluginSpec, '%PATH%', '&', '|'], environment, 'win32'))
      .toEqual({
        file: executable,
        args: ['--import', preloader, pnpmEntry, 'add', pluginSpec, '%PATH%', '&', '|'],
        shell: false,
        environment: { ...environment, ELECTRON_RUN_AS_NODE: '1' },
      })
  })

  it('rejects a partially configured Desktop runtime', () => {
    expect(() => resolvePnpmInvocation(['install'], {
      DSH_DESKTOP_APP_EXECUTABLE: resolve('DSH Desktop Community.exe'),
    }, 'win32')).toThrow('Desktop pnpm runtime environment is incomplete')
  })
})
