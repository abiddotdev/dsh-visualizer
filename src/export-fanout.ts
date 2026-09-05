/**
 * Streaming export fanout, node half: while the model writes a `visualizer`
 * call, the same `assistant/chunk` `tool-call-delta` events the browser card
 * folds also reach the host's `session/event` firehose — this module folds
 * them the same way and mirrors the growing document into an exports
 * directory on disk. The sidecar (`<base>.partial`) grows while the document
 * streams; the `tool/call` event that precedes execution carries the
 * authoritative bytes, which land under their final name by an atomic rename.
 * The serve route on the harness web server then hands the finalized file out
 * at `<route>/<name>` — the URL the card's share control opens. Both names
 * come from the shared derivation module, so host and card cannot disagree.
 *
 * The fanout is a read-only projection of the logged stream: it never touches
 * the conversation, and a failure inside it is contained to a log line. It
 * activates only where a web server exists (the web profile), so an export
 * exists exactly when it is shareable; surfaces without one keep the tool's
 * untouched, filesystem-free behavior.
 *
 * @module dsh-visualizer/export-fanout
 */

import { timingSafeEqual } from 'node:crypto'
import { randomBytes } from 'node:crypto'
import { lstat, mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import { extractStreamArgs } from './client/partial-args.ts'
import { RENDER_CSP_DIRECTIVES } from './shared/export-csp.ts'
import {
  type ArtifactListEntry, EXPORTS_BOOT_GLOBAL, EXPORTS_ROUTE_PATH, displayTitleOf, exportFileBase, exportShareName,
  isServableExportName, partialFileName,
} from './shared/export-name.ts'

/** Wire name of the render tool; only its calls fan out. */
const TOOL_NAME = 'visualizer'

/** Minimum spacing between two sidecar writes for one call; token deltas far outpace any disk. */
export const PARTIAL_WRITE_INTERVAL_MS = 120

/**
 * The face of `ctx.webServer` this module uses. Declared structurally because
 * the service's typed declaration lives in `@deepseek-ai/dsh-host-webserver`,
 * a harness-internal package this one deliberately does not depend on; the
 * shape is the route-registry contract every web profile provides.
 */
interface WebServerLike {
  /** Register one named route; returns the disposer removing it. */
  register(route: {
    kind: 'exact' | 'prefix'
    path: string
    handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
  }): () => void
}

/**
 * Structural view of one stream chunk the fanout folds; `dsh-llm` owns the
 * closed wire union, mirrored here member by member so the switch narrows.
 * Only the tool-call members carry meaning here.
 */
type WireChunk =
  | { type: 'tool-call-delta'; index: number; id: unknown; name?: string; argumentsDelta: string }
  | { type: 'block-end'; index: number; block: { type: string; id?: unknown; name?: string; arguments?: string } }
  | { type: 'block-start' | 'text-delta' | 'reasoning-delta' | 'usage' | 'finish' }

/** Structural view of the `session/event` payloads the fanout consumes. */
type WireEvent =
  | { type: 'assistant/chunk'; data: { turn: number; step: number; chunk: WireChunk } }
  | {
    type: 'assistant/message'
    data: { turn: number; step: number; message: { content: readonly unknown[] }; interrupted?: true }
  }
  | { type: 'llm/retry'; data: { turn: number; step: number } }
  | { type: 'tool/call'; data: { turn: number; step: number; callId: unknown; name: string; arguments: string } }
  | {
    type: 'tool/result'
    data: { message: { content: readonly { toolCallId?: unknown }[] }; error?: { name: string; code: string } }
  }

/** The `tool/call` member of {@link WireEvent}, extracted for the finalize path. */
type ToolCallEvent = Extract<WireEvent, { type: 'tool/call' }>

/**
 * Loose-typed `ctx.on`: the `session/event` firehose's typed declaration
 * lives in `@deepseek-ai/dsh-session`, which this package does not depend on.
 * The mixed accessor still registers the listener on this plugin's fiber —
 * the one property an untyped call must keep.
 */
type LooseOn = (name: string, listener: (...args: unknown[]) => void) => () => boolean

/** One streamed tool-call block's accumulating state; the host mirror of the client's fold. */
interface WireBlock {
  /** Call identity; the empty string until a delta names it. */
  callId: string
  /** Tool name; empty until a delta or the final block names the call. */
  name: string
  argsRaw: string
  complete: boolean
}

/** Every block one assistant step streamed, keyed by streamed block index. */
interface StepState {
  readonly blocks: Map<number, WireBlock>
}

/** Files the fanout owns for one call: what error cleanup may remove. */
interface ExportRecord {
  /** The growing streaming sidecar's path, or null once finalized. */
  sidecar: string | null
  /** The finalized export's path, or null until the call lands. */
  final: string | null
}

/** All fanout state for one session. */
interface SessionState {
  /** Folded stream blocks, keyed `<turn>:<step>`. */
  readonly steps: Map<string, StepState>
  /** Files owned per call id. */
  readonly exports: Map<string, ExportRecord>
}

/** Configuration the fanout runs under. */
export interface ExportFanoutConfig {
  /** Absolute exports directory; created on activation. */
  readonly dir: string
  /** Per-call render size limit in bytes; the fanout mirrors it, never exceeds it. */
  readonly maxArtifactBytes: number
  /** Days a finalized artifact survives; `0` disables the expiry sweep. */
  readonly artifactRetentionDays: number
  /** Fixed share key; empty issues a fresh random one per boot. */
  readonly shareKey: string
}

/** All fanout state for one registration. */
interface FanoutState {
  readonly config: ExportFanoutConfig
  readonly ctx: Context
  /** mkdir completion; every file write awaits it, so the directory exists first. */
  readonly ready: Promise<void>
  /** Session-keyed wire folds; the sessions themselves key their lifetime. */
  readonly sessions: WeakMap<object, SessionState>
  /** Tail of each call's serialized file-operation chain. */
  readonly chains: Map<string, Promise<void>>
  /** Last sidecar write per call, for throttling. */
  readonly lastPartialAt: Map<string, number>
  /** Which call last finalized each export path, so one call's cleanup never removes a later call's overwrite. */
  readonly finalOwners: Map<string, string>
  /** Per-boot capability token every serve request must echo as `?k=`. */
  readonly token: string
}

/**
 * Normalize a streamed or logged call identity to the string key the fold and
 * the `tool/call`/`tool/result` events share.
 */
function callKey(id: unknown): string {
  return String(id ?? '')
}

/** The session's state record, created on first sight. */
function sessionState(state: FanoutState, session: object): SessionState {
  let record = state.sessions.get(session)
  if (record === undefined) {
    record = { steps: new Map(), exports: new Map() }
    state.sessions.set(session, record)
  }
  return record
}

/** The step's block table, created on first sight. */
function stepState(session: SessionState, turn: number, step: number): StepState {
  const key = `${turn}:${step}`
  let record = session.steps.get(key)
  if (record === undefined) {
    record = { blocks: new Map() }
    session.steps.set(key, record)
  }
  return record
}

/** The call's file record, created on first sight. */
function exportRecord(session: SessionState, id: string): ExportRecord {
  let record = session.exports.get(id)
  if (record === undefined) {
    record = { sidecar: null, final: null }
    session.exports.set(id, record)
  }
  return record
}

/**
 * Serialize one file operation onto its call's chain; a rejection is logged
 * and contained — a failing export never reaches the conversation. The map
 * holds one tail per call id and is pruned as calls settle: `cleanupCall`
 * (error) and `settleCall` (success) both drop the tail once it drains.
 */
function enqueue(state: FanoutState, id: string, op: () => Promise<void>): void {
  const chained = (state.chains.get(id) ?? Promise.resolve())
    .then(op)
    .catch((error: unknown) => {
      state.ctx.logger.warn(`export fanout: ${error instanceof Error ? error.message : String(error)}`)
    })
  state.chains.set(id, chained)
}

/**
 * Like {@link enqueue}, but the tail removes itself once it settles — for the
 * last operation a call will ever enqueue (finalize and result-time prune).
 * The identity guard keeps a later `enqueue` onto the same id safe: if one
 * arrives before this tail drains, the map still holds that newer tail and
 * the deletion is a no-op.
 */
function enqueueFinal(state: FanoutState, id: string, op: () => Promise<void>): void {
  const tail: Promise<void> = (state.chains.get(id) ?? Promise.resolve())
    .then(op)
    .then(() => {
      if (state.chains.get(id) === tail) state.chains.delete(id)
    }, (error: unknown) => {
      state.ctx.logger.warn(`export fanout: ${error instanceof Error ? error.message : String(error)}`)
      if (state.chains.get(id) === tail) state.chains.delete(id)
    })
  state.chains.set(id, tail)
}

/**
 * Unlink one path if it exists; absence is the common case and never an error.
 */
async function unlinkQuiet(path: string): Promise<void> {
  await unlink(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== 'ENOENT') throw error
  })
}

