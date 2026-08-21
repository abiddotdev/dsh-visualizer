# dsh-visualizer

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) plugin repo: the **`visualizer`** tool streams a self-contained HTML document into the chat as the model writes it, live-previewed by a sandboxed inline frame — Chart.js, external CDN libraries, and all. Nothing touches the workspace; download is a client-side Blob.

## Layout

```
packages/
  tool-visualizer/          host half: the model-facing `visualizer` tool (@deepseek-ai/dsh-tool-visualizer)
  client-ui-visualizer/     browser half: streaming card + settled row (@deepseek-ai/dsh-client-ui-visualizer)
  bundle/                   installable profile bundle wiring both rows (dsh-visualizer-bundle)
```

The host tool declares `html` as its last schema parameter, so the logged tool-call arguments carry a growing document prefix; the client decodes that prefix and paints a live preview inside a null-origin sandboxed iframe with a transparent canvas. At dispatch the final DOM is reconciled and scripts run once in document order.

## Install into a dsh deployment

Requires Node ^22.19 or >=24 and a dsh checkout or installed `dsh` CLI.

```sh
git clone <this-repo> dsh-visualizer
cd dsh-visualizer
pnpm install
pnpm build                 # compiles both packages' lib/ artifacts

# from any directory, mount the bundle into a profile:
dsh plugin --profile <your-profile> add /path/to/dsh-visualizer/packages/bundle
dsh --profile <your-profile> web
```

Ask the model to "visualize …" and the streamed document appears inline in the chat while it is being written. To remove:

```sh
dsh plugin --profile <your-profile> remove dsh-visualizer-bundle
```

## How mounting works

`packages/bundle` ships a `dsh.bundle` manifest whose `cordis.patch.yml` inserts two rows by package name:

- `tool-visualizer` — registers the model-facing tool.
- `ui-visualizer` — declares a `dsh.client` manifest; the Web GUI's client module system scans Loader entries for these and serves the built `lib/client.js` closure-factory bundle, which renders the streaming card and the settled row.

The bundle depends on both packages via `file:` links, so installing it packs the sibling checkouts — keep the cloned repo on disk after building.

## Development

```sh
pnpm install
pnpm test     # vitest unit tests for both packages
pnpm build    # tsc emits lib/types declarations, tsdown bundles lib/ runtime + lib/client.js
```

Both halves follow the DeepSeek Harness plugin contract (`ctx.effect()` registrations, invariant companions under `/invariant`, typed session events). The client bundle keeps the loader's lazy-CJS factory artifact format and the cross-plugin purity rule: platform modules stay external, everything else inlines.
