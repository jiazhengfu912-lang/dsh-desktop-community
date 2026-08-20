/** Host-tool prerequisites for Desktop plugin package operations. */

import { statSync } from 'node:fs'
import { delimiter, join } from 'node:path'

const WINDOWS_EXECUTABLE_EXTENSIONS = ['.COM', '.EXE', '.BAT', '.CMD'] as const
const GIT_DOWNLOAD_URL = 'https://git-scm.com/download/win'

function environmentValue(environment: NodeJS.ProcessEnv, expected: string): string | undefined {
  const direct = environment[expected]
  if (direct !== undefined) return direct
  return Object.entries(environment).find(([name]) => name.toUpperCase() === expected)?.[1]
}

function isFile(filename: string): boolean {
  try {
    return statSync(filename).isFile()
  } catch {
    // An absent or unreadable PATH candidate cannot satisfy the prerequisite.
    return false
  }
}

function commandExists(command: string, environment: NodeJS.ProcessEnv, platform: NodeJS.Platform): boolean {
  const path = environmentValue(environment, 'PATH') ?? ''
  const pathDelimiter = platform === 'win32' ? ';' : delimiter
  const extensions = platform === 'win32'
    ? (environmentValue(environment, 'PATHEXT')?.split(';').filter(Boolean) ?? [...WINDOWS_EXECUTABLE_EXTENSIONS])
    : ['']
  for (const rawDirectory of path.split(pathDelimiter)) {
    const directory = rawDirectory.replace(/^"|"$/g, '')
    if (directory.length === 0) continue
    for (const extension of extensions) {
      if (isFile(join(directory, `${command}${extension.toLowerCase()}`))) return true
      if (platform === 'win32' && isFile(join(directory, `${command}${extension.toUpperCase()}`))) return true
    }
  }
  return false
}

function needsGit(args: readonly string[]): boolean {
  return args[0] === 'add' && args.some(argument => /^(?:github:|git(?:\+|:)|ssh:)/iu.test(argument))
}

/**
 * Fail before pnpm when a requested source needs a host tool that Desktop
 * does not distribute.
 * @param args - validated DSH plugin arguments.
 * @param environment - environment inherited by the managed operation.
 * @param platform - platform whose command lookup rules apply.
 */
export function assertPluginPrerequisites(
  args: readonly string[],
  environment: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): void {
  if (!needsGit(args) || commandExists('git', environment, platform)) return
  throw new Error(
    `desktop plugin services: Git is required to install github: plugins. Install Git for Windows from ${GIT_DOWNLOAD_URL}, then restart DSH Desktop Community.`,
  )
}