/**
 * Fold one streamed delta into its block; the host mirror of the client's
 * foldDelta. A foreign tool's block drops out so its arguments never
 * accumulate here.
 */
function foldDelta(
  state: FanoutState, session: SessionState, turn: number, step: number,
  index: number, id: unknown, name: string | undefined, delta: string,
): void {
  const blocks = stepState(session, turn, step).blocks
  const previous = blocks.get(index)
  if (previous?.complete === true) return
  const known = name ?? previous?.name ?? ''
  if (known !== '' && known !== TOOL_NAME) {
    blocks.delete(index)
    return
  }
  const block: WireBlock = {
    callId: callKey(id) || previous?.callId || '',
    name: known,
    argsRaw: (previous?.argsRaw ?? '') + delta,
    complete: false,
  }
  blocks.set(index, block)
  if (known === TOOL_NAME) streamPrefix(state, session, block)
}

/**
 * Adopt a finalized tool-call block from `block-end` or `assistant/message`;
 * like the client fold, the complete arguments replace the accumulation. No
 * write happens here: the authoritative bytes ride the `tool/call` event.
 */
function foldFinalBlock(
  session: SessionState, turn: number, step: number, index: number,
  block: { id: unknown; name: string; arguments: string },
): void {
  const blocks = stepState(session, turn, step).blocks
  if (block.name !== TOOL_NAME) {
    blocks.delete(index)
    return
  }
  blocks.set(index, { callId: callKey(block.id), name: block.name, argsRaw: block.arguments, complete: true })
}

