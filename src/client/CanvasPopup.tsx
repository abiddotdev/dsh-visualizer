/**
 * The interactive canvas popup: a floating panel anchored above the composer.
 * The durable agent scene comes from the host-computed 'canvas' projection
 * (fold of whole-scene `canvas/draw` events, tool-todo pattern); the session
 * snapshot's canvas_draw args remain a fallback plus the live streaming
 * preview source. The user draws on an overlay and presses Send to submit
 * their ops back as a [canvas] user turn through the composer's draft
 * channel.
 */

import { Component, useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the conversation package's SlotMap merge (the
// conversation.input.dock declaration) into this program.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import {
  IconEditOutline16, IconSendOutline16,
  IconChevronDownOutline14, IconChevronUpOutline14,
} from '@deepseek-ai/dsh-client-ui-primitives'
import {
  CANVAS_H, CANVAS_NOTE_MAX_CHARS, CANVAS_PROMPT_PREFIX, CANVAS_W, canvasPromptText,
} from '../canvas/types.ts'
import type { CanvasOp } from '../canvas/types.ts'
import {
  paintStroke, paintText, prepareStroke, resolvePalette, setupCanvas,
} from '../canvas/render.ts'
import type { CanvasPalette, PreparedStroke } from '../canvas/render.ts'
import { extractCanvasStreamArgs, partialPreviewOp } from '../canvas/stream-args.ts'
import type { PartialOpView } from '../canvas/stream-args.ts'
import { CANVAS_TOOL_NAME } from '../canvas/stream-node.ts'
import { NS } from './locales.ts'
import css from './CanvasPopup.module.css'

/** Longest accepted user prompt; guards the submitted turn size. */
const MAX_PROMPT_CHARS = 8_000

// ---- Remount-proof panel state ----
// Slot entries can be recycled by the host (error-boundary recovery,
// dispatch-skeleton re-mounts). Component-local useState would reset `open`
// on every recycle — the panel would spontaneously collapse mid-use. Module
// scope survives recycling, so open/userOps/note live here.
interface CanvasUiState {
  readonly open: boolean
  readonly userOps: readonly CanvasOp[]
  readonly note: string
}
let uiState: CanvasUiState = { open: false, userOps: [], note: '' }
const uiListeners = new Set<() => void>()
function setUiState(patch: Partial<CanvasUiState>): void {
  uiState = { ...uiState, ...patch }
  for (const listener of uiListeners) listener()
}
function subscribeUi(listener: () => void): () => void {
  uiListeners.add(listener)
  return () => { uiListeners.delete(listener) }
}
/** Overlay ink color id (warm pencil from the doodle prototype). */
const USER_INK = '#c96f4a'
/** Overlay pen width in logical units: ~2.4 display px at the side panel's
 * 400px width, and a normal pen weight when the ops reach the model. */
const USER_PEN_WIDTH = 6

// ---- Session-snapshot scene reconstruction ----
// The dock entry receives the session snapshot as a point-in-time owner prop,
// re-rendered by the dispatching skeleton on every store change. The canvas
// scene folds out of three sources, newest wins (every canvas_draw call
// carries a WHOLE-scene snapshot):
//   1. settled tool rows in the chat flow (`kind: 'tool'` nodes),
//   2. dispatched-but-unsettled calls (`session.runningCalls`),
//   3. the still-streaming call (`session.partial.blocks` tool-call blocks).
// Because ConversationSnapshot lives in the deployed runtime package (never
// vendored — see vendor/harness-client-runtime/README.md), these structural
// views describe only what this component reads.

/** Structural view of one settled Chat tool row (deployed ToolResultNode:
 * the call head lives under `call`, not `data.root`). */
interface ToolChatNodeView {
  readonly kind: string
  readonly call?: { readonly name?: string; readonly argsRaw?: string } | null
}

/** Structural view of the streaming assistant's partial block list. */
interface PartialAssistantView {
  readonly blocks?: readonly {
    readonly kind?: string
    readonly name?: string
    readonly argsRaw?: string
  }[]
}

