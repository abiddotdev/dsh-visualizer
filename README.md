# dsh-visualizer

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) plugin: the **`visualizer`** tool streams a self-contained HTML document into the chat as the model writes it, live-previewed inside a sandboxed inline frame — Chart.js, external CDN libraries, and all. Nothing touches the workspace; download is a client-side Blob.

One package ships both halves: the model-facing tool (`lib/index.js`) and the Web GUI card (`lib/client.js`, declared through the package's `dsh.client` manifest). Installing it activates a bundle layer that mounts both — no manual profile patch editing.

## Install

Requires Node ^22.19 or >=24 and a DeepSeek Harness installation:

```sh
# install into the default web profile
dsh plugin --profile web add 'git+https://github.com/abidhmuhsin/dsh-visualizer.git'

# or install into any custom profile
dsh plugin --profile <your-profile> add 'git+https://github.com/abidhmuhsin/dsh-visualizer.git'
```

The first run fails with an "Add the package to allowBuilds" hint: pnpm's supply-chain gate blocks the package's `prepare` build until allowlisted, and the hint carries the exact key (keyed on the codeload URL and the resolved commit). Paste that block under `allowBuilds:` in `~/.dsh/profiles/<your-profile>/pnpm-workspace.yaml` and re-run the command. Keys pin the commit, so after a new upstream push, reinstalling prints a fresh hint to paste.

Then boot the profile and ask the model to **"visualize …"** — the streamed document appears inline while it is being written. Pin a release with a ref fragment: `'git+https://github.com/abidhmuhsin/dsh-visualizer.git#v0.2.0'`. To remove:

```sh
dsh plugin --profile <your-profile> remove dsh-visualizer
```

## How it mounts

The package declares a `dsh.bundle` manifest (`dsh.bundle.patch` → `./cordis.patch.yml`), so `dsh plugin add` installs it as a profile patch layer automatically. That layer inserts one loader row for the package itself:

- The host Loader imports `lib/index.js`; its `apply()` registers the model-facing `visualizer` tool.
- The Web GUI's client module system scans Loader entries for packages declaring a `dsh.client` manifest and serves `lib/client.js`, which renders the streaming card and the settled row.

## How it works

The tool declares `html` as its last schema parameter, so the logged tool-call arguments carry a growing document prefix while the model streams. The card decodes that prefix and paints a live preview inside a null-origin sandboxed iframe with a transparent canvas; at dispatch the final DOM is reconciled and scripts run once, in document order.

The model-facing authoring guide lives in `src/guide/`: gate rules (when a visual belongs in the conversation, and `write` + `show_html` when a file is wanted), the universal streaming contract (style-first ordering, the CDN allowlist, animation limits, height-reporting pitfalls), and a per-artifact-type roster under `src/guide/modules/` — one file per type, so each kind of visual is tuned without touching the others. The CDN hosts named there are the same four the shell CSP enforces; change both lists together.

## The widget bridge

A rendered document's scripts may call `sendPrompt(text)` — the shell bridge posts it to the host, which submits it as a `[widget]`-prefixed user turn so a dashboard can ask the agent a follow-up about what it shows. The host validates the payload (string, non-blank, ≤ 4000 chars) and rate-limits to one accepted prompt per 3 seconds per widget, so a misbehaving script cannot loop the agent. Scripts only run after a document completes, so the bridge can never fire mid-stream.

Scripts may also call `openLink(url)`: the host performs the scheme check itself — http(s) only, opened with `noopener,noreferrer` — so widget code cannot reach `javascript:`, `data:`, or `file:` targets.

The frame's permission policy delegates exactly one capability: `fullscreen *`, so a chart or dashboard document may expand (Escape reverses it). Clipboard, popups, camera, and payment stay undelegated.

## Card controls and failure notices

A settled card offers two client-side actions over the same bytes: **Download** (a Blob URL; a bare `<svg>` document saves as `.svg` with the SVG mime type, everything else as `.html`) and **Copy HTML** (`navigator.clipboard.writeText` with a brief confirmation; a denied clipboard shows none). When an external script inside the document fails to load, the card shows a load-failure notice — the alternative is a document that renders but silently does nothing.

## Development

```sh
pnpm install
pnpm test     # vitest unit tests for both halves
pnpm build    # tsc emits lib/types declarations, tsdown bundles lib/ runtime + lib/client.js
```

Both halves follow the DeepSeek Harness plugin contract (`ctx.effect()` registrations, invariant companion under `/invariant`). The client bundle keeps the loader's lazy-CJS factory artifact format and the cross-plugin purity rule: platform modules stay external, everything else inlines.
