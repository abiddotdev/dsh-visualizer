# dsh-visualizer

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) plugin. The **`visualizer`** tool streams a self-contained HTML document into the chat as the model writes it, with a live preview in a sandboxed inline frame — Chart.js, external CDN libraries, all of it. Nothing touches the workspace.

One package ships both halves: the model-facing tool (`lib/index.js`) and the Web GUI card (`lib/client.js`, declared through the package's `dsh.client` manifest). Install it and a bundle layer mounts both. No manual profile patch editing.

![A computer-architecture diagram streaming into the chat and rendering live in the card](assets/demos/how-computers-work.gif)

![Documents streaming into the chat and rendering live in the card](assets/demos/combined-demo.gif)

Every generation is downloadable from the card as a self-contained `.html` (or `.svg`) file. No server round-trip.

Full-length demos, one per artifact type:

1. [Pull request flow overview](assets/demos/bitbucket_datacenter_full.webm) — diagram
2. [Photosynthesis explainer](assets/demos/photosynthesis_explainer_trimmed.webm) — interactive
3. [How computers work](assets/demos/how-computers-work.gif) — mockup (shown above)
4. [The plugin itself, explained and rendered by the plugin](assets/demos/plugin_explainer_full.webm) — self-hosted
5. [Streaming generative UI highlights](assets/demos/streaming-generative-ui-highlights.webm) — highlights
6. [Combined demo](assets/demos/combined-demo.webm) — multiple use cases in one run

## Install

Requires Node ^22.19 or >=24 and a DeepSeek Harness installation on `0.1.2-alpha.3` or newer (older builds: see [Harness version](#harness-version) below):

```sh
# install into the default web profile
dsh plugin --profile web add 'git+https://github.com/abidhmuhsin/dsh-visualizer.git'

# or install into any custom profile
dsh plugin --profile <your-profile> add 'git+https://github.com/abidhmuhsin/dsh-visualizer.git'
```

The first run fails with an "Add the package to allowBuilds" hint. That's pnpm's supply-chain gate blocking the `prepare` build until it's allowlisted; the hint carries the exact key, keyed on the codeload URL and the resolved commit. Paste that block under `allowBuilds:` in `~/.dsh/profiles/<your-profile>/pnpm-workspace.yaml` and re-run. Keys pin the commit, so after a new upstream push, reinstalling prints a fresh hint to paste.

### Harness version

The default branch tracks the **latest DeepSeek Harness alpha** (`0.1.2-alpha.3` or newer). That release renamed the client `conversationEvents` service to `uiConversation` and moved the Chat Node out of `dsh-client-ui-conversation` into the new `dsh-client-ui-chat` package, so the card cannot mount on builds older than that — the tool parks at `pending (waiting for service: conversationEvents)`.

On an older harness (`0.1.1-rc.2` and earlier pre-alpha builds), install the pre-alpha compatibility branch instead, with a ref fragment:

```sh
dsh plugin --profile <your-profile> add 'git+https://github.com/abidhmuhsin/dsh-visualizer.git#pre-harness-0.1.2-alpha3-compat'
```

That branch is the last state of the plugin built against the pre-`0.1.2-alpha.3` client API. It is frozen — new features land on the default branch only — so upgrading the harness is the way forward.

### Or Install from a local checkout

To hack on the plugin (or install a version not yet pushed), check it out, build, and add it by local path:

```sh
git clone https://github.com/abidhmuhsin/dsh-visualizer.git ~/tools/dsh-visualizer
cd ~/tools/dsh-visualizer
pnpm install
pnpm build

cd ~/tools/deepseek-harness
pnpm dsh plugin --profile visualizer add '/home/user/tools/dsh-visualizer'
```

A local path skips the git fetch and the `allowBuilds` dance, since `pnpm build` already produced `lib/`. The loader still imports from the installed copy under the profile, though. To pick up changes: re-run `pnpm build` in the checkout, then `remove` and `add` again.

Boot the profile and ask the model to **"visualize …"**; the streamed document appears inline while it's written. Pin a release with a ref fragment (`'git+https://github.com/abidhmuhsin/dsh-visualizer.git#v0.2.0'`). To remove:

```sh
dsh plugin --profile <your-profile> remove dsh-visualizer
```

## How it mounts

The package declares a `dsh.bundle` manifest (`dsh.bundle.patch` → `./cordis.patch.yml`), so `dsh plugin add` installs it as a profile patch layer on its own. That layer inserts one loader row for the package:

- The host Loader imports `lib/index.js`; its `apply()` registers the model-facing `visualizer` tool.
- The Web GUI's client module system scans Loader entries for packages declaring a `dsh.client` manifest and serves `lib/client.js`, which renders the streaming card and the settled row.

## Configuration

The bundle layer already inserts the loader row, so overriding config takes a flat id-targeted patch entry in the profile's own patch layer (`~/.dsh/profiles/<your-profile>/cordis.patch.yml`). Don't wrap it in `insert:` — that appends a second row instead of overriding the installed one. Values validate against the schema at load, and a mistake fails the mount loudly. Every option has a schema default, so an override block only lists the fields being changed. The complete option list, at current defaults:

```yaml
- id: dsh-visualizer
  config:
    maxHtmlBytes: 262144    # default; per-call render limit, in UTF-8 bytes
    guideTool: true         # default; set false to use only the render tool
    guideModules: [chart, diagram, mockup, interactive, art]   # default; subset to teach and serve;
```

`guideModules` narrows both guide surfaces at once. The standing system-prompt roster lists only those types' one-liners, and the JIT tool's argument enum accepts only those ids, so a disabled type is rejected at the argument boundary before any code runs. `guideTool: false` skips the second tool registration; the render tool and the standing prompt section are unaffected. Unknown module ids or an empty `guideModules` fail the plugin load. Defaults are on, all five types (`chart`, `diagram`, `mockup`, `interactive`, `art`).

## How it works

The tool declares `html` as its last schema parameter, so the logged tool-call arguments carry a growing document prefix while the model streams. The card decodes that prefix and paints a live preview inside a null-origin sandboxed iframe with a transparent canvas; at dispatch the final DOM is reconciled and scripts run once, in document order. While the document streams, a pale brand band sweeps diagonally across the whole frame (top-left to bottom-right) on a slow 3.6s cadence. It's transform-animated, disabled under reduced motion. It makes the live phase readable at a glance, and it stops the moment the document settles.

The model-facing authoring guide lives in `src/guide/`: gate rules (when a visual belongs in the conversation), the universal streaming contract (style-first ordering, the CDN allowlist, animation limits, theme tokens, height-reporting pitfalls), and a per-artifact-type roster under `src/guide/modules/`, one file per type so each kind of visual is tuned without touching the others. The CDN hosts named there are the same four the shell CSP enforces; change both lists together.

The roster stays one line per type to keep the system prompt small; the deeper per-type recipe lives in each module's `detail`. The `visualizer_guide` tool returns it on demand. Once the model has chosen an artifact type it calls `visualizer_guide(modules: [...])` and gets that type's recipe as the tool result — a just-in-time spec injection that grows the guide without growing the standing prompt. The roster closes with an ambient nudge ("before your first render of a type in a conversation, pull its recipe"), so the ordering holds even if the model never opens the guide tool's description. That line renders only when `guideTool` is enabled.

Every `detail` follows one skeleton: **Mental model** (the thinking order before code — encoding table, renderer choice, layout strategy), domain sections (measurements, composition, controls, color), **Failure modes** (symptom first, then cause and fix), and a closing **Quick reference** checklist. Rules are never-conditions with exact measurements, not approximations, because the recipe is read at the moment of authoring. The guide spec pins the skeleton; module content stays in its own file.

## The widget bridge

A rendered document's scripts may call `sendPrompt(text)`. The shell bridge posts it to the host, which submits it as a `[widget]`-prefixed user turn — a dashboard can ask the agent a follow-up about what it shows. The host validates the payload (string, non-blank, ≤ 4000 chars) and rate-limits to one accepted prompt per 3 seconds per widget, so a misbehaving script can't loop the agent. Scripts only run after a document completes, so the bridge can never fire mid-stream.

Scripts may also call `openLink(url)`. The host does the scheme check itself (http(s) only, opened with `noopener,noreferrer`), so widget code can't reach `javascript:`, `data:`, or `file:` targets.

Widgets keep state across renders through `await window.storage.get/set/delete(key)`. Requests travel over postMessage with a per-call id and a 10s timeout; the host answers from a store namespaced by the document's `title` argument, so a regenerated document under the same title (streaming card or settled row) finds the values it wrote. Keys are ≤200 units without whitespace, values ≤64k units, and one scope holds ≤256k units together. `get` rejects on a missing key rather than returning null. Storage is durable through localStorage when reachable, per-mount memory otherwise (private modes).

Anchor clicks inside the document never navigate. The frame is a null-origin `srcdoc` that inherits its base URL from the host, so even a `#fragment` link would reload the whole app inside the card. A capture-phase guard in the shell blocks every anchor's default action and converts it instead: fragment links scroll to their target in place (`scrollIntoView`, instant under reduced motion), absolute `http(s)` links go through the same validated `openLink` gate as explicit calls, anything else is dropped.

The frame's permission policy delegates exactly one capability: `fullscreen *`. A chart or dashboard document may expand, and Escape reverses it. Clipboard, popups, camera, and payment stay undelegated.

## Theme tokens

At boot the shell asks the host for its design tokens. AutoFrame collects every `--dsw-*` custom property from the document root's computed style and posts them in; the shell applies them to its own root element. A `MutationObserver` on the host's `class`/`style`/`data-theme` attributes re-pushes the set when the theme flips, and the shell drops variables the new theme no longer defines. So `color: var(--dsw-alias-label-primary)` inside a document tracks the app theme — no hardcoded palette.

## Card controls and failure notices

A settled card offers two client-side actions over the same bytes. **Download** uses a Blob URL; a bare `<svg>` document saves as `.svg` with the SVG mime type, everything else as `.html`. **Copy HTML** uses `navigator.clipboard.writeText` with a brief confirmation (a denied clipboard shows none).

When an external script inside the document fails to load, the card shows a load-failure notice — the alternative is a document that renders but does nothing. Runtime failures are labeled the same way. A throwing inline script (which previously also killed every later script in the commit chain), an async `error` event, or an unhandled rejection posts a `runtimeError` report through the same bridge, and the card shows the first message beside the summary. Reports cap at three per card, so a resize loop or interval can't flood it.

## Settle-time document check

When a call settles, `execute()` statically inspects the finished document (`src/inspect.ts`). Script bodies are compiled, never executed, so syntax errors show up without side effects. Attributes are scanned per tag for duplicates, ids for double definitions, and `url(#…)`/`href="#…"` references for dangling targets; inline event handlers get the same compile check.

The verdict rides the tool result, which is the model's own channel. A clean render says `document check passed`; a defective one lists its findings (line-numbered, capped at six) with the instruction to fix and re-render in the same turn. Tool results are logged, so a replayed session reproduces the verdict exactly.

The check is heuristic and conservative on purpose. It declines to judge a module script whose import statements can't be lifted cleanly, rather than risk a false verdict, and it can't gate what already streamed: the guarantee is that authored defects are named and repaired in-turn, not that no intermediate frame was ever painted.

## Development

```sh
pnpm install
pnpm test     # vitest unit tests for both halves
pnpm build    # tsc emits lib/types declarations, tsdown bundles lib/ runtime + lib/client.js
```

Both halves follow the DeepSeek Harness plugin contract (`ctx.effect()` registrations, invariant companion under `/invariant`). The client bundle keeps the loader's lazy-CJS factory artifact format and the cross-plugin purity rule: platform modules stay external, everything else inlines.
