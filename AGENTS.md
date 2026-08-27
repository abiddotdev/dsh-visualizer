---
description: Instructions for working on dsh-visualizer, a DeepSeek Harness plugin
globs: *
alwaysApply: true
---

# dsh-visualizer — Agent Guide

A DeepSeek Harness plugin: the `visualizer` tool streams a self-contained HTML document
into chat while the model writes it, previewed live in a sandboxed frame. One package,
two planes. For any harness-level knowledge (profiles, loader, plugin contract), refer to
the [DeepSeek Harness README](https://github.com/deepseek-ai/deepseek-harness/blob/master/README.md).

- **Host / node half** (`src/index.ts`, `src/export-fanout.ts`, `src/guide/`, `src/inspect.ts`) → bundled to `lib/index.js`
- **Browser half** (`src/client/*.ts(x)` — StreamCard, ResultRow, share, download, bridge) → bundled to `lib/client.js`
- **Shared pure modules** (`src/shared/export-name.ts`, `src/shared/export-csp.ts`) — imported by *both* planes; each bundle inlines its own copy

## Commands

```sh
pnpm install        # first time (pnpm; no npm/yarn lockfiles in repo)
pnpm test           # vitest, 16 spec files — run before every commit
pnpm vitest run tests/<file>   # single file while iterating
npx tsc -b . --force           # typecheck alone when useful
pnpm build          # tsc declarations + tsdown bundles both halves
```

Tests tagged `.client.` run in jsdom (browser half); the rest run in node.

## Architecture rules (do not break these)

1. **Two-plane purity.** The node half must never import from `src/client/`, and vice
   versa. Anything both planes need goes in `src/shared/` and must stay **pure**:
   sync, dependency-free, browser-safe (no `node:*`). `export-name.ts` is the
   canonical example — host and card derive identical artifact names from it.
2. **Streaming is never hashed or written per-delta.** The fanout mirrors stream deltas
   into a slug-keyed `<base>.partial` sidecar (throttled); only the authoritative
   `tool/call` event triggers a digest (`exportShareName`) and an atomic rename to the
   final name. Keep it that way — hashing on every delta was measured at ~90ms/doc.
3. **Name derivation is co-computed, not transported.** Both planes independently call
   `exportShareName(title, html)` over inputs they already hold. Do not introduce a
   host→client "artifact id" channel without removing that invariant deliberately.
4. **Serving is fail-closed and indistinguishable.** Every failure class on the serve
   route — missing token, wrong token, unknown name, bad name, symlink — answers with
   the SAME not-found page and header set. Never add branching that lets a caller tell
   them apart.
5. **CSP is one list.** `shared/export-csp.ts` feeds both the inline shell's `<meta>`
   CSP and the serve route's header (SVG variant only swaps `script-src 'none'`).
   Widening the CDN allowlist is a security decision; change nothing casually.

## Naming & vocabulary

The config/UI surface says **artifact** and **share** everywhere:

| Config | Meaning |
|---|---|
| `maxArtifactBytes` | render size cap |
| `guideTool` / `guideTypes` | authoring-guide roster + JIT recipe tool |
| `shareArtifacts` | master switch for mirror + serve route + Share control |
| `artifactDir` | disk home (`~/.dsh/visualizer/artifacts`) |
| `artifactRetentionDays` | boot-time sweep |
| `shareKey` | '' = random per boot; pinned value = links survive restarts |

Filenames are kebab-case ASCII slugs + content digest: `<slug>-<16hex>.html|.svg`.
URLs are `/artifacts/visualizer/<name>?k=<key>`; downloads keep just the slug.
When renaming config or routes: update schema defaults, patch-file comments
(`cordis.patch.yml`), README, and both test suites together — they drift easily.

## System-prompt coupling

`apply()` appends a "renders are saved automatically" sentence to the prompt section
**only when `config.shareArtifacts` is true**. If you touch the section composition,
keep it conditional; covered by tests in `tests/visualizer.spec.ts`.

## Testing conventions

- Node specs build a fake harness via `setup()` helpers: real `Context` + cordis plugins
  (`SystemPrompt`, `ToolRuntime`), plus a `FakeWebServer` service in fanout specs that
  records registered routes so handlers are invoked directly (no socket).
- Client specs stub browser globals (`vi.stubGlobal('__DSH_VISUALIZER_EXPORTS__', …)`
  carries the capability key) and spy on `window.open`/Blob/clipboard.
- Shared derivation tests live in `export-name.spec.ts`: determinism, avalanche,
  near-collision sweep, and a click-path timing guard (<500ms for 5×256KB docs).
- When a feature gates behavior at mount (sweep, serve route), seed state BEFORE
  mounting — several effects run once during activation.

## PR flow

1. Branch off main as `feature/<topic>` (or `fix/<topic>`).
2. Commits follow conventional style: `feat(scope): …`, `fix: …`, `perf: …`,
   `docs: …`, `test(scope): …`. Subject ≤ ~72 chars, body explains why not what.
3. Land changes in logical commits; run `pnpm test` before each commit, not just at the end.
4. Small doc/comment fixes may be folded into their feature commit via `git commit --amend`;
   once pushed, prefer separate follow-up commits. Push with
   `git push --force-with-lease=<branch>:<known-hash>` ONLY when you amended already-pushed
   work you own; otherwise plain push.
5. Open a PR against `main` with a short summary table of behavior changes + trade-offs
   explicitly accepted (e.g., links expiring on restart). CI expectation: full suite green.
6. Breaking config renames get one line in the release notes ("exports → shareArtifacts…").
7. When commenting on PRs (review remarks, replies, CI explanations), prefix every
   comment with `[bot]` so automated-agent remarks stay distinguishable from human ones.

## Gotchas

- `fs.utimes` needs BOTH atime and mtime args explicitly on current Node.
- All specs share one module registry per file — keep `afterEach(vi.useRealTimers)`.
- `lib/` is build output; never edit or commit it.
- The repo has stray untracked demo HTML files (`bar-chart.html`, `dashboard.html`)
  — leave them out of commits unless asked.
