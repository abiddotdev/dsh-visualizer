/**
 * Artifact export route, node half: serves, lists, deletes, and — on
 * request — creates the shareable mirror of one `visualizer` call.
 *
 * Nothing is written to disk until a card's Share control asks for it.
 * `POST {route}` names one call (`{callId}`); this module reads the call's
 * arguments straight from whichever currently-live session's durable log
 * logged it — never from bytes the request carries — verifies it is a
 * settled, non-error `visualizer` call, and writes the resulting document
 * under the name both planes independently derive from `(title, html)` (see
 * `shared/export-name.ts`). The write is idempotent: exporting the same call
 * twice reproduces the same bytes under the same name, a harmless overwrite.
 *
 * Reading the durable log (rather than trusting the request body) keeps the
 * write path exactly as trustworthy as the render pipeline that produced the
 * content in the first place — an export names a call that already
 * happened; a caller who does not hold the export route's own capability
 * token cannot make one up, and one who does still cannot choose what bytes
 * get written, only which already-logged call to mirror.
 *
 * The route activates only where a web server exists (the web profile), so
 * an export exists exactly when it is shareable; surfaces without one keep
 * the tool's untouched, filesystem-free behavior.
 *
 * @module dsh-visualizer/export-fanout
 */

import { timingSafeEqual } from 'node:crypto'
import { randomBytes } from 'node:crypto'
import { lstat, mkdir, readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
// Type-side-effect import: pulls the `Context.sessions` augmentation into the
// program so `ctx.sessions` below is checked against the real contract
// instead of a hand-mirrored structural guess.
import type {} from '@deepseek-ai/dsh-session'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { RENDER_CSP_DIRECTIVES } from './shared/export-csp.ts'
import {
  type ArtifactListEntry, EXPORTS_BOOT_GLOBAL, EXPORTS_ROUTE_PATH, displayTitleOf, exportShareName,
  isServableExportName, partialFileName,
} from './shared/export-name.ts'

/** Wire name of the render tool; only its calls export. */
const TOOL_NAME = 'visualizer'

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
 * Normalize a call identity (branded `ToolCallId`, or whatever the request
 * body carried) to a plain string for comparison.
 */
function callKey(id: unknown): string {
  return String(id ?? '')
}

/** Configuration the route runs under. */
export interface ExportFanoutConfig {
  /** Absolute exports directory; created on activation. */
  readonly dir: string
  /** Per-call render size limit in bytes; a resolved call over this never writes. */
  readonly maxArtifactBytes: number
  /** Days a finalized artifact survives; `0` disables the expiry sweep. */
  readonly artifactRetentionDays: number
  /** Fixed share key; empty issues a fresh random one per boot. */
  readonly shareKey: string
}

/** All route state for one registration. */
interface FanoutState {
  readonly config: ExportFanoutConfig
  readonly ctx: Context
  /** mkdir completion; every file write awaits it, so the directory exists first. */
  readonly ready: Promise<void>
  /** Tail of each in-flight write, keyed by resolved export name — serializes
   * a double-click into one write followed by a fast no-op, instead of two
   * writers racing the same path. Self-pruning: an entry only lives while its
   * write is in flight. */
  readonly writeLocks: Map<string, Promise<void>>
  /** Sliding window of recent export request timestamps, for the rate limit. */
  readonly exportRequestTimes: number[]
  /** Per-boot capability token every request must echo as `?k=`. */
  readonly token: string
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
 * Sidecar at the root of the exports directory holding the pinned name set.
 * Never itself servable or listed: it carries no `.html`/`.svg` extension, so
 * `isServableExportName` rejects it the same way it rejects any other stray
 * file in the directory — no special-casing needed in the listing, serve, or
 * delete paths.
 */
const PIN_STORE_NAME = 'pins.json'

/**
 * Lock key serializing pin-store reads/writes through the same
 * {@link withWriteLock} map real export writes use. A leading space can never
 * equal a real export name (every one ends `.html`/`.svg`), so a pin-store
 * operation can never alias, and therefore never queue behind, one
 * particular export's own write lock.
 */
const PIN_STORE_LOCK_KEY = ' pins'

/**
 * The current pinned set, read fresh with no lock: the write side always
 * writes via temp-file + atomic rename, so a concurrent plain read only ever
 * sees a complete old or new file, never torn. A missing or corrupt file
 * both read as "nothing pinned" rather than failing the caller.
 * @param state - route state carrying the exports directory.
 */
async function readPinSet(state: FanoutState): Promise<Set<string>> {
  try {
    const raw = await readFile(join(state.config.dir, PIN_STORE_NAME), 'utf8')
    const parsed: unknown = JSON.parse(raw)
    return new Set(Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === 'string') : [])
  } catch {
    return new Set()
  }
}

/**
 * Persist the pinned set: temp file next to it, then an atomic rename, so a
 * concurrent {@link readPinSet} never sees a torn write.
 * @param state - route state carrying the exports directory.
 * @param pins - the complete pinned set to persist.
 */
async function writePinSet(state: FanoutState, pins: ReadonlySet<string>): Promise<void> {
  const dir = state.config.dir
  const tmp = join(dir, `${PIN_STORE_NAME}.tmp-${randomBytes(4).toString('hex')}`)
  await writeFile(tmp, JSON.stringify([...pins].sort()), 'utf8')
  await rename(tmp, join(dir, PIN_STORE_NAME))
}

/**
 * Set one export's pinned bit, read-modify-write serialized under
 * {@link PIN_STORE_LOCK_KEY} so two concurrent toggles never race each
 * other's read of the same file. A no-op (already pinned/unpinned) skips the
 * write entirely.
 * @param state - route state.
 * @param name - the export name to pin or unpin.
 * @param pinned - the desired state.
 */
async function setPinned(state: FanoutState, name: string, pinned: boolean): Promise<void> {
  await withWriteLock(state, PIN_STORE_LOCK_KEY, async () => {
    const pins = await readPinSet(state)
    const changed = pinned ? !pins.has(name) : pins.has(name)
    if (!changed) return
    if (pinned) pins.add(name)
    else pins.delete(name)
    await writePinSet(state, pins)
  })
}

/**
 * Drop one name from the pin set if present — called when an export is
 * deleted, so `pins.json` never accumulates a name for a file that no longer
 * exists.
 * @param state - route state.
 * @param name - the export name being removed.
 */
async function unpinIfPresent(state: FanoutState, name: string): Promise<void> {
  await withWriteLock(state, PIN_STORE_LOCK_KEY, async () => {
    const pins = await readPinSet(state)
    if (!pins.delete(name)) return
    await writePinSet(state, pins)
  })
}

/**
 * Run one operation after any prior operation queued under the same key has
 * settled (success or failure), and let the next one queue behind this in
 * turn. Unlike a plain mutex, the caller still sees this operation's own
 * result — a failed write reports 500, it does not silently vanish into a
 * background chain.
 * @param state - route state carrying the lock map.
 * @param key - the export name being written; the granularity of the lock.
 * @param op - the operation to serialize.
 * @returns `op`'s own result or rejection.
 */
async function withWriteLock<T>(state: FanoutState, key: string, op: () => Promise<T>): Promise<T> {
  const previous = state.writeLocks.get(key) ?? Promise.resolve()
  const chained = previous.catch(() => {}).then(op)
  const marker = chained.then(() => undefined, () => undefined)
  state.writeLocks.set(key, marker)
  try {
    return await chained
  } finally {
    if (state.writeLocks.get(key) === marker) state.writeLocks.delete(key)
  }
}

/** Most rows the gallery listing returns; bounds response size on a long-lived, high-volume artifact directory. */
const MAX_LISTING_ENTRIES = 500

/**
 * Every finalized export currently on disk, pinned first then most recent,
 * for the artifact gallery's listing request. Read live rather than cached —
 * the directory is small relative to a request's cost, and a cache would
 * show artifacts the retention sweep already removed.
 * @param state - route state (directory, pin store).
 * @returns entries pinned-first, newest-first within each group, capped at
 * {@link MAX_LISTING_ENTRIES}.
 */
async function listArtifacts(state: FanoutState): Promise<ArtifactListEntry[]> {
  const dir = state.config.dir
  let names: string[]
  try {
    names = await readdir(dir)
  } catch (error: unknown) {
    // Nothing has ever been shared yet: an empty list, not a failure.
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  }
  const pins = await readPinSet(state)
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
      pinned: pins.has(name),
    })
  }
  entries.sort((a, b) => (a.pinned === b.pinned ? b.mtimeMs - a.mtimeMs : a.pinned ? -1 : 1))
  return entries.slice(0, MAX_LISTING_ENTRIES)
}

