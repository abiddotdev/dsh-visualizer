# @deepseek-ai/dsh-client-ui-generativeui

English | [中文](README.zh.md)

Streaming inline HTML card, browser half: the live `generativeui-stream` chat node that previews a `render_html` call while the model writes it, plus the keyed `render_html` tool row that takes over when the call dispatches.

**Live preview decodes the streamed arguments.** Tool-call argument deltas accumulate in the conversation engine; the node's State keeps this step's `render_html` blocks (foreign tools are dropped before their arguments accumulate) and a string-aware prefix scanner (`partial-args.ts`) decodes the growing `html` string value — unescaping JSON escapes, dropping a dangling escape, a cut `\u` sequence, or a cut surrogate pair — together with the earlier-settled `title` and `height`. Replay of a logged transcript rebuilds the identical card sequence because every input is a session event.

**The live frame never reloads.** Each card loads one shell document (`shell.ts`: white page canvas unless the document paints its own, CSP with the public-CDN allowlist, streaming freeze, and a `postMessage` bridge) into a `sandbox="allow-scripts"` null-origin iframe and feeds it markup through `StreamFrameController` — latest-wins coalescing on one animation frame with a 50 ms minimum gap, messages buffered until the shell's `load` fires. The bridge applies prefixes as inert markup (`innerHTML` never executes `<script>`; handler attributes fire only inside the null-origin frame), strips animations for the whole streaming phase, and on the single terminal `commit` lifts the freeze and runs the document's scripts exactly once by cloning each `<script>` node. An interrupted stream keeps its last painted partial and never runs scripts.

**The frame sizes itself to its content.** Both cards open short — the streaming card at chat-line height, the settled row at the call's `height` argument — and the bridge reports measured content height back (`size` messages plus a `ResizeObserver`, matched to the frame's own window and clamped to 24–4000 px host-side), so the card grows with the document like chat text and scrolls only past the cap.

**The settled row replays through the same shell.** When the executor logs `tool/call`, the streaming node hides and the keyed `tool.call.toolview` row commits the complete arguments into the shared shell frame — one commit, scripts run once. Its download control materializes the same bytes client-side as a Blob under a sanitized file name; it appears only on a settled successful call, because a partial download is corrupt by definition.

**Both rows are inert until their tool exists.** The cards register under open key domains (`conversation.chat.node` key `generativeui-stream`, `tool.call.toolview` key `render_html`); the standard agent preset mounts `@deepseek-ai/dsh-tool-generativeui`, and sessions on presets without it never produce such calls. This package composes no host behavior at all.

The `/client` export surface is the plugin body (`apply`/`inject`) plus the composed props types.

## Model Experience

None, as this package adds no prompt content, exposes no model-facing surface, and writes no session event: it renders the streamed and settled call arguments another package produced, and its interactive state (expand/collapse flags) is component-local.

#### KV Cache effect

None: no prompt input originates here; streaming, expanding, or downloading a card changes nothing in any model request.

## Known Limitations and Deferred Work

- **Scripts deferred to commit only** — the live preview paints inert markup; a document whose behavior depends on its scripts shows nothing interactive until the call completes, by design (partial DOM plus running scripts is both wrong and a fingerprinting hazard pi_generative_ui demonstrated empirically).
- **Late layout changes may not re-report** — height reports ride each render/commit plus a root-element `ResizeObserver`; content that grows after the commit (late-loading images, async scripts) can exceed the frame until the next message arrives.
- **Reordered arguments degrade the live card** — if the model places `html` before `title`/`height`, the scanner cannot see them and the card falls back to its defaults until the call completes; the tool's description pins the order but the client cannot enforce it.
- **CDN reachability is the document's problem** — the shell CSP allows the same four public CDNs the settled document assumes; an artifact referencing anything else loads partially with no card-level diagnostic.
