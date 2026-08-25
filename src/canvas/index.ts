/**
 * Host half of the interactive canvas: the `canvas_draw` tool plus the
 * system-prompt guidance. A call appends one `canvas/draw` session event —
 * the durable, replay-safe home of the scene — and the settle-time result
 * tells the model what the canvas now holds. A `clear` argument empties the
 * scene instead of adding ops.
 *
 * @module dsh-visualizer/canvas
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { z as zod } from 'zod'
import type { ZodType } from 'zod'
import { defineTool } from '@deepseek-ai/dsh-tools'
// Type-side-effect import: pulls the systemPrompt Context augmentation.
import type {} from '@deepseek-ai/dsh-system-prompt'
// Type-side-effect imports: the SessionEventMap augmentation target and the
// ctx.sessionProjections member + SessionProjectionMap merge target. The
// projection package is types-only here; the host supplies the service.
import type {} from '@deepseek-ai/dsh-session-projection'
import type {} from '@deepseek-ai/dsh-session'
import {
  CANVAS_COLORS, CANVAS_H, CANVAS_W,
} from './types.ts'
import type { CanvasDrawResult, CanvasOp } from './types.ts'
import { normalizeCanvasOps } from './normalize.ts'
import { validateCanvasOps } from './validate.ts'

/** Most per-call skip reasons reported to the model; the rest collapse. */
const MAX_REPORTED_SKIPS = 4
/** Scene size cap; overflow is trimmed oldest-first, never hard-failed. */
const MAX_SCENE_OPS = 512

/**
 * Authoritative per-session running scene, kept in the plugin process.
 * `exec.agent.session.events` is NOT a reliable prior: some assemblies scope
 * it to the current turn (older calls invisible → each call replaced the
 * scene instead of extending it), and folding every event would double-count
 * anyway since each event carries the WHOLE accumulated scene. The cache is
 * primary; the last event's whole-scene ops are only a restart recovery.
 */
const sceneCache = new Map<string, CanvasOp[]>()
const SCENE_CACHE_MAX = 64
/** Last scene this process touched, whatever the session key. Covers
 * assemblies whose per-call `session.id` is unstable (every call would
 * otherwise miss the keyed cache and fall back to turn-scoped events —
 * i.e. an empty prior that REPLACES the scene). Single-canvas toy: the MRU
 * scene is the right guess across key churn; a real clear still resets it. */
let lastSceneTouched: CanvasOp[] | null = null

/** Test isolation only: wipes the process-scene state (real deployments
 * keep it for the process lifetime). */
export function resetCanvasSceneCache(): void {
  sceneCache.clear()
  lastSceneTouched = null
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Whole-scene snapshot; latest write wins on replay. Log-only UI state. */
    'canvas/draw': { ops: CanvasOp[] }
  }
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    canvas: CanvasOp[] | null
  }
  interface SessionProjectionMap {
    /**
     * The whole current canvas scene (the latest `canvas/draw` snapshot), or
     * `null` before the first write. Whole-value rule: every event carries
     * the complete replacement scene, so the fold is last-wins and survives
     * turn boundaries — the sketch persists across turns by design.
     */
    canvas: CanvasOp[] | null
  }
}

/** Wire/state schema of the `canvas` projection (loose on purpose: ops were
 * already validated at tool-write time; the fold only re-ships them). */
const canvasProjectionSchema = zod.union([
  zod.array(zod.looseObject({ op: zod.string(), color: zod.string() })),
  zod.null(),
]) as ZodType<CanvasOp[] | null>

/**
 * Build the `canvas` projection unit: last whole-scene snapshot wins, and the
 * state persists across turn boundaries (a sketch outlives the turn that
 * drew it). Exported so tests exercise the pure fold without a host.
 * @returns the projection definition for `sessionProjections.register`.
 */