/** One resolved visualizer call's durable document — never client-supplied bytes. */
interface ResolvedCall {
  readonly title: string | null
  readonly html: string
}

/**
 * Find and parse the `visualizer` call `callId` names within one session's
 * durable log, if it is there at all.
 * @param events - one session's complete event snapshot.
 * @param callId - the call to resolve.
 * @returns the call's title/html, or null when the call is absent from this
 * session's log, is not a `visualizer` call, never settled, or settled as
 * an error.
 */
function resolveFromEvents(events: readonly SessionEvent[], callId: string): ResolvedCall | null {
  let args: string | null = null
  let settledOk = false
  for (const event of events) {
    if (event.type === 'tool/call' && event.data.name === TOOL_NAME && callKey(event.data.callId) === callId) {
      args = event.data.arguments
    } else if (event.type === 'tool/result' && callKey(event.data.message.content[0].toolCallId) === callId) {
      settledOk = event.data.error === undefined
    }
  }
  if (args === null || !settledOk) return null
  let parsed: { title?: unknown; html?: unknown }
  try {
    parsed = JSON.parse(args) as { title?: unknown; html?: unknown }
  } catch {
    return null
  }
  if (typeof parsed.html !== 'string' || parsed.html.trim().length === 0) return null
  const title = typeof parsed.title === 'string' && parsed.title.trim().length > 0 ? parsed.title : null
  return { title, html: parsed.html }
}