/** Structural view of what CanvasPopup reads off the InputZone session share. */
interface CanvasSessionView {
  readonly chat?: {
    readonly order?: readonly string[]
    readonly nodes?: { readonly get: (key: string) => unknown }
  }
  readonly runningCalls?: readonly { readonly name?: string; readonly argsRaw?: string }[]
  readonly partial?: PartialAssistantView | null
}

/** One decodable canvas_draw argument string and how far it got. */
interface SceneSource {
  readonly argsRaw: string
  /** True when the call settled (tool row); false while in flight. */
  readonly settled: boolean
}

/** Collect every canvas_draw argsRaw in chronological order (flow order for
 * settled rows, then running calls, then the streaming partial blocks). */
export function collectSceneSources(session: CanvasSessionView | undefined): SceneSource[] {
  const sources: SceneSource[] = []
  const nodes = session?.chat?.nodes
  if (nodes !== undefined && typeof nodes.get === 'function') {
    for (const key of session?.chat?.order ?? []) {
      const node = nodes.get(key) as ToolChatNodeView | undefined
      // Deployed rows are ToolResultNode ('tool-result') with a paired call
      // head; older builds nested it under data.root — accept both.
      const root = (node as { data?: { root?: { name?: string; argsRaw?: string; call?: { name?: string; argsRaw?: string } } } })?.data?.root
      const name = node?.call?.name ?? root?.name ?? root?.call?.name
      const argsRaw = node?.call?.argsRaw ?? root?.argsRaw ?? root?.call?.argsRaw
      if ((node?.kind === 'tool-result' || node?.kind === 'tool') && name === CANVAS_TOOL_NAME && argsRaw !== undefined) {
        sources.push({ argsRaw, settled: true })
      }
    }
  }
  for (const call of session?.runningCalls ?? []) {
    if (call.name === CANVAS_TOOL_NAME && call.argsRaw !== undefined) sources.push({ argsRaw: call.argsRaw, settled: false })
  }
  for (const block of session?.partial?.blocks ?? []) {
    if (block.kind === 'tool-call' && block.name === CANVAS_TOOL_NAME && block.argsRaw !== undefined) {
      sources.push({ argsRaw: block.argsRaw, settled: false })
    }
  }
  return sources
}

/** Fold the scene off the snapshot: last parseable source wins (whole-scene
 * snapshots); an unsettled winner additionally yields a live preview op.
 * Exported for tests — this encodes the deployed snapshot contract. */
export function reconstructScene(session: CanvasSessionView | undefined): {
  ops: CanvasOp[]
  liveOps: number
  preview: CanvasOp | null
} {
  let ops: CanvasOp[] = []
  let liveWinner = false
  let trailingPartial: PartialOpView | null = null
  for (const source of collectSceneSources(session)) {
    const view = extractCanvasStreamArgs(source.argsRaw)
    if (view === null) continue
    ops = [...view.ops]
    liveWinner = !source.settled
    trailingPartial = liveWinner ? view.partial : null
  }
  return {
    ops,
    liveOps: liveWinner ? ops.length + (trailingPartial !== null ? 1 : 0) : 0,
    preview: liveWinner ? partialPreviewOp(trailingPartial) : null,
  }
}

/** Full props of the dock entry. */
export type CanvasDockProps = PropsRuntime<'conversation.input.dock'>
  & PropsLocale<'visualizer'>
  & {
    /** Host-computed projection reader (the tool-todo pattern). Optional in
     * this program because the vendored contract snapshot predates the
     * projection seam; the deployed framework always supplies it here. */
    useProjection?: <T = unknown>(key: string) => T
  }

type Translate = CanvasDockProps['t']