export function canvasProjectionDefinition(): {
  key: 'canvas'
  schema: ZodType<CanvasOp[] | null>
  init: () => CanvasOp[] | null
  apply: (state: CanvasOp[] | null, event: { type: string; data?: unknown }) => CanvasOp[] | null
  view: (state: CanvasOp[] | null) => CanvasOp[] | null
  stateVersion: number
} {
  return {
    key: 'canvas',
    schema: canvasProjectionSchema,
    init: () => null,
    apply: (state, event) => {
      if (event.type !== 'canvas/draw') return state
      return (event.data as { ops: CanvasOp[] }).ops
    },
    view: state => state,
    stateVersion: 1,
  }
}

export const name = 'visualizer-canvas'
export const inject = ['tools', 'systemPrompt']

const OP_ITEMS = {
  type: 'object',
  additionalProperties: false,
  properties: {
    op: { type: 'string', required: true, enum: ['stroke', 'rect', 'ellipse', 'line', 'arrow', 'text'], description: 'stroke | rect | ellipse | line | arrow | text' },
    color: { type: 'string', required: true, enum: [...CANVAS_COLORS], description: `Palette id: ${CANVAS_COLORS.join(' | ')}.` },
    width: { type: 'number', description: `Stroke width in logical px (0.5–40); default 3.` },
    points: { type: 'array', items: { type: 'number' }, description: 'stroke: flat [x0,y0,x1,y1,...] polyline.' },
    bounds: { type: 'array', items: { type: 'number' }, description: 'rect/ellipse: [x,y,w,h]; line/arrow: [x0,y0,x1,y1].' },
    text: { type: 'string', description: 'text: the label.' },
    size: { type: 'number', description: 'text: font size in logical px; default 20.' },
    at: { type: 'array', items: { type: 'number' }, description: 'text: [x, y] anchor (left baseline).' },
  },
} as const

const GUIDE_TEXT = [
  '## Interactive canvas (canvas_draw)',
  `A shared sketch canvas with the user: you draw ops, the user can draw strokes and reply in the same popup. Logical space is ${CANVAS_W}x${CANVAS_H} (x right, y down); coordinates outside are clamped into it automatically.`,
  '',
  '**Style — hand-drawn doodles only.** This is a napkin-sketch pad shared with the user, not a diagram tool: think pencil on paper. Loose wobbly lines are the aesthetic, not a flaw:',
  '- Build shapes from 2–4 slightly-overlapping freehand strokes instead of one perfect rect/ellipse (a circle as two arcs that overshoot; a box as four lines whose corners don\'t quite meet).',
  '- Sketchy details win: hatching for shading, short dashes for texture, a rough ground line under objects.',
  '- Avoid text ops except tiny handwritten-style labels; never use the canvas for charts, layouts, or precise schematics.',
  '',
  '**Hard rules for every op object:**',
  '1. EVERY op object starts with its "op" field — one of stroke | rect | ellipse | line | arrow | text. Never omit it; never call it "type".',
  '2. width (and text size) are OPTIONAL plain numbers. Omit them unless needed; when sent they must be bare numbers like 3 or 2.5 — never strings, never 0. Valid width range is 0.5–40.',
  '3. color is one palette id: ' + CANVAS_COLORS.join(', ') + '.',
  '4. All values are flat numbers: points [x0,y0,x1,y1,...], bounds [x,y,w,h] or [x0,y0,x1,y1], at [x,y]. No nested pairs, no objects.',
  '',
  '**Field shapes:**',
  '- {"op":"stroke", "color":"ink", "width":3, "points":[x0,y0,x1,y1,...]}',
  '- {"op":"rect", "color":"ink", "width":2.5, "bounds":[x,y,w,h]}   ·   {"op":"ellipse", ... same}',
  '- {"op":"line", "color":"ink", "bounds":[x0,y0,x1,y1]}   ·   {"op":"arrow", ... same}',
  '- {"op":"text", "color":"ink", "text":"label", "size":20, "at":[x,y]}   ·   size optional, default 20',
  '',
  '**Batching:** the canvas PERSISTS — every shape you sent in earlier calls is still there. Each call must contain ONLY genuinely new shapes; resending old ones just wastes budget (they are ignored as duplicates). Send at most ~8 ops per call and wait for the result. If a result lists skipped ops, resend ONLY corrected versions of those — do not redraw everything. Draw incrementally: coarse shapes first, refine after looking at the result counts and user feedback.',
  `The user may sketch on the canvas and press Send; their strokes arrive as a [canvas] user message with flat [x,y,...] polylines in the same logical space, possibly with a note. Interpret them and keep drawing. Use clear:true (with ops:[]) to restart the scene — ask first when the user drew something.`,
].join('\n')