/**
 * Resolve one settled `visualizer` call's document straight from a session's
 * durable log — never from bytes the request carries. The request names
 * only the call, not its session: `ToolCallId`s are provider-issued and
 * unique enough in practice that scanning every currently live session for
 * the one that logged it is simpler than asking the browser to also track
 * and send a session identity it may not reliably know at click time.
 * Requires the owning session to still be live (loaded in this harness
 * process) — a card can only be looking at, and therefore only ask to
 * export, a call whose session is live, so this is not a practical limit
 * beyond what is already true of the UI that calls it.
 * @param ctx - context carrying the `sessions` service.
 * @param callId - the call to resolve.
 * @returns the call's title/html, or null when no live session logged it,
 * it is not a `visualizer` call, never settled, or settled as an error —
 * any of which refuses the export with the same not-found answer, so a
 * caller cannot use this to probe which case applied.
 */
function resolveCallDocument(ctx: Context, callId: string): ResolvedCall | null {
  for (const session of ctx.sessions.list()) {
    const resolved = resolveFromEvents(session.snapshotEvents(), callId)
    if (resolved !== null) return resolved
  }
  return null
}

/**
 * Write one resolved document under its co-computed name: a temp file next
 * to it, then an atomic rename, so a concurrent reader never sees a torn or
 * half-named export. Serialized per name so exporting the same call twice in
 * quick succession is a fast no-op behind the first write, not a race.
 * @param state - route state (directory, write-lock map).
 * @param resolved - the call's title/html, already read from durable log.
 * @returns the finalized export's name.
 */
async function writeArtifact(state: FanoutState, resolved: ResolvedCall): Promise<string> {
  const name = exportShareName(resolved.title, resolved.html)
  return withWriteLock(state, name, async () => {
    await state.ready
    const sidecar = join(state.config.dir, partialFileName(name))
    const final = join(state.config.dir, name)
    await writeFile(sidecar, resolved.html, 'utf8')
    await rename(sidecar, final)
    return name
  })
}

/** Longest raw body the export-request endpoint accepts; `{callId}` is a few dozen bytes. */
const MAX_EXPORT_REQUEST_BYTES = 4_096

/**
 * Collect a request body up to a byte cap, rejecting (and destroying the
 * connection) rather than buffering an oversized body — the payload this
 * route expects is tiny, so anything past the cap is already misbehaving.
 */
function readJsonBody(req: IncomingMessage, maxBytes: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let total = 0
    req.on('data', (chunk: Buffer) => {
      total += chunk.length
      if (total > maxBytes) {
        req.destroy()
        reject(new Error('request body too large'))
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch (error) {
        reject(error instanceof Error ? error : new Error('invalid JSON body'))
      }
    })
    req.on('error', reject)
  })
}

/** Rate-limit window for export requests. */
const EXPORT_RATE_WINDOW_MS = 60_000
/** Most export requests honored inside one window — generous for a user reviewing and sharing several renders, tight enough to blunt a scripted loop. */
export const EXPORT_RATE_LIMIT = 30

/**
 * Whether one more export request fits inside the current rate window,
 * recording it if so. One shared window for the whole route: every request
 * already carries the same single per-boot (or pinned) capability token, so
 * "per caller" and "per boot" are the same thing here.
 */
