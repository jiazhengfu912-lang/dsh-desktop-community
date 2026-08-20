# `@deepseek-ai/dsh-host-directory-picker-electron`

English | [中文](README.zh.md)

This package is the Electron Service Provider for the [directory-picker capability seam](../directory-picker/README.md). It registers the `native` capability on `ctx.directoryPicker` and opens Electron's operating-system directory chooser on the desktop Host display. Remote Web deployments use the browse provider instead.

## Behavior

`capability()` returns one stable `{ kind: 'native', pick(signal) }` object for the service lifetime. `pick()` opens `dialog.showOpenDialog()` with `openDirectory` and `createDirectory`, then returns the first selected absolute directory path. It returns `null` when the caller is already cancelled, the operator cancels the dialog, or Electron returns no path.

The provider does not list directories, read directory contents, persist a selection, or add the selected directory to a Workspace. Those operations remain owned by the consumer and the shared directory-picker seam.

## Composition

The desktop overlay mounts this package in place of the Web directory-picker composition. The package is private and is distributed only inside the DSH Desktop Community installer. Electron remains a peer dependency because the dialog belongs to the application runtime. No package configuration is exposed.

## Model Experience

### Native directory selection

#### What the model sees

Nothing; `ctx.directoryPicker` serves the local GUI and registers no prompt text, tool, or request content.

#### Token effect

None; the selected native path is returned to the Workspace UI rather than a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- The chooser requires an interactive Electron Host with access to the operating-system display.
- Cancellation before `pick()` returns prevents a new dialog; an abort that arrives after Electron opens the modal dialog cannot close that native dialog.
- The provider selects one directory per call and does not expose remote browsing or multi-root selection.