/**
 * Mirror the latest decoded prefix into the call's sidecar, throttled: token
 * deltas arrive far faster than any reader needs the file to change. A base
 * change (the title decoded after the document began) moves the sidecar and
 * removes the stale one.
 */
function streamPrefix(state: FanoutState, session: SessionState, block: WireBlock): void {
  if (block.callId.length === 0) return
  const view = extractStreamArgs(block.argsRaw)
  if (view === null || view.html.length === 0) return
  if (Buffer.byteLength(view.html, 'utf8') > state.config.maxArtifactBytes) return
  const now = Date.now()
  if (now - (state.lastPartialAt.get(block.callId) ?? 0) < PARTIAL_WRITE_INTERVAL_MS) return
  state.lastPartialAt.set(block.callId, now)
  const record = exportRecord(session, block.callId)
  const html = view.html
  const path = join(state.config.dir, partialFileName(exportFileBase(view.title)))
  const stale = record.sidecar !== null && record.sidecar !== path ? record.sidecar : null
  record.sidecar = path
  enqueue(state, block.callId, async () => {
    await state.ready
    await writeFile(path, html, 'utf8')
    if (stale !== null) await unlinkQuiet(stale)
  })
}

/**
 * Retire one call's fanout bookkeeping on its successful result: the export
 * stays on disk (until overwritten or swept by retention), but the session
 * record, the ownership pin, and any streaming leftovers go — the maps hold
 * only in-flight calls once every call has settled either way.
 */
function settleCall(state: FanoutState, session: SessionState, id: string): void {
  const record = session.exports.get(id)
  if (record === undefined) return
  if (record.final !== null && state.finalOwners.get(record.final) === id) {
    state.finalOwners.delete(record.final)
  }
  session.exports.delete(id)
  state.lastPartialAt.delete(id)
  // A call that streamed but never finalized (result arrived without a
  // tool/call) may still own a sidecar; it is residue now.
  const sidecar = record.sidecar
  if (sidecar !== null) {
    enqueueFinal(state, id, async () => {
      await state.ready
      await unlinkQuiet(sidecar)
    })
  }
}

/**
 * Remove every file the fanout owns for one call — the failed-render and
 * interruption cleanup. A finalized path is removed only when this call is
 * still its last writer, so one call's cleanup never deletes a later call's
 * overwrite under the same title.
 */