/** Op → prepared stroke, memo key: JSON identity (ops are small). */
function prepareScene(ops: readonly CanvasOp[], palette: CanvasPalette): { strokes: PreparedStroke[]; texts: CanvasOp[] } {
  const strokes: PreparedStroke[] = []
  const texts: CanvasOp[] = []
  for (const op of ops) {
    if (op.op === 'text') texts.push(op)
    else {
      const stroke = prepareStroke(op, palette)
      if (stroke !== null) strokes.push(stroke)
    }
  }
  return { strokes, texts }
}

/** Convert a client point to logical canvas space. */
function toLogical(canvas: HTMLCanvasElement, event: { clientX: number; clientY: number }): [number, number] {
  const rect = canvas.getBoundingClientRect()
  return [
    (event.clientX - rect.left) / rect.width * CANVAS_W,
    (event.clientY - rect.top) / rect.height * CANVAS_H,
  ]
}

/** Last-resort boundary: a crash inside the panel degrades to a collapsed
 * pill instead of silently removing the entry from the dock. */
class CanvasErrorBoundary extends Component<{ t: Translate; children: ReactNode }, { failed: boolean }> {
  override state = { failed: false }

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true }
  }

  override componentDidCatch(error: unknown): void {
    // Surface the fault: the pill alone gives no diagnosis.
    console.error('[dsh-visualizer] canvas panel crashed:', error)
  }

  override render(): ReactNode {
    if (this.state.failed) {
      return (
        <section className={css.popover} data-testid="canvas-popup-error">
          <div className={css.card}>
            <span className={css.title}>{this.props.t('canvas.title')}</span>
          </div>
        </section>
      )
    }
    return this.props.children
  }
}

/** The popup panel (wrapped in the crash boundary). */
export function CanvasPopup(props: CanvasDockProps & { session?: CanvasSessionView }) {
  return (
    <CanvasErrorBoundary t={props.t}>
      <CanvasPopupInner {...props} />
    </CanvasErrorBoundary>
  )
}

