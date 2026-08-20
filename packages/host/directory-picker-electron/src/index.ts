/**
 * Electron-native-chooser backend of the directory-picker seam: registers
 * `ctx.directoryPicker` with the `native` capability, opening Electron's
 * native directory dialog (`dialog.showOpenDialog`) on the desktop host.
 * Used by the desktop (Electron) app; remote deployments compose the browse
 * backend instead.
 * @module @deepseek-ai/dsh-host-directory-picker-electron
 */

import { dialog } from 'electron'
import { DirectoryPicker } from '@deepseek-ai/dsh-host-directory-picker'
import type { DirectoryPickerCapability } from '@deepseek-ai/dsh-host-directory-picker'

/** The `ctx.directoryPicker` Electron implementation (stable capability object per service life). */
export default class ElectronDirectoryPicker extends DirectoryPicker {
  private readonly nativeCapability: DirectoryPickerCapability = {
    kind: 'native',
    pick: signal => this.pickDirectory(signal),
  }

  /**
   * The native interaction capability.
   * @returns the stable `native` capability object.
   */
  capability(): DirectoryPickerCapability {
    return this.nativeCapability
  }

  /** Open the Electron directory chooser and wait for the operator. */
  private async pickDirectory(signal: AbortSignal): Promise<string | null> {
    // A cancelled caller (window closing) never opens a fresh dialog.
    if (signal.aborted) return null
    const result = await dialog.showOpenDialog({
      title: 'Select Workspace Directory',
      properties: ['openDirectory', 'createDirectory'],
    })
    if (result.canceled) return null
    const chosen = result.filePaths[0]
    return chosen ?? null
  }
}