function cleanupCall(state: FanoutState, session: SessionState, id: string): void {
  const record = session.exports.get(id)
  if (record === undefined) return
  const sidecar = record.sidecar
  const final = record.final !== null && state.finalOwners.get(record.final) === id ? record.final : null
  record.sidecar = null
  record.final = null
  session.exports.delete(id)
  state.lastPartialAt.delete(id)
  enqueue(state, id, async () => {
    await state.ready
    if (sidecar !== null) await unlinkQuiet(sidecar)
    if (final !== null) {
      await unlinkQuiet(final)
      if (state.finalOwners.get(final) === id) state.finalOwners.delete(final)
    }
  })
}

/** Drop one step's accumulators and owned sidecars — the `llm/retry` reset. */
function resetStep(state: FanoutState, session: SessionState, turn: number, step: number): void {
  const key = `${turn}:${step}`
  const record = session.steps.get(key)
  if (record === undefined) return
  for (const block of record.blocks.values()) {
    if (block.name === TOOL_NAME && block.callId.length > 0) cleanupCall(state, session, block.callId)
  }
  session.steps.delete(key)
}

/**
 * Finalize one landed call from the authoritative `tool/call` arguments: the
 * settled bytes replace the sidecar's content and the file takes its final
 * name by rename, so a reader never sees a torn or half-named export. Calls
 * the tool would reject (empty or over-limit documents) never finalize; their
 * result-error cleanup removes whatever streamed.
 */
function finalizeCall(state: FanoutState, session: SessionState, event: ToolCallEvent): void {
  const data = event.data
  if (data.name !== TOOL_NAME) return
  const id = callKey(data.callId)
  if (id.length === 0) return
  let parsed: { title?: unknown; html?: unknown }
  try {
    parsed = JSON.parse(data.arguments) as { title?: unknown; html?: unknown }
  } catch {
    return
  }
  if (typeof parsed.html !== 'string' || parsed.html.trim().length === 0) return
  if (Buffer.byteLength(parsed.html, 'utf8') > state.config.maxArtifactBytes) return
  const html = parsed.html
  const title = typeof parsed.title === 'string' && parsed.title.trim().length > 0 ? parsed.title : null
  const shareName = exportShareName(title, html)
  const sidecar = join(state.config.dir, partialFileName(shareName))
  const final = join(state.config.dir, shareName)
  const record = exportRecord(session, id)
  const stale = record.sidecar !== null && record.sidecar !== sidecar ? record.sidecar : null
  record.sidecar = null
  record.final = final
  // A path has exactly one owner — the latest finalizer — so an overwritten
  // export never stays pinned to a dead call id (and the older call's later
  // error cleanup must not delete the newer call's file).
  state.finalOwners.set(final, id)
  // Finalize retires the call from streaming: no more sidecar writes, so the
  // throttle entry goes now. The exports record stays until the tool result
  // (an error result still needs it to remove what finalized), and the chain
  // tail removes itself once the rename settles.
  state.lastPartialAt.delete(id)
  enqueueFinal(state, id, async () => {
    await state.ready
    await writeFile(sidecar, html, 'utf8')
    await rename(sidecar, final)
    if (stale !== null) await unlinkQuiet(stale)
  })
}

/** Most rows the gallery listing returns; bounds response size on a long-lived, high-volume artifact directory. */
const MAX_LISTING_ENTRIES = 500

/**
 * Every finalized export currently on disk, most recent first, for the
 * artifact gallery's listing request. Read live rather than cached — the
 * directory is small relative to a request's cost, and a cache would show
 * artifacts the retention sweep already removed.
 * @param dir - the configured exports directory.
 * @returns entries newest-first, capped at {@link MAX_LISTING_ENTRIES}.
 */
