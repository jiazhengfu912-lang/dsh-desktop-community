/** Process runner for the packaged Desktop startup smoke. */

import { spawn, spawnSync } from 'node:child_process'
import { win32 } from 'node:path'

const DEFAULT_FORCE_KILL_GRACE_MS = 5_000

/**
 * Apply subprocess environment overrides without leaving case-variant aliases
 * on Windows, where environment variable names are case-insensitive.
 * @param {NodeJS.ProcessEnv} base
 * @param {NodeJS.ProcessEnv} overrides
 * @param {NodeJS.Platform} [platform]
 * @returns {NodeJS.ProcessEnv}
 */
export function mergeProcessEnvironment(base, overrides, platform = process.platform) {
  if (platform !== 'win32') return { ...base, ...overrides }
  const merged = new Map()
  for (const [name, value] of [...Object.entries(base), ...Object.entries(overrides)]) {
    const normalized = name.toUpperCase()
    merged.delete(normalized)
    merged.set(normalized, [name, value])
  }
  return Object.fromEntries(merged.values())
}

function safeKill(child, signal) {
  try {
    child.kill(signal)
  } catch {
    // A concurrent close means no process remains to signal.
  }
}

function windowsTaskkillPath(systemRoot) {
  if (!win32.isAbsolute(systemRoot) || /[\0\r\n]/u.test(systemRoot)) {
    throw new Error('packaged startup smoke: SystemRoot must be an absolute Windows path without NUL or newlines')
  }
  return win32.join(systemRoot, 'System32', 'taskkill.exe')
}

/**
 * Run the packaged executable with a bounded, tree-scoped Windows timeout.
 * The promise settles only after the direct child emits `close`, so callers
 * can tear down fixture servers and directories after its handles are closed.
 * @param {import('./startup-smoke-process.mjs').StartupSmokeProcessOptions} options
 * @returns {Promise<import('./startup-smoke-process.mjs').StartupSmokeProcessResult>}
 */
export function runStartupSmokeProcess(options) {
  const {
    executable,
    args,
    env,
    timeoutMs,
    maxOutputBytes,
    forceKillGraceMs = DEFAULT_FORCE_KILL_GRACE_MS,
    platform = process.platform,
    systemRoot = process.env.SystemRoot ?? 'C:\\Windows',
    spawnProcess = spawn,
    runTaskkill = spawnSync,
  } = options
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error('packaged startup smoke: process timeout must be positive and finite')
  }
  if (!Number.isFinite(forceKillGraceMs) || forceKillGraceMs <= 0) {
    throw new Error('packaged startup smoke: force-kill grace must be positive and finite')
  }
  if (!Number.isSafeInteger(maxOutputBytes) || maxOutputBytes <= 0) {
    throw new Error('packaged startup smoke: output limit must be a positive safe integer')
  }
  const taskkillPath = platform === 'win32' ? windowsTaskkillPath(systemRoot) : undefined

  return new Promise((resolveRun, rejectRun) => {
    const child = spawnProcess(executable, [...args], {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    let stdout = ''
    let stderr = ''
    let timedOut = false
    let childError
    let settled = false
    let forceTimer
    const append = (current, chunk) => (current + String(chunk)).slice(-maxOutputBytes)
    const collectStdout = chunk => { stdout = append(stdout, chunk) }
    const collectStderr = chunk => { stderr = append(stderr, chunk) }
    const rememberError = error => { childError ??= error }
    child.stdout.on('data', collectStdout)
    child.stderr.on('data', collectStderr)
    child.once('error', rememberError)

    const timeout = setTimeout(() => {
      if (settled) return
      timedOut = true
      if (platform === 'win32' && taskkillPath !== undefined && child.pid !== undefined) {
        let killedTree = false
        try {
          const outcome = runTaskkill(
            taskkillPath,
            ['/PID', String(child.pid), '/T', '/F'],
            { stdio: 'ignore', timeout: forceKillGraceMs, windowsHide: true },
          )
          killedTree = outcome.error === undefined && outcome.status === 0
        } catch {
          killedTree = false
        }
        if (!killedTree) safeKill(child, 'SIGKILL')
      } else {
        safeKill(child, platform === 'win32' ? 'SIGKILL' : undefined)
      }
      if (!settled) {
        forceTimer = setTimeout(() => {
          if (!settled) safeKill(child, 'SIGKILL')
        }, forceKillGraceMs)
      }
    }, timeoutMs)

    child.once('close', (status, signal) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      if (forceTimer !== undefined) clearTimeout(forceTimer)
      child.stdout.off('data', collectStdout)
      child.stderr.off('data', collectStderr)
      child.off('error', rememberError)
      if (childError !== undefined) {
        rejectRun(childError)
        return
      }
      resolveRun({ status, signal, stdout, stderr, timedOut })
    })
  })
}
