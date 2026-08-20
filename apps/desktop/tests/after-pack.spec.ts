import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

interface AfterPackModule {
  removeForbiddenBrandPackages(packagedAppRoot: string): Promise<void>
  sanitizeGeneratedClientText(
    text: string,
    repositoryRoot: string,
    filePath?: string,
  ): { replacements: number; text: string }
  sanitizeStagedText(packagedAppRoot: string, repositoryRoot: string): Promise<number>
}

const afterPack = await import('../build/after-pack.cjs') as unknown as AfterPackModule
const temporaryRoots: string[] = []

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { force: true, recursive: true })
})

describe('desktop afterPack artifact closure', () => {
  it('rewrites only the dynamic checkout root in generated CSS region comments', () => {
    const repositoryRoot = String.raw`D:\community checkout`
    const input = [
      String.raw`//#region \0dsh-css:D:\community checkout\packages\client\ui\src\View.module.css.mjs`,
      'const value = 1',
      '',
    ].join('\r\n')

    expect(afterPack.sanitizeGeneratedClientText(input, repositoryRoot)).toEqual({
      replacements: 1,
      text: [
        String.raw`//#region \0dsh-css:<repository>\packages\client\ui\src\View.module.css.mjs`,
        'const value = 1',
        '',
      ].join('\r\n'),
    })
  })

  it.each([
    String.raw`const leaked = "D:\community checkout\secret"`,
    String.raw`// built from D:\community checkout\packages\client`,
  ])('rejects the checkout root outside generated CSS regions', (input) => {
    expect(() => afterPack.sanitizeGeneratedClientText(input, String.raw`D:\community checkout`)).toThrow(
      /outside a generated CSS region/u,
    )
  })

  it('rejects a generated CSS region rooted at another absolute path', () => {
    const input = String.raw`//#region \0dsh-inline-css:C:\other\base.css.mjs`
    expect(() => afterPack.sanitizeGeneratedClientText(input, String.raw`D:\community checkout`)).toThrow(
      /unexpected absolute path/u,
    )
  })

  it('removes every upstream artwork package and preserves adjacent packages', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-after-pack-'))
    temporaryRoots.push(root)
    const scope = join(root, 'node_modules', '@deepseek-ai')
    const official = join(scope, 'dsh-client-ui-brand-official')
    const legacyBadge = join(scope, 'dsh-skill-badge')
    const webFrontend = join(scope, 'dsh-web-frontend')
    const community = join(scope, 'dsh-client-ui-brand-community')
    mkdirSync(official, { recursive: true })
    mkdirSync(join(legacyBadge, 'assets'), { recursive: true })
    mkdirSync(join(webFrontend, 'dist'), { recursive: true })
    mkdirSync(community, { recursive: true })
    writeFileSync(join(official, 'package.json'), '{}')
    writeFileSync(join(legacyBadge, 'assets', 'dsh-badge.png'), 'legacy whale artwork')
    writeFileSync(join(legacyBadge, 'assets', 'dsh-badge.md'), 'logo=deepseek')
    writeFileSync(join(webFrontend, 'dist', 'favicon.svg'), '<svg><!-- legacy whale artwork --></svg>')
    writeFileSync(join(webFrontend, 'dist', 'manifest.webmanifest'), '{"name":"DeepSeek Harness"}')
    writeFileSync(join(community, 'package.json'), '{"name":"community"}')

    await afterPack.removeForbiddenBrandPackages(root)

    expect(existsSync(join(official, 'package.json'))).toBe(false)
    expect(existsSync(join(legacyBadge, 'assets', 'dsh-badge.png'))).toBe(false)
    expect(existsSync(join(legacyBadge, 'assets', 'dsh-badge.md'))).toBe(false)
    expect(existsSync(join(webFrontend, 'dist', 'favicon.svg'))).toBe(false)
    expect(existsSync(join(webFrontend, 'dist', 'manifest.webmanifest'))).toBe(false)
    expect(readFileSync(join(community, 'package.json'), 'utf8')).toContain('community')
  })

  it('sanitizes one staged artifact without changing an adjacent clean file', async () => {
    const root = mkdtempSync(join(tmpdir(), 'dsh-after-pack-tree-'))
    temporaryRoots.push(root)
    const repositoryRoot = String.raw`D:\community checkout`
    const generated = join(root, 'generated.js')
    const adjacent = join(root, 'adjacent.js')
    writeFileSync(
      generated,
      String.raw`//#region \0dsh-css:D:\community checkout\packages\client\ui\src\View.module.css.mjs`,
    )
    writeFileSync(adjacent, 'export const clean = true\n')

    await expect(afterPack.sanitizeStagedText(root, repositoryRoot)).resolves.toBe(1)
    expect(readFileSync(generated, 'utf8')).toContain('<repository>')
    expect(readFileSync(adjacent, 'utf8')).toBe('export const clean = true\n')
  })
})
