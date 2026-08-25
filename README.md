# dsh-visualizer

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) plugin with two surfaces: the **`visualizer`** tool streams a self-contained HTML document into the chat as the model writes it, live-previewed inside a sandboxed inline frame — Chart.js, external CDN libraries, and all; and the **`canvas_draw`** tool drives a shared sketch canvas that pops open above the composer, where the model draws while you watch and you can draw back. Nothing touches the workspace; download is a client-side Blob.

One package ships both halves: the model-facing tools (`lib/index.js`) and the Web GUI cards (`lib/client.js`, declared through the package's `dsh.client` manifest). Installing it activates a bundle layer that mounts both — no manual profile patch editing.

## Install

Requires Node ^22.19 or >=24 and a DeepSeek Harness installation:

```sh
# install into the default web profile
dsh plugin --profile web add 'git+https://github.com/abidhmuhsin/dsh-visualizer.git'

# or install into any custom profile
dsh plugin --profile <your-profile> add 'git+https://github.com/abidhmuhsin/dsh-visualizer.git'
```

The first run fails with an "Add the package to allowBuilds" hint: pnpm's supply-chain gate blocks the package's `prepare` build until allowlisted, and the hint carries the exact key (keyed on the codeload URL and the resolved commit). Paste that block under `allowBuilds:` in `~/.dsh/profiles/<your-profile>/pnpm-workspace.yaml` and re-run the command. Keys pin the commit, so after a new upstream push, reinstalling prints a fresh hint to paste.

Then boot the profile and ask the model to **"visualize …"** — the streamed document appears inline while it is being written — or **"draw … on the canvas"** and the shared canvas opens above the composer. Pin a release with a ref fragment: `'git+https://github.com/abidhmuhsin/dsh-visualizer.git#v0.2.0'`. To remove:

```sh
dsh plugin --profile <your-profile> remove dsh-visualizer
```

## How it mounts

The package declares a `dsh.bundle` manifest (`dsh.bundle.patch` → `./cordis.patch.yml`), so `dsh plugin add` installs it as a profile patch layer automatically. That layer inserts one loader row for the package itself:

- The host Loader imports `lib/index.js`; its `apply()` registers the model-facing `visualizer` tool.
- The Web GUI's client module system scans Loader entries for packages declaring a `dsh.client` manifest and serves `lib/client.js`, which renders the streaming card and the settled row.

## Configuration

The bundle layer already inserts the loader row, so a profile overrides its config with a flat id-targeted patch entry — no `insert:` wrapper, which would append a second row instead of overriding the installed one — in that profile's patch layer (`~/.dsh/profiles/<your-profile>/cordis.patch.yml`); values validate against the schema at load, and a mistake fails the mount loudly. Every option carries a schema default, so an override block lists only the fields being changed; this is the complete option list at current defaults:

```yaml
- id: dsh-visualizer
  config:
    maxHtmlBytes: 262144    # default; per-call render limit, in UTF-8 bytes
    guideTool: true         # default; set false to use only the render tool
    guideModules: [chart, diagram, mockup, interactive, art]   # default; subset to teach and serve;
```

`guideModules` narrows both guide surfaces together: the standing system-prompt roster lists only those types' one-liners, and the JIT tool's argument enum accepts only those ids — a disabled type is rejected at the argument boundary before any code runs. `guideTool: false` skips the second tool registration; the render tool and the standing prompt section are unaffected. Unknown module ids, or an empty `guideModules`, fail the plugin load. Both fields default to on/all five types (`chart`, `diagram`, `mockup`, `interactive`, `art`).

## How it works

The tool declares `html` as its last schema parameter, so the logged tool-call arguments carry a growing document prefix while the model streams. The card decodes that prefix and paints a live preview inside a null-origin sandboxed iframe with a transparent canvas; at dispatch the final DOM is reconciled and scripts run once, in document order. While the document streams, a pale brand band sweeps across the whole frame diagonally (top-left to bottom-right) on a slow 3.6s cadence — transform-animated and disabled under reduced motion — so the live phase reads at a glance and stops the moment the document settles.

The model-facing authoring guide lives in `src/guide/`: gate rules (when a visual belongs in the conversation), the universal streaming contract (style-first ordering, the CDN allowlist, animation limits, theme tokens, height-reporting pitfalls), and a per-artifact-type roster under `src/guide/modules/` — one file per type, so each kind of visual is tuned without touching the others. The CDN hosts named there are the same four the shell CSP enforces; change both lists together.

The roster stays one line per type to keep the system prompt small; the deeper per-type recipe lives in each module's `detail`. The `visualizer_guide` tool returns it on demand: the model calls `visualizer_guide(modules: [...])` once it has chosen an artifact type, and gets that type's recipe as the tool result — a just-in-time spec injection that grows the guide without growing the standing prompt. The roster closes with an ambient nudge ("before your first render of a type in a conversation, pull its recipe") so the ordering is visible even when the model never opens the guide tool's description; the line renders only when `guideTool` is enabled.

Every `detail` follows one skeleton: **Mental model** (the thinking order before code — encoding table, renderer choice, layout strategy), domain sections (measurements, composition, controls, color), **Failure modes** (symptom first, then cause and fix), and a closing **Quick reference** checklist. Rules are never-conditions with exact measurements, not approximations, because the recipe is read at the moment of authoring. The guide spec pins the skeleton; each module's content stays in its own file.

## The widget bridge

A rendered document's scripts may call `sendPrompt(text)` — the shell bridge posts it to the host, which submits it as a `[widget]`-prefixed user turn so a dashboard can ask the agent a follow-up about what it shows. The host validates the payload (string, non-blank, ≤ 4000 chars) and rate-limits to one accepted prompt per 3 seconds per widget, so a misbehaving script cannot loop the agent. Scripts only run after a document completes, so the bridge can never fire mid-stream.

Scripts may also call `openLink(url)`: the host performs the scheme check itself — http(s) only, opened with `noopener,noreferrer` — so widget code cannot reach `javascript:`, `data:`, or `file:` targets.

Widgets keep state across renders through `await window.storage.get/set/delete(key)`. Requests travel over postMessage with a per-call id and a 10s timeout; the host answers from a store namespaced by the document's `title` argument, so a regenerated document under the same title — streaming card or settled row — finds the values it wrote. Keys are ≤200 units without whitespace, values ≤64k units, one scope holds ≤256k units together; `get` rejects on a missing key rather than returning null. The store is durable through localStorage when reachable and per-mount memory otherwise (private modes).

Anchor clicks inside the document never navigate: the frame is a null-origin `srcdoc` whose base URL is inherited from the host, so even a `#fragment` link would reload the whole app inside the card. A capture-phase guard in the shell prevents every anchor's default action and converts it instead — fragment links scroll to their target in place (`scrollIntoView`, instant under reduced motion), absolute `http(s)` links go through the same validated `openLink` gate as explicit calls, and anything else is dropped.

The frame's permission policy delegates exactly one capability: `fullscreen *`, so a chart or dashboard document may expand (Escape reverses it). Clipboard, popups, camera, and payment stay undelegated.

## Theme tokens

At boot the shell asks the host for its design tokens; AutoFrame collects every `--dsw-*` custom property from the document root's computed style and posts them in, and the shell applies them to its own root element. A `MutationObserver` on the host's `class`/`style`/`data-theme` attributes re-pushes the set when the theme flips, and the shell drops variables the new theme no longer defines — so `color: var(--dsw-alias-label-primary)` inside a document tracks the app theme with no hardcoded palette.

## Card controls and failure notices

A settled card offers two client-side actions over the same bytes: **Download** (a Blob URL; a bare `<svg>` document saves as `.svg` with the SVG mime type, everything else as `.html`) and **Copy HTML** (`navigator.clipboard.writeText` with a brief confirmation; a denied clipboard shows none). When an external script inside the document fails to load, the card shows a load-failure notice — the alternative is a document that renders but silently does nothing. Runtime failures are labeled the same way: a throwing inline script (which previously also killed every later script in the commit chain), an async `error` event, or an unhandled rejection posts a `runtimeError` report through the same bridge, and the card shows the first message beside the summary. Reports cap at three per card so a resize loop or interval cannot flood it.

## Settle-time document check

When a call settles, `execute()` statically inspects the finished document (`src/inspect.ts`): script bodies are compiled — never executed — so syntax errors surface without side effects; attributes are scanned per tag for duplicates, ids for double definitions, and `url(#…)`/`href="#…"` references for dangling targets; inline event handlers get the same compile check. The verdict rides the tool result, which is the model's own channel: a clean render says `document check passed`, a defective one lists its findings (line-numbered, capped at six) with the instruction to fix and re-render in the same turn. Because tool results are logged, a replayed session reproduces the verdict exactly. The check is deliberately heuristic and conservative — it declines to judge a module script whose import statements cannot be lifted cleanly rather than risk a false verdict, and it cannot gate what already streamed: its guarantee is that authored defects are named and repaired in-turn, not that no intermediate frame was ever painted.

## The interactive canvas

The `canvas_draw` tool paints on a logical 1000×640 canvas through a small op vocabulary — `stroke` (flattened point runs), `rect`, `ellipse`, `line`, `arrow`, and `text` — in seven named palette ids (theme-resolved client-side; custom hex is rejected so streamed output cannot smuggle styling into the page). Every call validates at the boundary (`src/canvas/validate.ts`: ≤ 64 ops per call, ≤ 512 in the scene, even-length point runs, finite coordinates clamped to the canvas, text length and size caps) and appends a **whole-scene snapshot** to the session log as a custom `canvas/draw` event — the same durability pattern as the todo state. Replaying a session reproduces the scene exactly.

The canvas renders as a compact collapsible side panel that floats above the layout: pinned to the right edge just above the composer (the todo strip's seat), it overlays the transcript's bottom-right corner instead of pushing content around — narrow enough that the whole 1000×640 surface stays visible without crowding anything. Its agent layer repaints with the doodle-prototype reveal: each stroke animates in along its measured path length (~900 px/s) using a dash-offset trick ported from paper.js, with quadratic-midpoint smoothing. Because the schema places `ops` last, the logged tool-call arguments grow as a JSON prefix while the model streams; a string-aware scanner (`src/canvas/stream-args.ts`) recovers every complete op plus the trailing cut one from that prefix, so strokes appear live — before the tool even dispatches.

The loop closes toward you: the popup carries its own transparent overlay where you draw freehand with pointer capture, plus an optional note. **Send** submits both as a `[canvas]`-prefixed user turn through the composer's own draft channel, so the model sees your ink as compact JSON ops and can answer it — draw a box around a chart and ask "what about this part?". The scene itself folds fresh from every session snapshot re-render: settled `canvas_draw` rows in the chat flow, dispatched-but-unsettled calls, and the still-streaming partial blocks, newest whole-scene snapshot wins.

## Development

```sh
pnpm install
pnpm test     # vitest unit tests for both halves
pnpm build    # tsc emits lib/types declarations, tsdown bundles lib/ runtime + lib/client.js
```

Both halves follow the DeepSeek Harness plugin contract (`ctx.effect()` registrations, invariant companion under `/invariant`). The client bundle keeps the loader's lazy-CJS factory artifact format and the cross-plugin purity rule: platform modules stay external, everything else inlines.
