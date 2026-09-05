# Changelog

All notable changes to `dsh-visualizer` are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Changed

- **Sharing is now write-on-demand instead of automatic.** Every render used to mirror to disk the moment it settled, whether or not anyone ever intended to share it; the accumulated directory only bounded itself by `artifactRetentionDays`. Nothing is written now until a card's **Export** control asks for it — and that request names only the call (`{callId}`), never document bytes: the host reads `title`/`html` straight out of the call's own durable session log, verifies it settled successfully as a `visualizer` call, and only then writes it. The write is idempotent (exporting the same call twice reproduces the same file) and rate-limited (30 requests/minute) against a scripted loop.
  - The card's Share button is now two states in one slot: **Export** until the write confirms, then **Share** (open) once it has — kept as two separate clicks rather than write-then-open in one, specifically to avoid a popup blocker on the tab `window.open` would otherwise have to make after an awaited network call. **Copy share link** and a new **Unshare** control (arm-then-confirm, like the gallery's own Delete, removing the export and returning the card to Export) only ever appear once something is actually exported — there is nothing to copy or unshare before that, so Copy-link no longer needs to trigger an export of its own the way it briefly did.
  - New host dependency on `@deepseek-ai/dsh-session` (`ctx.sessions`), replacing the loosely-typed `session/event` listener the streaming mirror used — this plugin previously named that package only in a comment explaining why it deliberately avoided depending on it; the export-on-demand read needs a real, durable, replayable log lookup (`Session.snapshotEvents()`) that a live event listener cannot provide after the fact.
  - The streaming `.partial` sidecar mirror is gone entirely — it wrote to disk every ~120ms for every render whether or not it was ever shared, and nothing had ever read it back.
  - The system prompt's sharing note changed from "every render is saved automatically" to pointing the model at the Share control instead — the underlying reason to avoid a duplicate file-tool write is unchanged (the conversation log was always the actual durable copy), only the description of what the export route does changed.
  - The rendered document's own bridge gained a read-only `window.share` (`{exported, url}`), requested at boot and re-pushed on every change, with a `dsh-share-status` window event alongside it for a document that wants to react rather than poll. Deliberately read-only — there is no bridge call to trigger a share from inside the document, since that would recreate the automatic-write behavior this whole change removed, just moved one layer down into model-authored script.
  - A page reload remounts every card at "not exported," since export status was pure in-memory React state with no way to tell a genuinely-unexported call apart from an already-shared one whose page just happened to reload. `useExportControl` now checks once on mount — the client already computes the exact name an export would carry, so a plain `HEAD` request against that name recovers the correct state instead of showing Export again for something already on disk. A user's own click always wins over a slower-resolving check: the reconciliation only ever moves a card out of `idle`, never overwrites an in-progress or already-settled one.

## [0.8.0] - 2026-09-06

### Added

- Artifact gallery: a new "Artifacts" tab beside Chat and the trajectory view, listing every finalized export the host currently holds — title, kind, size, and modified time, newest first — with Open, Copy link, and Delete on each row, a search box filtering by title, kind and date filter chips, a shown/total count, and a manual Refresh (there is no push channel telling the tab a new render just settled elsewhere in the conversation, though switching to the tab itself does refetch — the harness remounts a `conversation.view` tab's component on every switch into it). Every render was already mirrored to disk and reachable at a stable share link the moment it settled, but the only way back to one was to still have its link; this makes the accumulated exports directory visible instead of write-only, and now prunable from the same place. Delete is a two-click arm/confirm on the row itself (auto-reverting after a few seconds or on blur) rather than a native `confirm()` dialog.
  - Backed by a new listing request at the exports route's own root (`GET /artifacts/visualizer/?k=<key>`) and a new per-name `DELETE /artifacts/visualizer/<name>?k=<key>`, both gated by the same capability token as any single export page; `DELETE` refuses a planted symlink the same way `GET` does. Tracks the same `shareArtifacts` switch as the Share control: no route, no tab.
  - The client's compile-time `slots.register` face (vendored from the harness, see `vendor/harness-client-runtime/README.md`) gained a third overload for list-kind slots (`id`/`order`/`label`) to register the tab — the pinned snapshot predates any use of `conversation.view` in this plugin.

- A failed `visualizer` call now states its cause on the row (the thrown message from the result content, bounded to 160 characters) instead of only an alert icon whose tooltip read `Error: E_TOOL`. The over-limit document and the out-of-range height were previously undiagnosable without opening the trajectory view.

- Copy share link control on both cards, beside Share: puts the export page's address on the clipboard directly. Sharing previously meant opening the page in a new tab only to copy the URL back out of the browser's address bar.

- Fix control on a failed render: a settled card whose document failed to load a library or threw at runtime now offers one click that asks the model to repair it, composing the failure (the failed source URL, the error message and its line) into a `[widget]` turn. These failures were previously a dead-end text notice — the settle-time check compiles script bodies without running them, so the model's own tool result said the document check passed. One request per card; the control stays visible and relabeled once spent, since the repaired render arrives as a card of its own.

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

[Unreleased]: https://github.com/abidhmuhsin/dsh-visualizer/compare/v0.8.0...HEAD
[0.8.0]: https://github.com/abidhmuhsin/dsh-visualizer/compare/v0.7.0...v0.8.0
[0.7.0]: https://github.com/abidhmuhsin/dsh-visualizer/compare/v0.6.0...v0.7.0
[0.6.0]: https://github.com/abidhmuhsin/dsh-visualizer/compare/v0.5.0...v0.6.0
[0.5.0]: https://github.com/abidhmuhsin/dsh-visualizer/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/abidhmuhsin/dsh-visualizer/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/abidhmuhsin/dsh-visualizer/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/abidhmuhsin/dsh-visualizer/releases/tag/v0.2.0
