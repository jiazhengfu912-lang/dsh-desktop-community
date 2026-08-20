/** Window bounds persistence for the desktop shell (standard Windows title bar). */
import { app, type BrowserWindow } from 'electron'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

export interface WindowState {
  width: number
  height: number
  x?: number
  y?: number
  isMaximized?: boolean
}

function statePath(): string {
  return join(app.getPath('userData'), 'window-state.json')
}

/** Load the last window bounds, or a sensible default. */
export function loadWindowState(): WindowState {
  try {
    const state = JSON.parse(readFileSync(statePath(), 'utf8')) as WindowState
    if (typeof state.width === 'number' && typeof state.height === 'number') return state
  } catch {
    // First run or a corrupt file — fall through to the default.
  }
  return { width: 1280, height: 820 }
}

/** Persist the current window bounds and maximized flag. */
export function saveWindowState(win: BrowserWindow): void {
  try {
    const bounds = win.getNormalBounds()
    const state: WindowState = {
      width: bounds.width,
      height: bounds.height,
      x: bounds.x,
      y: bounds.y,
      isMaximized: win.isMaximized(),
    }
    mkdirSync(dirname(statePath()), { recursive: true })
    writeFileSync(statePath(), JSON.stringify(state))
  } catch {
    // Persistence is best-effort; never crash the app over window state.
  }
}
