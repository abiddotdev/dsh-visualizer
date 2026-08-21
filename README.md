# dsh-visualizer

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) plugin: the **`visualizer`** tool streams a self-contained HTML document into the chat as the model writes it, live-previewed by a sandboxed inline frame — Chart.js, external CDN libraries, and all. Nothing touches the workspace; download is a client-side Blob.

One installable package ships both halves: the model-facing tool (`lib/index.js`) and the browser card (`lib/client.js`, declared through the package's `dsh.client` manifest). Installing it activates a bundle layer that mounts both — no manual profile patch editing.

The host tool declares `html` as its last schema parameter, so the logged tool-call arguments carry a growing document prefix; the client decodes that prefix and paints a live preview inside a null-origin sandboxed iframe with a transparent canvas. At dispatch the final DOM is reconciled and scripts run once in document order.

## Install into a dsh deployment

Requires Node ^22.19 or >=24 and a dsh checkout or installed `dsh` CLI. One command:

```sh
dsh plugin --profile <your-profile> add 'git+https://github.com/abidhmuhsin/dsh-visualizer.git'
```

The equivalent shorthand works too: `'github:abidhmuhsin/dsh-visualizer'`. Both resolve to the same public codeload tarball, so no GitHub credentials are involved.

First run fails with an "Add the package to allowBuilds" hint: pnpm 11's supply-chain gate blocks the package's `prepare` build until allowlisted, and the hint carries the exact key (keyed on the codeload URL and the resolved commit). Paste that block under `allowBuilds:` in `~/.dsh/profiles/<your-profile>/pnpm-workspace.yaml` (create the file if dsh has not made one) and re-run the command — it converges on the first paste. Keys pin the commit, so after a new upstream push, reinstalling prints a fresh hint to paste.

No dependency overrides are needed against harness 0.1.1-rc.2 or newer. Deployments pinned to the first 0.0.1-rc.1 tarballs needed five `overrides:` redirects in that same file (those manifests referenced package names that were never pushed to npm); upgrade the deployment instead of carrying them forward.

### Alongside the built-in visualizer

Harness releases up to 0.1.1-rc.1 shipped their own in-box visualizer card row (`ui-visualizer`). Both cards register the locale namespace `visualizer`, so mounting both fails loud with `locale namespace "visualizer" already has locale …`. On such a checkout, disable the built-in row in the profile patch layer at `~/.dsh/profiles/<your-profile>/cordis.patch.yml`:

```yaml
- id: ui-visualizer
  disabled: true
```

From 0.1.1-rc.2 the built-in row no longer ships, nothing collides, and no patch entry is needed. If you see `patch: entry "ui-visualizer" not found`, your profile carries a stale disable line — remove it.

Then `pnpm dsh --profile <your-profile>` (or your usual launcher), ask the model to "visualize …", and the streamed document appears inline while it is being written. Pin a release by adding a ref fragment: `'git+https://github.com/abidhmuhsin/dsh-visualizer.git#v0.2.0'`. To remove:

```sh
dsh plugin --profile <your-profile> remove dsh-visualizer
```

## How mounting works

The package declares a `dsh.bundle` manifest (`dsh.bundle.patch` → `./cordis.patch.yml`), so `dsh plugin add` installs it as a profile patch layer automatically. That layer inserts one loader row for the package itself:

- The host Loader imports `lib/index.js`; its `apply()` registers the model-facing `visualizer` tool.
- The Web GUI's client module system scans Loader entries for packages declaring a `dsh.client` manifest and serves the built `lib/client.js` closure-factory bundle, which renders the streaming card and the settled row.

One entry, both planes — the same first-class single-package pattern the harness uses for its own combined tool+UI extensions.

## Development

```sh
pnpm install
pnpm test     # vitest unit tests for both halves
pnpm build    # tsc emits lib/types declarations, tsdown bundles lib/ runtime + lib/client.js
```

Both halves follow the DeepSeek Harness plugin contract (`ctx.effect()` registrations, invariant companion under `/invariant`, typed session events). The client bundle keeps the loader's lazy-CJS factory artifact format and the cross-plugin purity rule: platform modules stay external, everything else inlines.
