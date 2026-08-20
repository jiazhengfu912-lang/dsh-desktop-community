import { mkdtempSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import type { PatchOptions } from '@deepseek-ai/cordis-plugin-include'
import { boot, loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import { describe, expect, it, vi } from 'vitest'
import {
  assertSafeTemporaryDirectory,
  missingToolchainFiles,
  resolveElectronBuilderCache,
  sha512Hex,
  WINDOWS_CODE_SIGN_ARTIFACT,
  windowsExtractionArguments,
} from '../build/prepare-wincode-sign-cache.mjs'
import { claimSettledHost } from '../src/main/host-lifecycle.ts'

describe('Windows packaging tool cache', () => {
  it('pins the official artifact digest and derives the default cache key', () => {
    expect(sha512Hex(Buffer.from('abc'))).toBe(
      'DDAF35A193617ABACC417349AE20413112E6FA4E89A97EA20A9EEEE64B55D39A2192992A274FC1A836BA3C23A3FEEBBD454D4423643CE80E2A9AC94FA54CA49F',
    )
    expect(resolveElectronBuilderCache({ localAppData: 'C:\\Users\\runner\\AppData\\Local' })).toBe(
      resolve('C:\\Users\\runner\\AppData\\Local', 'electron-builder', 'Cache'),
    )
    expect(WINDOWS_CODE_SIGN_ARTIFACT.url).toContain(`winCodeSign-${WINDOWS_CODE_SIGN_ARTIFACT.version}`)
  })

  it('reports missing required executables through an injected file predicate', () => {
    const root = resolve('C:\\cache\\winCodeSign-2.6.0')
    const available = new Set([join(root, 'rcedit-x64.exe')])
    expect(missingToolchainFiles(root, filename => available.has(filename))).toEqual([
      join('windows-10', 'x64', 'signtool.exe'),
    ])
  })

  it('accepts only its dedicated cache temporary directory', () => {
    const parent = resolve('C:\\cache\\winCodeSign')
    expect(() => {
      assertSafeTemporaryDirectory(join(parent, '.prepare-winCodeSign-123'), parent)
    }).not.toThrow()
    expect(() => {
      assertSafeTemporaryDirectory(parent, parent)
    }).toThrow(/refusing to clean/u)
    expect(() => {
      assertSafeTemporaryDirectory(resolve(parent, '..', 'other'), parent)
    }).toThrow(/refusing to clean/u)
  })

  it('excludes unused Darwin symlinks from Windows extraction', () => {
    expect(windowsExtractionArguments('archive.7z', 'payload')).toEqual([
      'x',
      '-bd',
      '-y',
      '-xr!darwin',
      'archive.7z',
      '-opayload',
    ])
  })
})

describe('Desktop settled Host ownership', () => {
  it('disposes an unpublished Host when required services are missing', async () => {
    const ctx = new Context()
    const dispose = vi.spyOn(ctx.fiber, 'dispose')

    await expect(claimSettledHost(ctx, () => {
      throw new Error('desktop host boot: apiProxy service missing after settlement')
    }))
      .rejects.toThrow('desktop host boot: apiProxy service missing after settlement')
    expect(dispose).toHaveBeenCalledOnce()
  })

  it('preserves validation and cleanup failures when disposal also fails', async () => {
    const cleanupError = new Error('cleanup failed')
    const ctx = {
      get: () => undefined,
      fiber: { dispose: vi.fn(() => Promise.reject(cleanupError)) },
    } as unknown as Context

    const caught = await claimSettledHost(ctx, () => {
      throw new Error('desktop host boot: apiProxy service missing after settlement')
    }).catch((error: unknown) => error)
    expect(caught).toBeInstanceOf(AggregateError)
    const aggregate = caught as AggregateError
    expect(aggregate.message).toBe('desktop host boot: settled Host validation failed and cleanup was incomplete')
    expect(aggregate.errors).toHaveLength(2)
    expect(aggregate.errors[0]).toEqual(expect.objectContaining({
      message: 'desktop host boot: apiProxy service missing after settlement',
    }))
    expect(aggregate.errors[1]).toBe(cleanupError)
  })
})

describe('Desktop profile overlays', () => {
  it('keeps one Better Sidebar row enabled without recursively evaluating fallback guards', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dsh-desktop-sidebar-overlay-'))
    const configPath = join(dir, 'cordis.yml')
    writeFileSync(configPath, '[]\n')

    const bundlePatches = loadOverlayPatches(
      'desktop-test',
      fileURLToPath(new URL('../node_modules/dsh-better-sidebar/cordis.patch.yml', import.meta.url)),
    )
    const desktopPatches = loadOverlayPatches(
      'desktop-test',
      fileURLToPath(new URL('../desktop.patch.yml', import.meta.url)),
    )
    const desktopRow = desktopPatches
      .flatMap(patch => patch.insert ?? [])
      .find(entry => entry.id === 'desktop-better-sidebar')
    if (desktopRow === undefined) throw new Error('desktop Better Sidebar fallback row missing')

    const patches: PatchOptions[] = [...bundlePatches, { insert: [desktopRow] }]
    const ctx = await boot(
      'desktop-test',
      configPath,
      patches,
      (hostCtx) => {
        const loader = hostCtx.get('loader') as {
          internal: { version: string; import(specifier: string, parentURL: string): Promise<unknown> }
        } | undefined
        if (loader === undefined) throw new Error('desktop test Loader missing')
        loader.internal = {
          version: 'test',
          import: () => Promise.resolve({ name: 'sidebar-test-plugin', apply() {} }),
        }
      },
      pathToFileURL(join(dir, 'package.json')).href,
    )
    try {
      const sidebarEntries = [...ctx.loader.entries()]
        .filter(entry => entry.options.name === 'dsh-better-sidebar')
      expect(sidebarEntries).toHaveLength(2)
      expect(sidebarEntries.filter(entry => !entry.disabled)).toHaveLength(1)
    } finally {
      await ctx.fiber.dispose()
    }
  })
})
