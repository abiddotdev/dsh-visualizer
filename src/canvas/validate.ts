/**
 * Validation of one canvas_draw call's ops: the rules the host tool enforces
 * and the client shares. Pure — no imports — so both planes use the one copy.
 *
 * @module dsh-visualizer/canvas/validate
 */

import {
  CANVAS_COLORS, CANVAS_H, CANVAS_W,
} from './types.ts'
import type { CanvasOp } from './types.ts'

/** Most points one stroke may carry. */
const MAX_STROKE_POINTS = 512
/** Widest/narrowest stroke the canvas accepts, logical px. */
const MIN_STROKE_WIDTH = 0.5
const MAX_STROKE_WIDTH = 40
/** Longest one text op may be. */
const MAX_TEXT_CHARS = 240
/** Largest text size, logical px. */
const MAX_TEXT_SIZE = 96
/** Most ops one call may add. */
const MAX_OPS_PER_CALL = 64

const COLOR_SET = new Set<string>(CANVAS_COLORS)

/**
 * Validate one op in isolation.
 * @param op - the candidate op.
 * @throws Error naming the first violated rule.
 */
function validateOp(op: CanvasOp): void {
  if (typeof op !== 'object' || op === null) throw new Error('invalid canvas op: expected an object')
  if (typeof op.color !== 'string' || !COLOR_SET.has(op.color)) {
    throw new Error(`invalid canvas op: unknown color ${JSON.stringify(String(op.color))}; known colors: ${CANVAS_COLORS.join(', ')}`)
  }
  const width = (op as { width?: unknown }).width
  if (width !== undefined && (typeof width !== 'number' || !Number.isFinite(width) || width < MIN_STROKE_WIDTH || width > MAX_STROKE_WIDTH)) {
    throw new Error(`invalid canvas op: width must be a number between ${MIN_STROKE_WIDTH} and ${MAX_STROKE_WIDTH}`)
  }
  if (op.op === 'stroke') {
    const points = (op as { points?: unknown }).points
    if (!Array.isArray(points) || points.length < 4 || points.length > MAX_STROKE_POINTS || points.length % 2 !== 0) {
      throw new Error(`invalid stroke: points must be a flat even [x,y,...] array of 4–${MAX_STROKE_POINTS} numbers`)
    }
    if (typeof width !== 'number') throw new Error('invalid stroke: width must be a number')
    checkFinite('stroke points', points as number[])
    return
  }
  if (op.op === 'rect' || op.op === 'ellipse' || op.op === 'line' || op.op === 'arrow') {
    const bounds = (op as { bounds?: unknown }).bounds
    if (!Array.isArray(bounds) || bounds.length !== 4) {
      throw new Error(`invalid ${op.op}: bounds must be an [x,y,w,h]/[x0,y0,x1,y1] array of 4 numbers`)
    }
    if (typeof width !== 'number') throw new Error(`invalid ${op.op}: width must be a number`)
    checkFinite(`${op.op} bounds`, bounds as number[])
    return
  }
  if (op.op === 'text') {
    const text = (op as { text?: unknown }).text
    if (typeof text !== 'string' || text.trim().length === 0 || text.length > MAX_TEXT_CHARS) {
      throw new Error(`invalid text: a non-empty string of at most ${MAX_TEXT_CHARS} chars`)
    }
    const size = (op as { size?: unknown }).size
    if (typeof size !== 'number' || !Number.isFinite(size) || size <= 0 || size > MAX_TEXT_SIZE) {
      throw new Error(`invalid text: size must be a number in (0, ${MAX_TEXT_SIZE}]`)
    }
    const at = (op as { at?: unknown }).at
    if (!Array.isArray(at) || at.length !== 2) throw new Error('invalid text: at must be [x, y]')
    checkFinite('text at', at as number[])
    return
  }
  throw new Error(`invalid canvas op: unknown op ${JSON.stringify(String((op as { op?: unknown }).op))}`)
}

/**
 * Every number in the array is finite (NaN/Infinity cannot ride the wire).
 * @param label - field name for the error message.
 * @param values - candidate numbers.
 */
function checkFinite(label: string, values: readonly number[]): void {
  for (const value of values) {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new Error(`invalid ${label}: every entry must be a finite number`)
    }
  }
}

/**
 * Normalize model-supplied ops (cross-origin raw objects) into validated
 * CanvasOps; coordinates are clamped into the logical canvas.
 * @param raw - the call's `ops` argument.
 * @param currentOps - ops already in the scene.
 * @returns the validated ops to append.
 * @throws Error on the first violated rule.
 */
export function validateCanvasOps(raw: unknown, currentOps: readonly CanvasOp[]): readonly CanvasOp[] {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error('ops must be a non-empty array of canvas operations')
  }
  if (raw.length > MAX_OPS_PER_CALL) {
    throw new Error(`a call may add at most ${MAX_OPS_PER_CALL} ops (got ${raw.length}); split across calls`)
  }
  if (currentOps.length + raw.length > 512) {
    throw new Error('the canvas scene is full (512 ops); call canvas_draw with clear first')
  }
  const ops: CanvasOp[] = []
  for (const candidate of raw) {
    if (candidate === null || typeof candidate !== 'object') throw new Error('invalid canvas op: expected an object')
    const op = candidate as Record<string, unknown>
    if (op.op === 'clear') throw new Error('clear is a tool argument, not an op')
    validateOp(candidate as unknown as CanvasOp)
    ops.push(normalizeOp(candidate as unknown as CanvasOp))
  }
  return ops
}

const clamp = (value: number): number => Math.min(CANVAS_W, Math.max(0, value))
const clampY = (value: number): number => Math.min(CANVAS_H, Math.max(0, value))

/** Clamp one validated op's coordinates into the logical canvas. */
function normalizeOp(op: CanvasOp): CanvasOp {
  switch (op.op) {
    case 'stroke':
      return { op: 'stroke', color: op.color, width: op.width, points: op.points.map((v, i) => (i % 2 === 0 ? clamp(v) : clampY(v))) }
    case 'text':
      return { op: 'text', text: op.text, color: op.color, size: op.size, at: [clamp(op.at[0]), clampY(op.at[1])] }
    default:
      return { ...op, bounds: op.bounds.map((v, i) => (i % 2 === 0 ? clamp(v) : clampY(v))) }
  }
}
