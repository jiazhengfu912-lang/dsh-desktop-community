/**
 * Focus handoff for Electron's process-wide single-instance lock. A launch
 * arriving before either visible window exists is retained until the splash
 * or application window becomes the current focus target.
 * @module @deepseek-ai/dsh-desktop/single-instance
 */

import type { App } from 'electron'

/** BrowserWindow operations required by the second-instance focus handoff. */
export interface FocusTarget {
  isDestroyed(): boolean
  isMinimized(): boolean
  isVisible(): boolean
  restore(): void
  show(): void
  focus(): void
}

/** Retains one pending focus request until a live visible window is available. */
export class SecondInstanceFocus {
  private target: FocusTarget | undefined
  private pending = false

  /** Record or immediately fulfill a request from Electron's second-instance event. */
  request(): void {
    if (!this.focusTarget()) this.pending = true
  }

  /**
   * Publish the current visible startup/application window.
   * @param target - window that should receive subsequent launch focus.
   */
  setTarget(target: FocusTarget): void {
    this.target = target
    if (this.pending) this.focusTarget()
  }

  /**
   * Retire a target without clearing a newer replacement.
   * @param target - window that has closed or been destroyed.
   */
  clearTarget(target: FocusTarget): void {
    if (this.target === target) this.target = undefined
  }

  private focusTarget(): boolean {
    const target = this.target
    if (target === undefined || target.isDestroyed()) {
      if (this.target === target) this.target = undefined
      return false
    }
    this.pending = false
    if (target.isMinimized()) target.restore()
    if (!target.isVisible()) target.show()
    target.focus()
    return true
  }
}

/**
 * Atomically claim Electron's process-wide instance lock and wire focus handoff.
 * @param app - Electron application singleton.
 * @param focus - pending-capable focus receiver for `second-instance` events.
 * @returns true for the primary process; false after requesting secondary exit.
 */
export function acquireSingleInstance(app: App, focus: SecondInstanceFocus): boolean {
  if (!app.requestSingleInstanceLock()) {
    app.quit()
    return false
  }
  app.on('second-instance', () => { focus.request() })
  return true
}
