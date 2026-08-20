/**
 * Lightweight startup view for the standalone splash window. Animation is
 * delegated to CSS so Host startup cannot stall a renderer frame loop.
 * @module @deepseek-ai/dsh-desktop/splash-view
 */

/** Controls the mounted desktop splash view. */
export interface SplashController {
  /** Fade out the splash and remove its container. */
  fadeOut(): Promise<void>
  /** Replace the progress view with recoverable startup diagnostics. */
  showError(message: string): void
  /** Stop future controller work without removing the container. */
  dispose(): void
}

function prefersReducedMotion(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches
}

let retryAction: () => void = () => {}
let openLogAction: () => void = () => {}
let quitAction: () => void = () => {}

/**
 * Connect the error-panel actions to the Electron preload bridge.
 * @param retry Requests a fresh Host boot.
 * @param openLog Opens the desktop log file.
 * @param quit Exits the desktop process.
 */
export function wireSplashActions(retry: () => void, openLog: () => void, quit: () => void): void {
  retryAction = retry
  openLogAction = openLog
  quitAction = quit
}

function actionButton(label: string, className: string, action: () => void): HTMLButtonElement {
  const button = document.createElement('button')
  button.type = 'button'
  button.textContent = label
  button.className = className
  button.addEventListener('click', action)
  return button
}

/**
 * Mount the community-branded splash view.
 * @param container Root element owned by the standalone splash document.
 * @param iconSvg Trusted application icon markup bundled with the renderer.
 * @returns A controller for error and teardown transitions.
 */
export function mountSplash(container: HTMLElement, iconSvg: string): SplashController {
  let disposed = false
  container.classList.add('dsh-splash')
  if (prefersReducedMotion()) container.classList.add('dsh-splash--reduced-motion')

  const stage = document.createElement('main')
  stage.className = 'dsh-splash-stage'
  stage.setAttribute('aria-live', 'polite')

  const signal = document.createElement('div')
  signal.className = 'dsh-splash-signal'
  signal.setAttribute('aria-hidden', 'true')

  const mark = document.createElement('div')
  mark.className = 'dsh-splash-mark'
  mark.innerHTML = iconSvg
  mark.querySelector('svg')?.setAttribute('focusable', 'false')

  const label = document.createElement('h1')
  label.className = 'dsh-splash-label'
  label.textContent = 'DSH Desktop Community'

  const loading = document.createElement('p')
  loading.className = 'dsh-splash-loading'
  loading.textContent = 'Starting local DSH Host…'

  stage.append(signal, mark, label, loading)
  container.appendChild(stage)

  return {
    async fadeOut(): Promise<void> {
      if (disposed) return
      disposed = true
      await new Promise<void>((resolve) => {
        let settled = false
        const finish = (): void => {
          if (settled) return
          settled = true
          resolve()
        }
        container.classList.add('dsh-splash--fade')
        container.addEventListener('transitionend', finish, { once: true })
        setTimeout(finish, 320)
      })
      container.remove()
    },

    showError(message: string): void {
      if (disposed) return
      container.classList.add('dsh-splash--error')
      container.querySelector('.dsh-splash-error-panel')?.remove()

      const panel = document.createElement('section')
      panel.className = 'dsh-splash-error-panel'
      panel.setAttribute('role', 'alert')

      const title = document.createElement('h2')
      title.className = 'dsh-splash-error-title'
      title.textContent = 'DSH Desktop Community failed to start'

      const detail = document.createElement('pre')
      detail.className = 'dsh-splash-error-detail'
      detail.textContent = message

      const actions = document.createElement('div')
      actions.className = 'dsh-splash-error-actions'
      actions.append(
        actionButton('Retry', 'dsh-splash-btn dsh-splash-btn--primary', () => { retryAction() }),
        actionButton('Open Log', 'dsh-splash-btn', () => { openLogAction() }),
        actionButton('Exit', 'dsh-splash-btn', () => { quitAction() }),
      )
      panel.append(title, detail, actions)
      container.appendChild(panel)
    },

    dispose(): void {
      disposed = true
    },
  }
}
