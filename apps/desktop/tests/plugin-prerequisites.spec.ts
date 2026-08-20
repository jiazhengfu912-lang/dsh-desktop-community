import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { assertPluginPrerequisites } from '../src/main/plugin-prerequisites.ts'

const TEMPORARY_PREREQUISITE_PREFIX = 'dsh-desktop-plugin-prerequisite-'
const temporaryDirectories: string[] = []

afterEach(() => {
  const temporaryRoot = resolve(tmpdir())
  for (const directory of temporaryDirectories.splice(0)) {
    const target = resolve(directory)
    if (dirname(target) !== temporaryRoot || !basename(target).startsWith(TEMPORARY_PREREQUISITE_PREFIX)) {
      throw new Error(`refusing to remove unexpected prerequisite fixture: ${target}`)
    }
    rmSync(target, { recursive: true, force: true })
  }
})

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), TEMPORARY_PREREQUISITE_PREFIX))
  temporaryDirectories.push(directory)
  return directory
}

describe('Desktop plugin host-tool prerequisites', () => {
  it('accepts a Git-hosted package when Git is discoverable', () => {
    const path = temporaryDirectory()
    writeFileSync(join(path, 'git.cmd'), '@exit /b 0\r\n')

    expect(() => {
      assertPluginPrerequisites(
        ['add', 'github:Limitinfinitude/DSH-Right-Sidebar'],
        { PATH: path, PATHEXT: '.COM;.EXE;.BAT;.CMD' },
        'win32',
      )
    }).not.toThrow()
  })

  it('fails loud for a Git-hosted package before pnpm when Git is absent', () => {
    const path = temporaryDirectory()

    expect(() => {
      assertPluginPrerequisites(
        ['add', 'github:Limitinfinitude/DSH-Right-Sidebar'],
        { PATH: path, PATHEXT: '.COM;.EXE;.BAT;.CMD' },
        'win32',
      )
    }).toThrow('Git is required to install github: plugins')
  })

  it('does not require Git for registry packages', () => {
    expect(() => {
      assertPluginPrerequisites(
        ['add', '@liustack/modlens'],
        { PATH: temporaryDirectory() },
        'win32',
      )
    }).not.toThrow()
  })
})
