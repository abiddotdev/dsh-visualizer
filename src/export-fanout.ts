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

import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import { extractStreamArgs } from './client/partial-args.ts'
import { RENDER_CSP_DIRECTIVES } from './shared/export-csp.ts'
import {
  EXPORTS_BOOT_GLOBAL, EXPORTS_ROUTE_PATH, exportFileBase, exportFileName, isServableExportName, partialFileName,
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
  /** Per-call render limit in bytes; the fanout mirrors it, never exceeds it. */
  readonly maxHtmlBytes: number
}

/** One fanout's private mutable bookkeeping. */
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
 * holds one tail per call id, bounded by live renders.
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
  if (Buffer.byteLength(view.html, 'utf8') > state.config.maxHtmlBytes) return
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
  if (Buffer.byteLength(parsed.html, 'utf8') > state.config.maxHtmlBytes) return
  const html = parsed.html
  const title = typeof parsed.title === 'string' && parsed.title.trim().length > 0 ? parsed.title : null
  const sidecar = join(state.config.dir, partialFileName(exportFileBase(title)))
  const final = join(state.config.dir, exportFileName(title, html))
  const record = exportRecord(session, id)
  const stale = record.sidecar !== null && record.sidecar !== sidecar ? record.sidecar : null
  record.sidecar = null
  record.final = final
  state.finalOwners.set(final, id)
  enqueue(state, id, async () => {
    await state.ready
    await writeFile(sidecar, html, 'utf8')
    await rename(sidecar, final)
    if (stale !== null) await unlinkQuiet(stale)
  })
}

/** The not-found page served for any name the route does not hold. */
const NOT_FOUND_PAGE = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><title>Export not found</title></head>
<body style="font-family: system-ui, sans-serif; color: #888; padding: 2rem;">
<p>No exported visualizer document answers this address.</p>
<p>没有找到对应的可视化导出文档。</p>
<p style="font-size: 0.85em;">Exports are written while a document streams; ask the agent to render it again.</p>
</body>
</html>`

/**
 * Serve one finalized export. The response carries the same network-egress
 * CSP the sandboxed shell enforces, so the standalone page can fetch nothing
 * the inline preview could not.
 */
async function serveExport(state: FanoutState, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const method = req.method ?? 'GET'
  if (method !== 'GET' && method !== 'HEAD') {
    res.writeHead(405, { allow: 'GET, HEAD' })
    res.end()
    return
  }
  let name = ''
  try {
    const url = new URL(req.url ?? '/', 'http://x')
    const rest = url.pathname.startsWith(`${EXPORTS_ROUTE_PATH}/`) ? url.pathname.slice(EXPORTS_ROUTE_PATH.length + 1) : ''
    name = decodeURIComponent(rest)
  } catch {
    // a malformed escape falls through to the not-found page
  }
  if (!isServableExportName(name)) {
    res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' })
    res.end(method === 'HEAD' ? undefined : NOT_FOUND_PAGE)
    return
  }
  try {
    const body = await readFile(join(state.config.dir, name))
    res.writeHead(200, {
      'content-type': name.endsWith('.svg') ? 'image/svg+xml' : 'text/html; charset=utf-8',
      'content-length': body.length,
      'cache-control': 'no-cache',
      'content-security-policy': RENDER_CSP_DIRECTIVES,
      'x-content-type-options': 'nosniff',
    })
    res.end(method === 'HEAD' ? undefined : body)
  } catch {
    res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' })
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
  const state: FanoutState = {
    config,
    ctx,
    ready: mkdir(config.dir, { recursive: true }).then(() => undefined, (error: unknown) => {
      ctx.logger.warn(`export fanout: cannot create ${config.dir}: ${error instanceof Error ? error.message : String(error)}`)
    }),
    sessions: new WeakMap(),
    chains: new Map(),
    lastPartialAt: new Map(),
    finalOwners: new Map(),
  }

  const server = (ctx as unknown as { webServer: WebServerLike }).webServer
  ctx.effect(() => server.register({
    kind: 'prefix',
    path: EXPORTS_ROUTE_PATH,
    handler: (req, res) => serveExport(state, req, res),
  }), 'visualizer: exports route')

  const on = (ctx as unknown as { on: LooseOn }).on
  on('session/event', (session: unknown, event: unknown) => {
    if (typeof session !== 'object' || session === null) return
    handleEvent(state, session, event as WireEvent)
  })
  // Announce the feature on the boot table: the served page sets the shared
  // global, and the card hides its share control when the flag never arrives.
  // Rows are read fresh at every emit, so the announcement tracks activation.
  on('webserver/index-inject', (table: unknown) => {
    if (Array.isArray(table)) {
      table.push({ kind: 'global', name: EXPORTS_BOOT_GLOBAL, value: true })
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
      return
    }
    case 'llm/retry':
      resetStep(state, record, event.data.turn, event.data.step)
      return
    case 'tool/call':
      finalizeCall(state, record, event)
      return
    case 'tool/result': {
      if (event.data.error === undefined) return
      const first = event.data.message.content[0]
      if (first === undefined) return
      cleanupCall(state, record, callKey(first.toolCallId))
      return
    }
    default:
      return
  }
}