function admitExportRequest(state: FanoutState): boolean {
  const now = Date.now()
  const cutoff = now - EXPORT_RATE_WINDOW_MS
  while (state.exportRequestTimes.length > 0 && state.exportRequestTimes[0]! < cutoff) state.exportRequestTimes.shift()
  if (state.exportRequestTimes.length >= EXPORT_RATE_LIMIT) return false
  state.exportRequestTimes.push(now)
  return true
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
 * The boot capability token gating the route: one unguessable value per
 * process boot, pushed to served pages through the index-inject table and
 * required as `?k=` on every request. Links stop being enumerable —
 * knowing (or guessing) a name alone serves nothing. Holding the token is the
 * access grant, so a shared link keeps working until the harness restarts.
 */
function bootToken(): string {
  return randomBytes(16).toString('base64url')
}

/**
 * Serve, list, create, or delete artifact exports, all behind one route:
 *
 * - `GET {route}/<name>` — one finalized export (see {@link wrapExportPage}
 *   for HTML; bare SVG goes out raw with scripting stripped from its CSP).
 * - `GET {route}/` (no name segment) — the gallery's JSON listing of
 *   everything currently on disk.
 * - `POST {route}/` with `{callId}` — create the export for one settled
 *   call, reading its document from whichever live session logged it.
 * - `PATCH {route}/<name>` with `{pinned}` — set one export's pinned bit:
 *   pinned exports sort first in the listing and are exempt from the
 *   retention sweep.
 * - `DELETE {route}/<name>` — remove one export from disk (and drop it from
 *   the pin set, if pinned).
 *
 * Every request carries the boot capability token as `?k=`; anything else
 * (missing token, wrong token, unknown or malformed name) takes the same
 * indistinguishable not-found answer — no token oracle, no enumeration.
 * Only a regular file of the exports directory is ever read, written, or
 * removed: a symlink planted in the directory (or any special node) refuses
 * the same way rather than following or replacing it. TOCTOU between lstat
 * and the operation is accepted — the check closes the planted-entry class;
 * narrowing it further needs O_NOFOLLOW semantics out of scope here.
 */
async function serveExport(state: FanoutState, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const method = req.method ?? 'GET'
  if (method !== 'GET' && method !== 'HEAD' && method !== 'DELETE' && method !== 'POST' && method !== 'PATCH') {
    res.writeHead(405, { allow: 'GET, HEAD, POST, PATCH, DELETE', ...SERVE_HEADERS })
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
  // Constant-time comparison: the token gates every byte this route touches.
  if (token.length !== state.token.length
    || !timingSafeEqual(Buffer.from(token), Buffer.from(state.token))) {
    res.writeHead(404, notFoundHeaders)
    res.end(method === 'HEAD' ? undefined : NOT_FOUND_PAGE)
    return
  }
  if (method === 'POST') {
    if (name.length !== 0) {
      res.writeHead(404, notFoundHeaders)
      res.end()
      return
    }
    if (!admitExportRequest(state)) {
      res.writeHead(429, { ...SERVE_HEADERS, 'retry-after': '60' })
      res.end()
      return
    }
    let body: unknown
    try {
      body = await readJsonBody(req, MAX_EXPORT_REQUEST_BYTES)
    } catch {
      res.writeHead(400, SERVE_HEADERS)
      res.end()
      return
    }
    const { callId } = typeof body === 'object' && body !== null ? body as Record<string, unknown> : {}
    if (typeof callId !== 'string' || callId.length === 0) {
      res.writeHead(400, SERVE_HEADERS)
      res.end()
      return
    }
    const resolved = resolveCallDocument(state.ctx, callId)
    if (resolved === null) {
      res.writeHead(404, notFoundHeaders)
      res.end()
      return
    }
    if (Buffer.byteLength(resolved.html, 'utf8') > state.config.maxArtifactBytes) {
      // Defensive only: the tool itself already refuses to settle a call
      // this large, so a resolved call should never reach here over the cap
      // unless the config was lowered after the fact.
      res.writeHead(404, notFoundHeaders)
      res.end()
      return
    }
    try {
      const finalName = await writeArtifact(state, resolved)
      const responseBody = Buffer.from(JSON.stringify({ name: finalName }), 'utf8')
      res.writeHead(200, {
        ...SERVE_HEADERS,
        'content-type': 'application/json; charset=utf-8',
        'content-length': responseBody.length,
      })
      res.end(responseBody)
    } catch (error: unknown) {
      state.ctx.logger.warn(`export fanout: ${error instanceof Error ? error.message : String(error)}`)
      res.writeHead(500, SERVE_HEADERS)
      res.end()
    }
    return
  }
  if (method === 'PATCH') {
    if (name.length === 0 || !isServableExportName(name)) {
      res.writeHead(404, notFoundHeaders)
      res.end()
      return
    }
    let body: unknown
    try {
      body = await readJsonBody(req, MAX_EXPORT_REQUEST_BYTES)
    } catch {
      res.writeHead(400, SERVE_HEADERS)
      res.end()
      return
    }
    const { pinned } = typeof body === 'object' && body !== null ? body as Record<string, unknown> : {}
    if (typeof pinned !== 'boolean') {
      res.writeHead(400, SERVE_HEADERS)
      res.end()
      return
    }
    try {
      await state.ready
      const stats = await lstat(join(state.config.dir, name))
      if (!stats.isFile()) throw new Error('not a regular file')
      await setPinned(state, name, pinned)
      res.writeHead(204, SERVE_HEADERS)
      res.end()
    } catch {
      res.writeHead(404, notFoundHeaders)
      res.end()
    }
    return
  }
  if (method === 'DELETE') {
    if (name.length === 0 || !isServableExportName(name)) {
      res.writeHead(404, notFoundHeaders)
      res.end()
      return
    }
    try {
      await state.ready
      const path = join(state.config.dir, name)
      const stats = await lstat(path)
      if (!stats.isFile()) throw new Error('not a regular file')
      await unlink(path)
      await unpinIfPresent(state, name)
      res.writeHead(204, SERVE_HEADERS)
      res.end()
    } catch {
      res.writeHead(404, notFoundHeaders)
      res.end()
    }
    return
  }
  // The route's own root (no name segment) is the gallery's listing request:
  // every finalized export currently on disk, gated by the same token check
  // above — the listing is as much a capability as any one export link.
  if (name.length === 0) {
    try {
      await state.ready
      const body = Buffer.from(JSON.stringify({ entries: await listArtifacts(state) }), 'utf8')
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
 * Register the export route on one context. Everything lands as an effect of
 * the given context, so the whole feature unmounts with it — call it from
 * the `webServer`+`sessions`-injected callback so the route exists exactly
 * where exports are shareable and durable-log reads are possible.
 * @param ctx - context carrying the `webServer` and `sessions` services.
 * @param config - exports directory, the render size cap, retention, and the share key.
 */
export function registerExportFanout(ctx: Context, config: ExportFanoutConfig): void {
  // The share key gates every request. Empty (the default) takes the
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
    writeLocks: new Map(),
    exportRequestTimes: [],
    token: trimmedKey.length > 0 ? trimmedKey : bootToken(),
  }

  const server = (ctx as unknown as { webServer: WebServerLike }).webServer
  ctx.effect(() => server.register({
    kind: 'prefix',
    path: EXPORTS_ROUTE_PATH,
    handler: (req, res) => serveExport(state, req, res),
  }), 'visualizer: exports route')

  // Retention sweep at activation, before any request can arrive: digest-keyed
  // names accumulate by design (no auto-mirror to self-clean by overwrite
  // the way a fixed-name file would), so expiry is what bounds disk usage
  // over time. A failure logs one line and never blocks the route.
  if (config.artifactRetentionDays > 0) {
    const cutoff = Date.now() - config.artifactRetentionDays * 86_400_000
    void (async () => {
      await state.ready
      const pins = await readPinSet(state)
      for (const entry of await readdir(config.dir)) {
        if (!isServableExportName(entry)) continue
        if (pins.has(entry)) continue // pinned artifacts are exempt regardless of age
        const stats = await lstat(join(config.dir, entry)).catch(() => null)
        if (stats === null || !stats.isFile() || stats.mtimeMs >= cutoff) continue
        await unlinkQuiet(join(config.dir, entry))
      }
    })().catch((error: unknown) => {
      ctx.logger.warn(`export fanout: retention sweep failed: ${error instanceof Error ? error.message : String(error)}`)
    })
  }

  // Announce the feature on the boot table, carrying the capability token:
  // the served page stores it where the card's share control reads it, and
  // every export request echoes it back as `?k=`. A deployment with the
  // feature off never sets it, and the cards hide the share control.
  // Rows are read fresh at every emit, so the announcement tracks activation.
  const on = (ctx as unknown as { on: (name: string, listener: (...args: unknown[]) => void) => () => boolean }).on
  on('webserver/index-inject', (table: unknown) => {
    if (Array.isArray(table)) {
      table.push({ kind: 'global', name: EXPORTS_BOOT_GLOBAL, value: state.token })
    }
  })
}
