# dsh-tool-visualizer

English | [中文](README.zh.md)

Model-facing `visualizer` tool: the argument-streaming half of the inline HTML presentation. The model passes the complete self-contained document as the `html` argument — last in the schema — and the browser card (`dsh-client-ui-visualizer`) decodes a growing prefix of the streamed call arguments into a live preview while the model is still writing. Nothing touches the workspace: the document's durable home is the logged `tool/call` arguments themselves.

**The document is the call.** `execute` validates only what the arguments carry — a non-empty document, the configurable `maxHtmlBytes` cap (default 256 KiB, counted as UTF-8 bytes), an integer opening height clamped to 50–2000 px (the frame then grows with its content), and a non-blank explicit title — and returns a one-line canonical result (`Rendered <title> (<bytes> bytes, <height>px frame)`). No filesystem service is injected, no presentation meta is projected: the settled card re-reads the same logged arguments.

**Schema order is the streaming contract.** `title` and `height` precede `html` so both are decodable before the document opens; `html` last means every streamed prefix of the arguments JSON ends inside the document string, which is what makes a prefix preview possible. The tool description states this ordering so the model keeps it.

**Token cost is the accepted trade.** The document bytes ride in the model-visible call arguments and replay into later requests, exactly like the content of a `write` call of the same size; the workflow saves the separate write round-trip. A document that must persist in the workspace uses `write` plus `show_html` instead — the prompt guidance says so.

## Model Experience

### System-prompt guidance (`tool:visualizer`)

#### What the model sees

One prompt section teaching the call-direct workflow, ordered with the per-tool guidance sections.

##### Verbatim text

```markdown
To present an HTML page in the chat, call visualizer with the complete self-contained document as the html argument, html last; the document streams into a sandboxed frame while you write. Use write plus show_html instead when the document must persist as a workspace file.
```

#### Token effect

Fixed: one short section, always present when the tool is composed.

#### KV Cache effect

Stable repeated prefix; the section text is static, so it never invalidates an existing prefix.

### `visualizer` tool schema

#### What the model sees

Three primitive parameters — `title` (optional string), `height` (optional integer), `html` (required string, declared last) — plus the description in the generated [tool catalog](../../../docs/tool-catalog.md#deepseek-aidsh-tool-visualizer).

#### Token effect

Conditional: the schema appears only in sessions whose preset mounts this tool; per-call arguments carry the complete document, so cost scales with document size up to `maxHtmlBytes`.

#### KV Cache effect

Append-only: each call's arguments append after the existing prefix; nothing replaces or rewrites earlier request tokens.

## Known Limitations and Deferred Work

- **The document consumes context** — the bytes live in the model-visible call arguments and replay every later turn until compaction; oversized or durable artifacts belong to the `write` + `show_html` flow.
- **A reordered schema defeats the preview** — if the model places `html` first, the prefix decoder sees no settled `title`/`height` and the card falls back to defaults until the call completes; the description and prompt guidance pin the order but cannot enforce it.
- **The height argument is an opening hint only** — the frame auto-grows with its content and clamps at 4000 px, so a `height` value never bounds what the card shows; the model should not rely on it for exact framing.