/** Alias so the parent package can re-export the canvas plugin's apply. */
export const applyCanvas = apply

/** Model-visible result text: counts first, then the skip reasons so the
 * next call fixes exactly those ops instead of redrawing the batch. */
function renderCanvasResult(value: CanvasDrawResult): string {
  let text = `Canvas now holds ${value.ops} op(s); this call added ${value.added}.`
  if (value.skipped !== undefined && value.skipped.length > 0) {
    const total = value.skippedCount ?? value.skipped.length
    const lines = [...value.skipped]
    if (total > lines.length) lines.push(`…and ${total - lines.length} more`)
    text += `\nSkipped (fix these and resend only them):\n- ${lines.join('\n- ')}`
  }
  if (value.duplicates !== undefined && value.duplicates > 0) {
    text += `\n${value.duplicates} duplicate shape(s) ignored — the canvas already keeps everything from earlier calls, so each call should contain ONLY new shapes.`
  }
  if (value.trimmed !== undefined && value.trimmed > 0) {
    text += `\n${value.trimmed} oldest op(s) were trimmed to stay within the ${MAX_SCENE_OPS}-op canvas; start a fresh drawing with clear:true when the picture is done.`
  }
  if (value.priorSource !== undefined) {
    text += `\n(scene ${value.priorSource === 'empty' ? 'started fresh' : `continued from ${value.priorCount ?? '?'} op(s) via ${value.priorSource}`})`
  }
  return text
}

/**
 * Register the `canvas_draw` tool and its prompt section.
 * @param ctx - Cordis context carrying the registries.
 */
