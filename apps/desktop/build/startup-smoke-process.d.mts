import type { ChildProcessWithoutNullStreams } from 'node:child_process'

export interface StartupSmokeProcessResult {
  readonly status: number | null
  readonly signal: NodeJS.Signals | null
  readonly stdout: string
  readonly stderr: string
  readonly timedOut: boolean
}

export interface StartupSmokeProcessOptions {
  readonly executable: string
  readonly args: readonly string[]
  readonly env: NodeJS.ProcessEnv
  readonly timeoutMs: number
  readonly maxOutputBytes: number
  readonly forceKillGraceMs?: number
  readonly platform?: NodeJS.Platform
  readonly systemRoot?: string
  readonly spawnProcess?: (
    executable: string,
    args: readonly string[],
    options: {
      readonly env: NodeJS.ProcessEnv
      readonly stdio: readonly ['ignore', 'pipe', 'pipe']
      readonly windowsHide: true
    },
  ) => ChildProcessWithoutNullStreams
  readonly runTaskkill?: (
    executable: string,
    args: readonly string[],
    options: { readonly stdio: 'ignore'; readonly timeout: number; readonly windowsHide: true },
  ) => { readonly status: number | null; readonly error?: Error }
}

export function mergeProcessEnvironment(
  base: NodeJS.ProcessEnv,
  overrides: NodeJS.ProcessEnv,
  platform?: NodeJS.Platform,
): NodeJS.ProcessEnv

export function runStartupSmokeProcess(options: StartupSmokeProcessOptions): Promise<StartupSmokeProcessResult>