async function listArtifacts(dir: string): Promise<ArtifactListEntry[]> {
  let names: string[]
  try {
    names = await readdir(dir)
  } catch (error: unknown) {
    // Nothing has ever been shared yet: an empty list, not a failure.
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  const entries: ArtifactListEntry[] = []
  for (const name of names) {
    if (!isServableExportName(name)) continue
    const stats = await lstat(join(dir, name)).catch(() => null)
    if (stats === null || !stats.isFile()) continue
    entries.push({
      name,
      title: displayTitleOf(name),
      kind: name.endsWith('.svg') ? 'svg' : 'html',
      bytes: stats.size,
      mtimeMs: stats.mtimeMs,
    })
  }
  entries.sort((a, b) => b.mtimeMs - a.mtimeMs)
  return entries.slice(0, MAX_LISTING_ENTRIES)
}

/**
 * Header fields every route answer carries, whatever the status: exports are
 * never cached (each name's content mutates by overwrite, so a stale copy is
 * worse than no copy), exported pages are not for framing elsewhere, and the
 * document must never leak the page address to the public CDNs its scripts
 * load from. Keeping one table means a 404 and a 200 are indistinguishable
 * by header shape — an invalid name reveals nothing through presence or
 * absence of hardening.
 */
const SERVE_HEADERS: Record<string, string> = {
  'cache-control': 'no-store',
  'content-security-policy': RENDER_CSP_DIRECTIVES,
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  'x-frame-options': 'DENY',
  'cross-origin-resource-policy': 'same-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), usb=(), interest-cohort=()',
}

/** The not-found page served for any name the route does not hold, and for
 * every failure class alike — missing token, stale token after a restart,
 * unknown or malformed name — so an answer never reveals which applied. */
const NOT_FOUND_PAGE = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Export not found</title></head>
<body style="font-family: system-ui, sans-serif; color: #888; padding: 2rem;">
<p>No exported visualizer document answers this address.</p>
<p style="font-size: 0.85em;">The share link carries a key that is renewed each time the harness starts,
so links saved before a restart stop working — open the document again from the chat and share it fresh.
Otherwise the export may have expired by the retention policy; ask the agent to render it again.</p>
</body>
</html>`

/**
 * Escape one string for embedding inside a double-quoted attribute value:
 * `&` first (so later escapes stay escaped), then the quote delimiter. `<`
 * needs no escape in a quoted attribute value, keeping the payload of large
 * documents close to its original size.
 */
function escapeAttr(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('"', '&quot;')
}

/**
 * The wrapper page one exported HTML document serves through: a chrome-less
 * frame whose `sandbox="allow-scripts"` places the document in an opaque
 * origin — generated scripts execute, but hold no handle on the harness
 * origin's cookies, storage, or same-origin endpoints. The frame's `srcdoc`
 * inherits this page's CSP, so {@link SERVE_HEADERS}'s policy governs both
 * layers from one response. The wrapper carries no scripts of its own.
 * @param base - the export's base name, echoed as the page title so a saved
 * wrapper file stays recognizable.
 * @param doc - the complete escaped-once document bytes.
 */
function wrapExportPage(base: string, doc: string): string {
  const title = escapeAttr(base)
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>html,body{margin:0;height:100%}iframe{border:0;width:100%;height:100%;display:block;background:#fff}</style>
</head>
<body>
<iframe sandbox="allow-scripts" title="${title}" srcdoc="${escapeAttr(doc)}"></iframe>
</body>
</html>`
}

/**
 * The boot capability token gating the serve route: one unguessable value per
 * process boot, pushed to served pages through the index-inject table and
 * required as `?k=` on every export request. Links stop being enumerable —
 * knowing (or guessing) a name alone serves nothing. Holding the token is the
 * access grant, so a shared link keeps working until the harness restarts.
 */
function bootToken(): string {
  return randomBytes(16).toString('base64url')
}

/**
 * Serve one finalized export, or — the route's own root, no name segment —
 * the artifact gallery's JSON listing of everything currently on disk.
 * Requests carry the boot capability token as `?k=`; anything else takes the
 * indistinguishable not-found answer — no token oracle, no enumeration.
 * HTML documents go out through the sandboxed
 * wrapper — an LLM-authored page never runs on the harness origin itself;
 * bare SVG goes out raw under a CSP variant with scripting removed outright,
 * since a diagram has no honest use for script and `<img>`-embedded copies
 * would not run it either. Both answers carry the shared hardening table.
 * Only a regular file of the exports directory is servable: a symlink planted
 * in the directory (or any special node) refuses with the indistinguishable
 * not-found answer instead of leaking another path's bytes. TOCTOU between
 * lstat and readFile is accepted — the check closes the planted-entry class;
 * narrowing it further needs O_NOFOLLOW semantics out of scope here.
 */