export function apply(ctx: Context): void {
  // Standing-plan fold (tool-todo pattern): the durable scene lives in the
  // logged `canvas/draw` events; this unit projects the latest whole-scene
  // snapshot to every client via useProjection('canvas'). Inject keeps
  // headless assemblies without the seam unaffected.
  ctx.inject(['sessionProjections'], (projectionCtx) => {
    projectionCtx.sessionProjections.register(canvasProjectionDefinition())
  })

  ctx.systemPrompt.section({ name: 'tool:visualizer-canvas', order: 110, text: GUIDE_TEXT })

  ctx.tools.register(defineTool({
    name: 'canvas_draw',
    description: 'Draw on the shared interactive canvas the user sees in a popup. '
      + 'The canvas is a HAND-DRAWN DOODLE SKETCHPAD: loose, imperfect, pen-on-paper style — never diagrams, charts, or pixel-perfect geometry. '
      + 'Build shapes from a few overlapping freehand strokes (like a pencil sketch), keep lines slightly wobbly, and prefer strokes over text; if you label anything, keep it tiny and handwritten-feeling. '
      + 'Call repeatedly to build the sketch incrementally: each call\'s ops append to the scene and stream to the canvas as you write. '
      + `Coordinates are in a ${CANVAS_W}x${CANVAS_H} logical space. `
      + 'The user can draw strokes over yours and send them back as a [canvas] message — react to their sketch in the same space.',
    parameters: {
      ops: {
        type: 'array',
        required: true,
        description: 'Ops to append (≤64 per call). Pass [] with clear:true to empty the canvas.',
        items: OP_ITEMS,
      },
      clear: {
        type: 'boolean',
        description: 'Clear the scene before applying ops (pass ops:[] for a bare reset).',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ops: { type: 'number', required: true },
          added: { type: 'number', required: true },
          skippedCount: { type: 'number' },
          skipped: { type: 'array', items: { type: 'string' } },
          duplicates: { type: 'number' },
          trimmed: { type: 'number' },
          priorSource: { type: 'string' },
          priorCount: { type: 'number' },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: renderCanvasResult(value as CanvasDrawResult),
      }],
    },
    execute(args, exec): Promise<CanvasDrawResult> {
      const clear = args.clear === true
      // A non-agent caller has no owning canvas and is rejected (todo_write
      // semantics).
      if (!exec.agent) throw new Error('canvas_draw requires an owning agent session')
      const rawId: unknown = (exec.agent.session as { id?: unknown }).id
      const sid = rawId === undefined || rawId === null ? '∅' : String(rawId)
      let prior = sceneCache.get(sid)
      let priorSource: 'cache' | 'events' | 'mru' | 'empty' = prior !== undefined ? 'cache' : 'empty'
      if (prior === undefined && !clear) {
        // Recovery tier 1: the newest canvas/draw event IS the whole scene.
        for (const event of exec.agent.session.events) {
          if (event.type !== 'canvas/draw') continue
          const ops = (event.data as { ops?: unknown }).ops
          if (Array.isArray(ops)) {
            prior = ops as CanvasOp[]
            priorSource = 'events'
          }
        }
        // Recovery tier 2: turn-scoped assemblies expose no older events;
        // the process-wide MRU scene is the only remaining witness.
        if (prior === undefined && lastSceneTouched !== null) {
          prior = lastSceneTouched
          priorSource = 'mru'
        }
      }
      const priorOps = Array.isArray(prior) ? [...prior] : []
      const norm = normalizeCanvasOps(args.ops)
      const added = args.clear === true && (!Array.isArray(args.ops) || args.ops.length === 0)
        ? []
        : validateCanvasOps(norm.ops, priorOps)
      // Models 'add details' by resending shapes from earlier calls; exact
      // duplicates add nothing visually (same pixels) but inflate the scene
      // toward its cap — suppress them instead of failing the call.
      const signatureOf = (op: CanvasOp): string => JSON.stringify(op)
      let duplicates = 0
      let merged: CanvasOp[]
      if (clear) {
        const seen = new Set<string>()
        merged = []
        for (const op of added) {
          const signature = signatureOf(op)
          if (seen.has(signature)) {
            duplicates++
            continue
          }
          seen.add(signature)
          merged.push(op)
        }
      } else {
        const seen = new Set<string>(priorOps.map(signatureOf))
        const fresh: CanvasOp[] = []
        for (const op of added) {
          const signature = signatureOf(op)
          if (seen.has(signature)) {
            duplicates++
            continue
          }
          seen.add(signature)
          fresh.push(op)
        }
        merged = [...priorOps, ...fresh]
      }
      // Recency-biased cap: never hard-fail a draw for size; trim the oldest
      // overflow and say so. The model keeps drawing; the user keeps seeing.
      let trimmed = 0
      if (merged.length > MAX_SCENE_OPS) {
        trimmed = merged.length - MAX_SCENE_OPS
      }
      const next = trimmed > 0 ? merged.slice(trimmed) : merged
      exec.agent.session.append('canvas/draw', { ops: next })
      sceneCache.set(sid, next)
      lastSceneTouched = [...next]
      if (sceneCache.size > SCENE_CACHE_MAX) {
        const oldest = sceneCache.keys().next().value
        if (oldest !== undefined) sceneCache.delete(oldest)
      }
      return Promise.resolve({
        ops: next.length,
        added: added.length - duplicates,
        ...(duplicates > 0 ? { duplicates } : {}),
        ...(trimmed > 0 ? { trimmed } : {}),
        priorSource,
        priorCount: priorOps.length,
        ...(norm.notes.length > 0
          ? {
              skippedCount: norm.notes.length,
              skipped: norm.notes.slice(0, MAX_REPORTED_SKIPS).map(note => `ops[${note.index}] ${note.reason}`),
            }
          : {}),
      })
    },
    presentCall: args => ({ card: 'generic', title: 'Draw on canvas', kind: 'other', rawInput: args.ops }),
  }))
}
