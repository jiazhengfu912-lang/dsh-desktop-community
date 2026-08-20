/**
 * Standalone desktop splash renderer. This lightweight file:// document stays
 * visible for the whole startup transaction; the main process closes its
 * window only after the hidden application renderer settles.
 * @module @deepseek-ai/dsh-desktop/splash
 */

import type { DesktopBridge } from '../shared/ipc.ts'
import appIconSvg from '../../assets/app-icon.svg?raw'
import { mountSplash, wireSplashActions } from './splash-view.ts'
import './splash.css'

const bridge = (window as unknown as { __DSH_BRIDGE__?: DesktopBridge }).__DSH_BRIDGE__
if (bridge === undefined) {
  document.body.textContent = 'Desktop bridge missing — the preload did not run.'
  throw new Error('desktop bridge missing')
}

const root = document.getElementById('root')
if (root === null) throw new Error('desktop splash: missing #root')

wireSplashActions(
  () => { bridge.retry() },
  () => { bridge.openLog() },
  () => { bridge.quit() },
)
const splash = mountSplash(root, appIconSvg)
const stopHostErrors = bridge.onHostError((message) => { splash.showError(message) })

window.addEventListener('beforeunload', () => {
  stopHostErrors()
  splash.dispose()
}, { once: true })

console.log('[renderer:startup] splash shown')