function CanvasPopupInner({ t, inputActions, session, useProjection }: CanvasDockProps & { session?: CanvasSessionView }) {
  const open = useSyncExternalStore(subscribeUi, () => uiState.open)
  const userOps = useSyncExternalStore(subscribeUi, () => uiState.userOps)
  const note = useSyncExternalStore(subscribeUi, () => uiState.note)
  // Durable scene off the host-folded 'canvas' projection (whole-scene,
  // survives turn boundaries). useProjection is a HOOK supplied by the host
  // (TodoDock pattern): it MUST be called directly in the body on every
  // render — wrapping it in useMemo/try-catch skips its internal hooks on
  // cached re-renders and crashes React with a hook-order mismatch.
  const readProjection = useProjection ?? (() => undefined)
  const projected = readProjection('canvas') as CanvasOp[] | null | undefined
  // Folded fresh from each re-render's session snapshot. The projection is
  // authoritative when live (it folds the durable whole-scene events);
  // per-call args carry only each call's incremental ops and would otherwise
  // replace the visible scene on every new call. The args scan stays as
  // fallback for assemblies without the seam and feeds the live streaming
  // preview either way.
  const sceneCacheOpsRef = useRef<CanvasOp[] | null>(null)
  const sceneCacheRef = useRef('')
  const { ops: scene, liveCount, preview } = useMemo(() => {
    const folded = reconstructScene(session)
    const ops = Array.isArray(projected) ? [...projected] : folded.ops
    // Identity-stable scene: unrelated session ticks must not restart the
    // reveal animation. Reuse the previous array while content is unchanged.
    const signature = JSON.stringify(ops)
    if (signature === sceneCacheRef.current && sceneCacheOpsRef.current !== null) {
      return { ops: sceneCacheOpsRef.current, liveCount: folded.liveOps, preview: folded.preview }
    }
    sceneCacheRef.current = signature
    sceneCacheOpsRef.current = ops
    return { ops, liveCount: folded.liveOps, preview: folded.preview }
  }, [session, projected])
  // Stroke-in-progress guards: some touch engines synthesize a click after a
  // captured stroke releases; it must never toggle the panel.
  const drawingRef = useRef(false)
  const lastDrawEndRef = useRef(0)

  const sceneRef = useRef<HTMLCanvasElement | null>(null)
  const overlayRef = useRef<HTMLCanvasElement | null>(null)
  const palette = useMemo(() => resolvePalette(), [])

  // ---- Agent scene painting with reveal animation ----
  useEffect(() => {
    const canvas = sceneRef.current
    if (canvas === null || !open) return
    const ctx = setupCanvas(canvas)
    if (ctx === null) return
    const drawable = preview !== null ? [...scene, preview] : scene
    const { strokes, texts } = prepareScene(drawable, palette)
    // Reveal schedule: ~SPEED px per second of path length (doodle prototype).
    const SPEED = 900
    let cursor = 0
    const starts = strokes.map((stroke) => {
      const start = cursor
      cursor += Math.max(0.12, stroke.length / SPEED)
      return start
    })
    const endTime = cursor + 0.2
    const start = performance.now()
    let raf = 0
    const frame = (now: number): void => {
      const elapsed = (now - start) / 1000
      ctx.clearRect(0, 0, CANVAS_W, CANVAS_H)
      for (let i = 0; i < strokes.length; i++) {
        const stroke = strokes[i]
        const at = starts[i]
        if (at === undefined) continue
        const frac = Math.min(1, Math.max(0, (elapsed - at) / Math.max(0.12, stroke.length / SPEED)))
        paintStroke(ctx, stroke, frac)
      }
      if (elapsed > endTime * 0.55) {
        for (const op of texts) {
          if (op.op === 'text') paintText(ctx, op, palette)
        }
      }
      if (elapsed < endTime + 0.3) raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => { cancelAnimationFrame(raf) }
  }, [scene, preview, open, palette])

  // ---- User overlay painting (immediate; freehand pointer capture) ----
  useEffect(() => {
    const canvas = overlayRef.current
    if (canvas === null || !open) return
    const ctx = setupCanvas(canvas)
    if (ctx === null) return
    ctx.strokeStyle = USER_INK
    ctx.lineWidth = USER_PEN_WIDTH
    // Repaint accumulated user ops (kept as flat polylines).
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H)
    for (const op of userOps) {
      if (op.op === 'stroke') paintStroke(ctx, { color: USER_INK, width: USER_PEN_WIDTH, points: op.points, length: 0 } as PreparedStroke & { length: number }, 1)
    }
    let active: number[] | null = null
    const pos = (event: PointerEvent): [number, number] => toLogical(canvas, event)
    const onDown = (event: PointerEvent): void => {
      event.preventDefault()
      drawingRef.current = true
      // jsdom and some engines lack pointer capture; drawing must not depend on it.
      try { canvas.setPointerCapture(event.pointerId) } catch { /* unsupported */ }
      active = pos(event)
      ctx.beginPath()
      ctx.moveTo(active[0], active[1])
    }
    const onMove = (event: PointerEvent): void => {
      if (active === null) return
      const [x, y] = pos(event)
      active.push(x, y)
      ctx.lineTo(x, y)
      ctx.stroke()
    }
    const onUp = (): void => {
      if (active !== null && active.length >= 4) {
        setUiState({ userOps: [...uiState.userOps, { op: 'stroke', color: 'accentWarm', width: USER_PEN_WIDTH, points: active as number[] }] })
      }
      active = null
      drawingRef.current = false
      lastDrawEndRef.current = performance.now()
    }
    canvas.addEventListener('pointerdown', onDown)
    canvas.addEventListener('pointermove', onMove)
    canvas.addEventListener('pointerup', onUp)
    canvas.addEventListener('pointercancel', onUp)
    return () => {
      canvas.removeEventListener('pointerdown', onDown)
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('pointerup', onUp)
      canvas.removeEventListener('pointercancel', onUp)
    }
    // userOps deliberately NOT a dependency: the listeners run once per
    // open; committed strokes repaint through the state change below.
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  // Repaint the overlay whenever userOps changes (commit + clear).
  useEffect(() => {
    const canvas = overlayRef.current
    if (canvas === null || !open) return
    const ctx = setupCanvas(canvas)
    if (ctx === null) return
    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H)
    ctx.strokeStyle = USER_INK
    ctx.lineWidth = USER_PEN_WIDTH
    for (const op of userOps) {
      if (op.op === 'stroke') {
        ctx.beginPath()
        ctx.moveTo(op.points[0], op.points[1])
        for (let i = 2; i < op.points.length; i += 2) ctx.lineTo(op.points[i], op.points[i + 1])
        ctx.stroke()
      }
    }
  }, [userOps, open])

  const onSend = useCallback((): void => {
    const prompt = canvasPromptText(userOps, note)
    if (prompt.length > MAX_PROMPT_CHARS) return
    if (userOps.length === 0 && note.trim().length === 0) return
    inputActions.setDraft(prompt.slice(0, MAX_PROMPT_CHARS))
    inputActions.submit()
    setUiState({ userOps: [], note: '' })
  }, [userOps, note, inputActions])

  const summary = liveCount > 0 ? t('canvas.drawing') : `${scene.length} op(s)`
  return (
    <section className={css.popover} data-testid="canvas-popup" aria-label={t('canvas.title')}>
      {/* stopPropagation: drawing pointers must not reach any ancestor gesture
          logic (scrollports, outside-dismiss surfaces) as gesture starts. */}
      <div className={css.card} onPointerDown={event => event.stopPropagation()}>
        <button
          type="button"
          className={css.header}
          aria-expanded={open}
          onClick={() => {
            // Ignore toggles during a stroke or just after one: released
            // touches may synthesize a header click on some engines.
            if (drawingRef.current || performance.now() - lastDrawEndRef.current < 400) return
            setUiState({ open: !uiState.open })
          }}
        >
          <span className={css.lead} aria-hidden><IconEditOutline16 size={14} /></span>
          <span className={css.title}>{t('canvas.title')}</span>
          {liveCount > 0 && <span className={css.liveDot} aria-hidden />}
          <span className={css.summary}>{summary}</span>
          <span className={css.chevron} aria-hidden>
            {open ? <IconChevronDownOutline14 /> : <IconChevronUpOutline14 />}
          </span>
        </button>
        {open && (
          <>
            <div className={css.surface}>
              <canvas ref={sceneRef} className={css.layer} aria-label={t('canvas.scene')} />
              <canvas ref={overlayRef} className={`${css.layer} ${css.overlay}`} aria-label={t('canvas.overlay')} />
            </div>
            <div className={css.toolRow}>
              <button type="button" className={css.toolBtn} onClick={() => { setUiState({ userOps: [] }) }}>{t('canvas.clearMine')}</button>
            </div>
            <div className={css.sendRow}>
              <textarea
                className={css.note}
                placeholder={t('canvas.notePlaceholder')}
                value={note}
                maxLength={CANVAS_NOTE_MAX_CHARS}
                rows={1}
                onChange={(event) => { setUiState({ note: event.target.value }) }}
              />
              <button
                type="button"
                className={css.sendBtn}
                disabled={userOps.length === 0 && note.trim().length === 0}
                onClick={onSend}
              >
                <IconSendOutline16 size={14} />
                {t('canvas.send')}
              </button>
            </div>
          </>
        )}
      </div>
    </section>
  )
}

/** Marker prefix the locale Send uses; re-exported for tests. */
export { CANVAS_PROMPT_PREFIX }

/**
 * The canvas popup as a plain registrant plugin (QueueDock posture), ordered
 * after the todo entry.
 */
export const canvasDockEntry = {
  name: 'visualizer-canvas-dock',
  inject: ['slots'],
  apply(ctx: Context): void {
    ctx.slots.inject('conversation.input.dock', () =>
      ctx.slots.register({ name: 'conversation.input.dock', id: 'visualizer-canvas', order: 1, locale: NS }, CanvasPopup))
  },
}
