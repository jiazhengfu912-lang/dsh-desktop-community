# @deepseek-ai/dsh-client-ui-brand-community

English | [中文](README.zh.md)

This package fills `sidebar.brand.mark`, `sidebar.brand.name`, and `conversation.hero.brand.mark` with the DSH Desktop Community identity. It also shadows the `settings.onboarding` entry named `welcome-notice` and immediately completes that step, so the community application does not render the upstream product-specific testing notice. Only the [desktop overlay](../../../apps/desktop/desktop.patch.yml) inserts this plugin; the upstream Web composition keeps its own brand package and notice.

The mark is an original terminal-and-circuit SVG that inherits each host surface's color and requested size. The compact name artwork pairs a geometric DSH monogram with `DESKTOP COMMUNITY`. It imports neither the fish mark nor the official wordmark. The three artwork occupants install as one declaration-aware registration set through nested `slots.inject()` calls. The notice override uses the list slot's lower-priority shadowing rule instead of copying the upstream modal or acknowledgement store; unloading this plugin restores the upstream occupant.

## Model Experience

None, as the package contributes browser presentation only; nothing here reaches a model request.

#### KV Cache effect

None; this package neither assembles nor sends a provider request.

## Known Limitations and Deferred Work

- **The package owns browser identity policy only** — window titles, executable resources, installers, and shortcuts are configured by the desktop application, while provider names remain owned by their provider plugins.
- **The wordmark uses installed monospace fonts** — exact glyph metrics can vary slightly between Windows installations, while its SVG frame and slot geometry remain fixed.