async function serveExport(state: FanoutState, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const method = req.method ?? 'GET'
  if (method !== 'GET' && method !== 'HEAD') {
    res.writeHead(405, { allow: 'GET, HEAD', ...SERVE_HEADERS })
    res.end()
    return
  }
  let name = ''
  let token = ''
  try {
    const url = new URL(req.url ?? '/', 'http://x')
    const rest = url.pathname.startsWith(`${EXPORTS_ROUTE_PATH}/`) ? url.pathname.slice(EXPORTS_ROUTE_PATH.length + 1) : ''
    name = decodeURIComponent(rest)
    token = url.searchParams.get('k') ?? ''
  } catch {
    // a malformed escape falls through to the not-found page
  }
  const notFoundHeaders = { ...SERVE_HEADERS, 'content-type': 'text/html; charset=utf-8' }
  // Constant-time comparison: the token gates every byte this route serves.
  if (token.length !== state.token.length
    || !timingSafeEqual(Buffer.from(token), Buffer.from(state.token))) {
    res.writeHead(404, notFoundHeaders)
    res.end(method === 'HEAD' ? undefined : NOT_FOUND_PAGE)
    return
  }
  // The route's own root (no name segment) is the gallery's listing request:
  // every finalized export currently on disk, gated by the same token check
  // above — the listing is as much a capability as any one export link.
  if (name.length === 0) {
    try {
      await state.ready
      const body = Buffer.from(JSON.stringify({ entries: await listArtifacts(state.config.dir) }), 'utf8')
      res.writeHead(200, {
        ...SERVE_HEADERS,
        'content-type': 'application/json; charset=utf-8',
        'content-length': body.length,
      })
      res.end(method === 'HEAD' ? undefined : body)
    } catch {
      res.writeHead(404, notFoundHeaders)
      res.end(method === 'HEAD' ? undefined : NOT_FOUND_PAGE)
    }
    return
  }
  if (!isServableExportName(name)) {
    res.writeHead(404, notFoundHeaders)
    res.end(method === 'HEAD' ? undefined : NOT_FOUND_PAGE)
    return
  }
  try {
    // The directory must exist before a read can succeed; `ready` never
    // rejects (its failure path only logs), so a lost race still lands on
    // the not-found answer below instead of throwing.
    await state.ready
    const path = join(state.config.dir, name)
    const stats = await lstat(path)
    if (!stats.isFile()) throw new Error('not a regular file')
    const body = await readFile(path)
    if (name.endsWith('.svg')) {
      // A bare SVG diagram serves directly (it stays hotlinkable as an
      // image), but its document-level CSP drops scripting entirely: the
      // only change against the shared policy.
      res.writeHead(200, {
        ...SERVE_HEADERS,
        'content-security-policy': RENDER_CSP_DIRECTIVES.replace(/script-src[^;]+;/, "script-src 'none';"),
        'content-type': 'image/svg+xml',
        'content-length': body.length,
      })
    } else {
      // An HTML document runs inside the sandboxed wrapper, never on this
      // origin; the wrapper inherits the policy below into its srcdoc frame.
      // The wrapper title is the served name sans extension — friendly base
      // plus digest — matching what a saved wrapper file will be called.
      const page = Buffer.from(wrapExportPage(name.slice(0, -'.html'.length), body.toString('utf8')), 'utf8')
      res.writeHead(200, {
        ...SERVE_HEADERS,
        'content-type': 'text/html; charset=utf-8',
        'content-length': page.length,
      })
      res.end(method === 'HEAD' ? undefined : page)
      return
    }
    res.end(method === 'HEAD' ? undefined : body)
  } catch {
    res.writeHead(404, notFoundHeaders)
    res.end(method === 'HEAD' ? undefined : NOT_FOUND_PAGE)
  }
}

/**
 * Register the export fanout on one context: the streaming sidecar/finalize
 * fold over the session firehose, plus the serve route on the web server.
 * Everything lands as effects of the given context, so the whole feature
 * unmounts with it — call it from the `webServer`-injected callback so the
 * fanout exists exactly where exports are shareable.
 * @param ctx - context carrying the `webServer` service.
 * @param config - exports directory and the mirrored render limit.
 */
