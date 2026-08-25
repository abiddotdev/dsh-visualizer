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
import { defineTool } from '@deepseek-ai/dsh-tools'
// Type-side-effect import: pulls the systemPrompt Context augmentation.
import type {} from '@deepseek-ai/dsh-system-prompt'
// Type-side-effect import: the SessionEventMap augmentation target. Importing
// any value/type from the package root makes './types' resolvable for the
// module augmentation below.
import type {} from '@deepseek-ai/dsh-session'
import {
  CANVAS_COLORS, CANVAS_H, CANVAS_W,
} from './types.ts'
import type { CanvasDrawResult, CanvasOp } from './types.ts'
import { validateCanvasOps } from './validate.ts'

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    /** Whole-scene snapshot; latest write wins on replay. Log-only UI state. */
    'canvas/draw': { ops: CanvasOp[] }
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
  `A shared sketch canvas with the user: you draw ops, the user can draw strokes and reply in the same popup. Logical space is ${CANVAS_W}x${CANVAS_H} (x right, y down); coordinates outside are clamped. Draw incrementally — several small calls, coarse strokes first, refine after user feedback; the canvas shows each batch as it streams.`,
  'The user may sketch on the canvas and press Send; their strokes arrive as a [canvas] user message with flat [x,y,...] polylines in the same logical space, possibly with a note. Interpret them and keep drawing.',
  `Colors: ${CANVAS_COLORS.join(', ')}. Ops per call ≤ 64. Use clear:true to restart the scene (ask first when the user drew something).`,
  'Op field shapes: stroke → {op:"stroke", color, width, points:[x0,y0,x1,y1,...]} · rect/ellipse → {op, color, width, bounds:[x,y,w,h]} · line/arrow → {op, color, width, bounds:[x0,y0,x1,y1]} (start point → end point) · text → {op:"text", color, text, size, at:[x,y]}. width and size are optional (defaults 3 / 20); every value is a bare number, never a nested pair or string.',
].join('\n')

/** Alias so the parent package can re-export the canvas plugin's apply. */
export const applyCanvas = apply

/**
 * Register the `canvas_draw` tool and its prompt section.
 * @param ctx - Cordis context carrying the registries.
 */
export function apply(ctx: Context): void {
  ctx.systemPrompt.section({ name: 'tool:visualizer-canvas', order: 110, text: GUIDE_TEXT })

  ctx.tools.register(defineTool({
    name: 'canvas_draw',
    description: 'Draw on the shared interactive canvas the user sees in a popup. '
      + 'Call repeatedly to build a sketch incrementally: each call\'s ops append to the scene and stream to the canvas as you write. '
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
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Canvas now holds ${(value as CanvasDrawResult).ops} op(s); this call added ${(value as CanvasDrawResult).added}.`,
      }],
    },
    execute(args, exec): Promise<CanvasDrawResult> {
      const clear = args.clear === true
      // The running scene is the executing agent's own session events; a
      // non-agent caller has no owning canvas and is rejected (todo_write
      // semantics).
      if (!exec.agent) throw new Error('canvas_draw requires an owning agent session')
      const prior: CanvasOp[] = []
      if (!clear) {
        for (const event of exec.agent.session.events) {
          if (event.type === 'canvas/draw') prior.push(...(event.data as { ops: CanvasOp[] }).ops)
        }
      }
      const added = args.clear === true && (!Array.isArray(args.ops) || args.ops.length === 0)
        ? []
        : validateCanvasOps(args.ops, prior)
      const next = clear ? [...added] : [...prior, ...added]
      exec.agent.session.append('canvas/draw', { ops: next })
      return Promise.resolve({ ops: next.length, added: added.length })
    },
    presentCall: args => ({ card: 'generic', title: 'Draw on canvas', kind: 'other', rawInput: args.ops }),
  }))
}
