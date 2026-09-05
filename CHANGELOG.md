# Changelog

All notable changes to `dsh-visualizer` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Inspect control on the settled/running card: jumps to the call's raw arguments and result in the harness's trajectory view. Only available on the in-place card (`ResultRow`) — the turn-tail chain's owner currency carries no per-call inspect capability, so the republished copy there shows no such control.

### Fixed

- Runaway frame growth ("double height", excess blank space below the content): the auto-sizing ResizeObserver could feed back into its own measurement for documents whose layout depends on their own current size — a `100vh`/`100dvh` container (its viewport IS the frame's current height) or a "responsive" chart canvas filling an intrinsically-unsized container — each resize measuring taller, growing the frame, and re-triggering. The shell now stops trusting resize-driven measurements after 6 consecutive same-direction growth ticks, the loop's signature; explicit content-driven reports (render/commit/heartbeat) are unaffected.

## [0.7.0] - 2026-09-04

### Fixed

- Settled cards no longer vanish behind harness `0.1.2-rc.1`'s Compact transcript view fold once their turn closes — closes the plugin-side gap noted in `0.6.0`. The card stays live in place while its turn is open, republishes once through the harness's `conversation.chat.turnTail` hole exactly when the turn closes, and skips that republish in Normal view (which never folds) to avoid a duplicate.

### Breaking

- **Minimum harness version is now `0.1.2-rc.1`.** Raised from `0.1.2-alpha.2` — the version this release was developed and tested against; older prerelease builds are untested. Installs on an older harness should stay on a prior tagged release.

## [0.6.0] - 2026-09-02

### Added

- Comment mode on settled cards: toggle the pen control, click an element or drag an area inside the frame, and each pick becomes a numbered comment row (selector, markup, text) below the renderer. Send composes every pick's note and locator into one `[widget]` prompt for the model.

### Changed

- Card footer actions restyled; prompt items shown as a numbered list; sending the composed comment prompt exits comment mode.

### Fixed

- `composeAnnotationPrompt`'s last-resort tier (many/long comments) no longer drops its instruction header or slices an item mid-string — it now keeps the header and appends only whole items.
- The comment-mode toggle's tooltip is now fully localized (en/zh) instead of hardcoding English text.
- Removed a circular import between `annotate.ts` and `AutoFrame.tsx`.

### Documentation

- Noted that harness `0.1.2-alpha.3`'s default "Compact" transcript view folds settled tool-call cards (including visualizer's) behind a disclosure line once their turn closes, with no plugin-side opt-out yet. Workaround: Settings → Transcript view → Normal.

## [0.5.0] - 2026-09-01

Tracks the DeepSeek Harness `0.1.2-alpha.3` conversation/chat split.

### Changed

- `conversationEvents` service renamed to `uiConversation`; events now register through `ctx.uiConversation.events`.
- Chat Node ownership split out of `dsh-client-ui-conversation` into the new `dsh-client-ui-chat` package (`conversation.chat.node` slot key and `ChatNodeDataMap`), added as a peer/dev dependency and to `dsh.client.inject`.
- Peer/dev `dsh-*` ranges bumped from `^0.1.1-rc.2` to `^0.1.2-alpha.2` (npm's prerelease-tuple matching otherwise excludes `0.1.2-alpha.3`); `cordis` bumped to `^4.0.2`.
- Tracked `dsh-llm`'s `CallId` → `ToolCallId` rename.

### Breaking

- **Minimum harness version is now `0.1.2-alpha.3`.** Older builds park the tool at `pending (waiting for service: conversationEvents)`. Installs on harness `0.1.1-rc.2` or earlier should use the frozen `pre-harness-0.1.2-alpha3-compat` branch instead.

## [0.4.0] - 2026-09-01

Card UX pass over the streaming and settled rows, plus an inspect false-positive fix.

### Added

- Loader wave animation on streaming labels: 3-character bobs, staggered left-to-right, gated on `prefers-reduced-motion`.
- Fullscreen control on settled rows: expands the frame wrapper to the viewport; Escape or a second click leaves.
- Agent guide (`CLAUDE.md` / `AGENTS.md`) covering project patterns, PR flow, and the bot-comment convention.

### Changed

- Wider gap before the loading message (8px → 24px).

### Fixed

- Trailing ellipsis now appends to loading messages unless they already end with one (fixed an end-anchor bug in `withEllipsis`).
- Inspect false-positive: script bodies are now masked from the tag scan.

## [0.3.0] - 2026-08-27

### Added

- Streaming export fanout with a serve route, gated by the `shareArtifacts` flag.
- Content-digested share names and friendly download names; retention sweep on activation.
- Per-boot capability token gating the exports route.
- Share control opening the served export page.

### Changed

- Share names use an imul-lane fingerprint instead of BigInt FNV-1a for the content digest.

### Fixed

- Bounded fanout maps, awaited ready state in serve, and noted unavailable share instead of failing silently.
- `shareKey` double-trim and trailing whitespace.

## [0.2.0] - 2026-08-26

Initial tagged release.

### Added

- Core `visualizer` tool: streams a self-contained HTML document into chat, with a live preview in a sandboxed inline frame.
- Settle-time document check with in-turn re-render on defects.
- Authoring guide with a configurable guide tool and module set; `visualizer_guide` recipe tool for just-in-time module specs.
- Frame chrome: diagonal streaming sheen, navigation guard converting anchor clicks, runtime-error notices, host theme token injection.
- Loading messages with a sweep animation.

[Unreleased]: https://github.com/abidhmuhsin/dsh-visualizer/compare/v0.7.0...HEAD
[0.7.0]: https://github.com/abidhmuhsin/dsh-visualizer/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/abidhmuhsin/dsh-visualizer/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/abidhmuhsin/dsh-visualizer/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/abidhmuhsin/dsh-visualizer/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/abidhmuhsin/dsh-visualizer/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/abidhmuhsin/dsh-visualizer/releases/tag/v0.2.0