export function registerExportFanout(ctx: Context, config: ExportFanoutConfig): void {
  // The share key gates every serve request. Empty (the default) takes the
  // fresh-per-boot random; a configured value pins it so links survive
  // restarts — but then the key lives in a plaintext config file, so a short
  // one turns an unguessable gate into a guessable one and earns a warning.
  const trimmedKey = config.shareKey.trim()
  if (trimmedKey.length > 0 && trimmedKey.length < 16) {
    ctx.logger.warn(`export fanout: shareKey is shorter than 16 characters — a fixed weak key makes shared pages guessable`)
  }
  const state: FanoutState = {
    config,
    ctx,
    ready: mkdir(config.dir, { recursive: true, mode: 0o700 }).then(() => undefined, (error: unknown) => {
      ctx.logger.warn(`export fanout: cannot create ${config.dir}: ${error instanceof Error ? error.message : String(error)}`)
    }),
    sessions: new WeakMap(),
    chains: new Map(),
    lastPartialAt: new Map(),
    finalOwners: new Map(),
    token: trimmedKey.length > 0 ? trimmedKey : bootToken(),
  }

  const server = (ctx as unknown as { webServer: WebServerLike }).webServer
  ctx.effect(() => server.register({
    kind: 'prefix',
    path: EXPORTS_ROUTE_PATH,
    handler: (req, res) => serveExport(state, req, res),
  }), 'visualizer: exports route')

  // Retention sweep at activation, before any request can arrive: digest-keyed
  // names accumulate by design, so expiry replaces the overwrite self-cleaning.
  // A failure logs one line and never blocks the route or the fold.
  if (config.artifactRetentionDays > 0) {
    const cutoff = Date.now() - config.artifactRetentionDays * 86_400_000
    enqueue(state, ':retention', async () => {
      await state.ready
      for (const entry of await readdir(config.dir)) {
        if (!isServableExportName(entry)) continue
        const stats = await lstat(join(config.dir, entry)).catch(() => null)
        if (stats === null || !stats.isFile() || stats.mtimeMs >= cutoff) continue
        await unlinkQuiet(join(config.dir, entry))
      }
    })
  }

  const on = (ctx as unknown as { on: LooseOn }).on
  on('session/event', (session: unknown, event: unknown) => {
    if (typeof session !== 'object' || session === null) return
    handleEvent(state, session, event as WireEvent)
  })
  // Announce the feature on the boot table, carrying the capability token:
  // the served page stores it where the card's share control reads it, and
  // every export request echoes it back as `?k=`. A deployment with the
  // feature off never sets it, and the cards hide the share control.
  // Rows are read fresh at every emit, so the announcement tracks activation.
  on('webserver/index-inject', (table: unknown) => {
    if (Array.isArray(table)) {
      table.push({ kind: 'global', name: EXPORTS_BOOT_GLOBAL, value: state.token })
    }
  })
}

/**
 * One appended session event, post-commit: fold the stream, finalize landed
 * calls, clean up failures and interruptions.
 */
function handleEvent(state: FanoutState, session: object, event: WireEvent): void {
  const record = sessionState(state, session)
  switch (event.type) {
    case 'assistant/chunk': {
      const chunk = event.data.chunk
      if (chunk.type === 'tool-call-delta') {
        foldDelta(state, record, event.data.turn, event.data.step, chunk.index, chunk.id, chunk.name, chunk.argumentsDelta)
      } else if (chunk.type === 'block-end' && chunk.block.type === 'tool-call') {
        foldFinalBlock(record, event.data.turn, event.data.step, chunk.index, {
          id: chunk.block.id, name: chunk.block.name ?? '', arguments: chunk.block.arguments ?? '',
        })
      }
      return
    }
    case 'assistant/message': {
      // An interrupted step never dispatches: its partials are residue, removed.
      if (event.data.interrupted === true) {
        resetStep(state, record, event.data.turn, event.data.step)
        return
      }
      const content = event.data.message.content
      for (let index = 0; index < content.length; index++) {
        const block = content[index]
        if (block !== null && typeof block === 'object' && (block as { type?: string }).type === 'tool-call') {
          const call = block as { id: unknown; name: string; arguments: string }
          foldFinalBlock(record, event.data.turn, event.data.step, index, call)
        }
      }
      // A settled step admits no more deltas or retries, so its accumulator
      // entry is residue; finalize reads only `exports` records, so dropping
      // the step never affects the later `tool/call`.
      record.steps.delete(`${event.data.turn}:${event.data.step}`)
      return
    }
    case 'llm/retry':
      resetStep(state, record, event.data.turn, event.data.step)
      return
    case 'tool/call':
      finalizeCall(state, record, event)
      return
    case 'tool/result': {
      const first = event.data.message.content[0]
      if (first === undefined) return
      const id = callKey(first.toolCallId)
      if (event.data.error !== undefined) {
        cleanupCall(state, record, id)
      } else {
        settleCall(state, record, id)
      }
      return
    }
    default:
      return
  }
}
