/**
 * Tolerant pre-validation for model-authored canvas ops. Models fail at the
 * edges in predictable ways: `type` instead of `op`, a missing discriminator
 * on an otherwise obvious shape, numeric widths as strings, one malformed op
 * inside an otherwise good batch. Strict rejection wastes the whole call;
 * this pass coerces what is unambiguous, infers the rest, and reports what
 * it had to drop so the model can fix exactly those ops next call.
 *
 * Pure module: no host imports (same discipline as validate.ts).
 *
 * @module dsh-visualizer/canvas/normalize
 */

import { CANVAS_COLORS } from './types.ts'
import type { CanvasOp } from './types.ts'

/** One dropped raw op: its batch index and why. */
export interface NormalizationNote {
  readonly index: number
  readonly reason: string
}

const NUMERIC = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/

/** Accept bare numbers and numeric strings ("2.5"); reject anything else. */
function num(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string' && NUMERIC.test(value.trim())) return Number(value.trim())
  return null
}

/** Parse a flat numeric array; numeric strings allowed; null on any miss. */
function nums(value: unknown): number[] | null {
  if (!Array.isArray(value)) return null
  const out: number[] = []
  for (const item of value) {
    const parsed = num(item)
    if (parsed === null) return null
    out.push(parsed)
  }
  return out
}

const MIN_WIDTH = 0.5
const MAX_WIDTH = 40
const MAX_SIZE = 96
const PALETTE = new Set<string>(CANVAS_COLORS)
const clampWidth = (value: number): number => Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, value))
const clampSize = (value: number): number => Math.min(MAX_SIZE, Math.max(1, value))

/**
 * Normalize one raw op: alias/infer the discriminator, coerce numeric
 * strings, clamp width/size into range, default the color.
 * @returns the canonical op, or why the op was dropped.
 */
export function normalizeCanvasOp(raw: unknown): { op: CanvasOp } | { reason: string } {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return { reason: 'not an object' }
  const rec = { ...(raw as Record<string, unknown>) }

  // Discriminator: accept `type` as an alias of `op`; infer from fields when
  // both are absent (points → stroke, text+at → text, bounds → rect).
  let kind = typeof rec.op === 'string' ? rec.op : typeof rec.type === 'string' ? rec.type : undefined
  delete rec.type
  const hasPoints = Array.isArray(rec.points)
  const hasText = typeof rec.text === 'string'
  if (kind === undefined) {
    if (hasPoints) kind = 'stroke'
    else if (hasText && Array.isArray(rec.at)) kind = 'text'
    else if (Array.isArray(rec.bounds)) kind = 'rect'
    else return { reason: 'missing "op" and no recognizable shape fields (points/bounds/text)' }
  }

  // Palette ids only; anything else falls back to ink (the validator's
  // strictness is preserved one layer down — this pass just picks a value).
  const color = (typeof rec.color === 'string' && PALETTE.has(rec.color) ? rec.color : 'ink') as CanvasOp['color']
  const widthValue = num(rec.width)
  const width = widthValue === null ? undefined : clampWidth(widthValue)

  switch (kind) {
    case 'stroke': {
      const points = nums(rec.points)
      if (points === null || points.length < 4 || points.length % 2 !== 0) {
        return { reason: 'stroke needs points as a flat [x,y,...] array with an even length ≥ 4' }
      }
      return { op: { op: 'stroke', color, ...(width !== undefined ? { width } : {}), points } as CanvasOp }
    }
    case 'rect':
    case 'ellipse':
    case 'line':
    case 'arrow': {
      const bounds = nums(rec.bounds)
      if (bounds === null || bounds.length !== 4) {
        return { reason: `${kind} needs bounds as [x,y,w,h] (or [x0,y0,x1,y1] for ${kind}) — 4 numbers` }
      }
      return { op: { op: kind, color, ...(width !== undefined ? { width } : {}), bounds } as CanvasOp }
    }
    case 'text': {
      const label = hasText ? (rec.text as string) : ''
      if (label.trim().length === 0) return { reason: 'text needs a non-empty "text" string and at:[x,y]' }
      const at = nums(rec.at)
      if (at === null || at.length !== 2) return { reason: 'text needs at as [x, y] — 2 numbers' }
      const sizeValue = num(rec.size)
      const size = sizeValue === null ? undefined : clampSize(sizeValue)
      return { op: { op: 'text', color, text: label.slice(0, 240), ...(size !== undefined ? { size } : {}), at: [at[0], at[1]] } as CanvasOp }
    }
    default:
      return { reason: `unknown op "${String(kind)}" (use stroke | rect | ellipse | line | arrow | text)` }
  }
}

export interface NormalizedOps {
  /** Canonical ops that survived normalization, in batch order. */
  readonly ops: CanvasOp[]
  /** Dropped raw ops with their original indices. */
  readonly notes: readonly NormalizationNote[]
}

/**
 * Normalize a whole `ops` argument. Never throws for per-op problems — bad
 * ops become notes; only a non-array argument throws (the caller handles it).
 */
export function normalizeCanvasOps(raw: unknown): NormalizedOps {
  if (!Array.isArray(raw)) throw new Error('invalid arguments: ops must be an array')
  const ops: CanvasOp[] = []
  const notes: NormalizationNote[] = []
  let index = 0
  for (const item of raw) {
    const result = normalizeCanvasOp(item)
    if ('op' in result) ops.push(result.op)
    else notes.push({ index, reason: result.reason })
    index++
  }
  return { ops, notes }
}
