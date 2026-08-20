# Agent Note: Community Desktop Distribution

Status: implemented

English | [中文](2026-08-20-community-desktop-distribution.zh.md)

## Problem

The upstream monorepo does not publish this community-maintained Windows desktop installer. Distributing an installer directly from a mixed development checkout would make its source provenance, product identity, license payload, plugin dependency versions, and data-reuse claims difficult to verify. Reusing upstream product artwork or promising complete Web-to-Desktop migration would also misstate what the package owns.

## Decision

This repository publishes the application as **DSH Desktop Community**, with the app id `io.github.jiazhengfu912.dshdesktop`, independent artwork, and a stable `DSH-Desktop-Community-Setup-x64.exe` asset name. User-facing material identifies the upstream [DSH repository](https://github.com/deepseek-ai/deepseek-harness) for attribution but states that the distribution is independently maintained and not endorsed by DeepSeek. Internal `@deepseek-ai/*` package names remain unchanged compatibility identifiers.

The Desktop application, community brand, document viewer, and Electron directory-picker packages are private community assemblies. Their manifests point to this repository and omit npm publication metadata, so the upstream DSH publication path refuses to publish them as official packages.

Official artwork stays owned by `ui-brand-official`; generic sidebar and conversation packages provide no product-art fallback. The Desktop builder excludes the official brand, badge-skill, and unused Web frontend packages from the application directory, while the Desktop overlay installs `ui-brand-community`. That plugin also shadows the `settings.onboarding` cell named `welcome-notice` and completes it without rendering, so the Desktop application does not inherit the upstream product-specific testing notice; the shared Web plugin and acknowledgement remain unchanged. The overlay supplies `DSH Desktop Community` as the model-visible deployment identity while the shared system-prompt default remains unchanged. Packaged validation rejects the excluded package directories, whale resources, `logo=deepseek` markup, and official artwork or product-name tokens in renderer and configuration text; compatibility package names remain allowed.

Release builds start from the repository commit recorded in `build-info.json`, include `LICENSE` and `THIRD_PARTY_NOTICES.md`, and publish the installer, `SHA256SUMS.txt`, and build information through GitHub Releases. Package assembly invokes Electron Builder with publication disabled; the validated GitHub Release step alone owns asset publication. The installer is not stored as a Git blob. The unsigned preview release remains a normal latest release so the stable `/releases/latest/download/DSH-Desktop-Community-Setup-x64.exe` URL resolves; release text states the missing signature and SmartScreen consequence.

Automatic GitHub Actions in the community repository are limited to Windows Desktop CI on pull requests and `master`, plus Desktop release assembly for `desktop-v*` tags. Both Desktop workflows also expose `workflow_dispatch` so maintainers can retry the same pinned validation without changing their automatic event policy. Desktop CI separates manual and repository-event concurrency groups, so delayed push delivery cannot cancel an explicit maintainer validation. Every inherited upstream workflow is manual-only through `workflow_dispatch`; the reusable single-executable builder also keeps `workflow_call` so a manually dispatched Python release can invoke it. The fork does not assume access to upstream enterprise runners, API secrets, GitHub Pages, or npm publication credentials.

The carrier pins Electron `43.4.1` exactly, and the Electron-native directory-picker package accepts the same supported major. Before application readiness, the main process acquires Electron's process-wide single-instance lock and subscribes to `second-instance`; a focus request received before either visible window exists remains pending until the splash is ready. No single-instance state is written into Electron `userData` or `DSH_HOME`.

Every privileged renderer-to-main IPC channel names either the application or splash role. Authorization requires the current role's exact `WebContents`, its main frame, and its fixed URL and origin. Both windows deny renderer-initiated document navigation, redirects, and child windows; only lifecycle-owned `loadURL`, `loadFile`, and reload operations can replace their documents.

The desktop Host resolves the ordinary DSH home and opens the `web` profile. On the same computer, for the same Windows user and the same `DSH_HOME`, it reuses healthy Host sessions, attachments, settings, credential references, profiles, plugin declarations, presets, and user skills in place. This behavior is data reuse, not migration: it does not copy project files, browser `localStorage`, cloud conversations, data from another user or computer, or corrupt session logs. Web and Desktop Hosts must not write the same home concurrently.

Plugin package operations use the application's private Node and pnpm runtime through `desktopProfiles` and `desktopPnpm`. The app-specific runtime keeps pnpm's `store` and `cache` directories under Electron `userData`; it leaves the active profile's `.npmrc` and inherited proxy configuration available. The Desktop CLI launches the packaged pnpm JavaScript entry without a command shell, so Unicode paths and Windows command metacharacters remain literal argv. Registry and local-file packages do not require a global pnpm command. Git-backed specifications require an external Git for Windows installation and fail before pnpm when Git is unavailable.

## Verification

- Source validation runs the root build plus desktop typecheck and unit tests.
- Focused security validation rejects stale senders, subframes, wrong URLs, renderer navigation and child windows, and exercises second-instance focus both before and after window readiness.
- Client validation proves that the community identity wins the `welcome-notice` slot cell, completes it without rendering, and restores the upstream occupant on unload. System-prompt validation proves the deployment identity override. Packaged validation starts the worker, document viewer, sidebar, Host, plugin fixture install, and plugin inventory from the packaged application and verifies the neutral brand closure.
- Installer validation checks silent installation, installed startup, shortcut and executable metadata, license payloads, silent uninstallation, and preservation of a temporary `DSH_HOME`.
- Release validation rejects a mismatched version/tag, records the upstream base and tool versions, and checks published asset hashes after download.
- Workflow validation parses all Action YAML files, permits automatic repository events only in the two Desktop workflows, and requires a manual dispatch path for every workflow; the documented reusable builder also keeps `workflow_call`.

## Alternatives considered

**Publish the existing development installer.** Rejected because an artifact assembled from a mixed checkout cannot establish a clean source closure and can preserve incompatible plugin peers, private paths, stale branding, or missing notices.

**Use DeepSeek or whale branding for recognition.** Rejected because the community publisher does not own the upstream trademark identity. Upstream attribution remains explicit without presenting this installer as an official product.

**Rewrite the shared welcome notice for Desktop.** Rejected because that copy and its acknowledgement belong to the upstream Web product. A Desktop-only slot shadow removes the inapplicable step without forking its modal, persistence, or shared Web semantics.

**Copy all Web and browser data into Electron storage.** Rejected because Host data already has an authoritative `DSH_HOME`, while browser-only state has different ownership and no complete migration format. Copying credentials or sessions also creates unnecessary security and consistency risks.

**Bundle Git, sign the initial installer, or add automatic updates.** Rejected for the first community preview because each requires a separate supply-chain, licensing, credential, and lifecycle decision. Their absence is disclosed as a release limitation.

**Coordinate instances with a PID file and focus-request polling.** Rejected because checking a PID and then writing a file is not an atomic ownership decision, PID reuse can identify the wrong process, and file failures previously allowed another Host to start. Electron's lock owns process exclusivity and its event carries the focus request.

**Trust any frame carrying the preload bridge.** Rejected because a stale window, subframe, or navigated document must not inherit Host API authority from the preload. Role, frame, and fixed-document checks keep that authority with the two main-process-created documents.

**Keep upstream automation enabled in the community fork.** Rejected because those workflows require upstream-owned runners, secrets, Pages configuration, or registry publication authority. They remain available for explicit maintainer dispatch without becoming automatic community-repository events.

## Consequences

The independent app id and product name avoid replacing an upstream-branded installation, but users must choose which Host process owns a shared `DSH_HOME`. A fixed asset name provides a one-click latest URL, while `SHA256SUMS.txt` provides integrity evidence without code-signing identity. Git-backed plugin users install Git separately, and users must handle SmartScreen for the unsigned preview. Electron patch updates are deliberate lockfile changes rather than range resolution, renderer-created external windows require a future explicitly authorized main-process action, and upstream validation or publication workflows require a deliberate manual dispatch. Cross-computer transfer, browser UI-state import, cloud import, automatic update, and corrupt-log repair remain outside the distribution.
