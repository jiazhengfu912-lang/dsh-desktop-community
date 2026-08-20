# Agent Note: Desktop Renderer Authority and Single Instance

Status: implemented

English | [中文](2026-08-20-desktop-renderer-authority-and-single-instance.zh.md)

## Problem

The application and splash windows shared one restricted preload, but privileged IPC handlers accepted messages without proving which current window and frame sent them. A stale window, subframe, or renderer-navigated document could therefore retain Host API authority. The windows also allowed renderer-requested navigation and child windows, extending the preload to documents the main process did not select.

Desktop process ownership used a PID file under Electron `userData`. Checking a PID before writing the file was not atomic, PID reuse could identify an unrelated process, and file errors allowed startup to continue as another primary. The carrier also resolved Electron 36, an unsupported runtime line, through a semver range.

## Decision

`RendererAuthority` assigns every fixed renderer-to-main channel to either the application or splash role. A message is authorized only when its sender is the role's current `WebContents`, `senderFrame` is that WebContents' current main frame, and the frame has the role's exact URL and origin. Event-style unauthorized messages are ignored, unauthorized invoke handlers reject, and synchronous storage reads return no stored data. The `rendererReady`, `rendererFailed`, `retry`, and `quit` lifecycle channels use the same checks. Registration returns an idempotent retirement function that captures the exact WebContents, so a `closed` callback never reads a destroyed BrowserWindow.

Every main-process-created application or splash window installs `denyRendererNavigation` before loading its document. The guard cancels `will-navigate` and `will-redirect` and returns `deny` from `setWindowOpenHandler`. Electron does not emit `will-navigate` for main-process `loadURL`, `loadFile`, or reload operations, so the lifecycle retains sole control of document replacement. The main process also rejects renderer page-title updates so the visible window keeps the fixed community product name.

The process calls `app.requestSingleInstanceLock()` before `app.whenReady()`. A process denied the lock quits without booting a Host; the primary subscribes to `second-instance`. `SecondInstanceFocus` focuses or restores the current visible splash/application window and retains one request that arrives before a focus target exists. This mechanism writes neither coordination files nor `DSH_HOME` data.

The Desktop application and Electron directory-picker development closure pin Electron `43.4.1`; the directory-picker peer accepts the 43.x supported major. The only used Electron 43 breaking behavior is the native directory dialog's new Downloads-directory default when `defaultPath` is absent, which the workspace picker accepts. No removed Electron API is used.

## Verification

- Renderer tests accept only the current role and reject a replaced WebContents, subframe, and wrong URL/origin.
- Window-guard tests cancel navigation and redirects and deny a renderer child-window request.
- Renderer retirement tests dispose a captured WebContents after its BrowserWindow becomes inaccessible.
- Single-instance tests exercise lock denial and second-instance focus before and after a target becomes ready, including a destroyed stale target.
- A packaged visible-GUI run observes one responsive splash-to-main handoff, no application menu or error window, and the fixed product title.
- Desktop tests and both TypeScript faces run against the installed Electron `43.4.1` declarations and binary.

## Alternatives considered

**Check only `event.sender`.** Rejected because it cannot distinguish the main frame from an iframe and does not prove that the WebContents still displays the main-process-selected document.

**Check only the URL or origin.** Rejected because a stale same-origin window would remain authorized. WebContents identity, main-frame identity, exact URL, and origin are jointly required.

**Keep the PID and focus-request files.** Rejected because independent filesystem checks cannot provide atomic process ownership and turn I/O failure into an unsafe second primary. Electron already owns a platform-specific atomic lock and focus event.

**Disable the loopback HTTP and WebSocket routes.** Rejected because generated Remotes and installed client plugins depend on those routes. This change restricts the preload IPC authority without changing the loopback transport composition.

**Keep an Electron major range.** Rejected because a reproducible desktop artifact and its native-module build target must use the reviewed runtime recorded in the lockfile. Patch upgrades are explicit dependency changes.

## Consequences

Renderer-created external windows and document navigations are denied until a future main-process action explicitly authorizes a destination. A compromised subframe, stale WebContents, or wrong document cannot invoke privileged Desktop IPC. Concurrent launches use Electron process ownership without touching Host data, while Web and Desktop remain separately responsible for not opening the same `DSH_HOME` concurrently. Electron patch updates require deliberate manifest and lockfile changes, and the native workspace picker now starts in Downloads unless the application later owns and supplies a `defaultPath`.
