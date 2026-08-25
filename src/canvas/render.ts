/**
 * Sketch renderer: paints CanvasOps onto a Canvas2D context in the logical
 * 1000×640 space, with an animated hand-drawn reveal (paper.js-style
 * dash-offset decay, ported from the doodle-sketch prototype as plain
 * Canvas2D so the popup needs no library). Pure module: no React, no state —
 * callers feed the canvas and ops.
 *
 * @module dsh-visualizer/canvas/render
 */

import { CANVAS_COLORS, CANVAS_H, CANVAS_W } from './types.ts'
import type { CanvasOp } from './types.ts'

/** Theme-token-resolved palette; ids from CANVAS_COLORS. */
export type CanvasPalette = Record<(typeof CANVAS_COLORS)[number], string>

/** Resolve palette ids against the page's current design tokens. */
export function resolvePalette(): CanvasPalette {
  const read = (names: readonly string[], fallback: string): string => {
    for (const name of names) {
      const value = getComputedStyle(document.body).getPropertyValue(name).trim()
      if (value.length > 0) return value
    }
    return fallback
  }
  return {
    ink: read(['--dsw-alias-label-primary'], '#4a4136'),
    inkSoft: read(['--dsw-alias-label-tertiary'], '#7a6b52'),
    accent: read(['--dsw-alias-accent-default'], '#7a8f6b'),
    accentWarm: '#c96f4a',
    // Faint construction-line grey — deliberately distinct from accent (the
    // old accent fallback made every "guide" stroke sage green).
    guide: read(['--dsw-alias-label-tertiary', '--dsw-alias-label-secondary'], '#b3a893'),
    white: '#ffffff',
    black: '#000000',
  }
}

/** A resampled point every N logical px, so dash length ≈ path length. */
const SAMPLE_STEP = 6

/** Resample a polyline into ~even segments (paper.js smooth() substitute:
 * quadratic midpoint smoothing happens in the path builder). */
export function smoothPath(points: readonly number[]): readonly number[] {
  if (points.length <= 4) return points
  // Quadratic midpoint smoothing: control = previous point, on-curve = midpoints.
  const out: number[] = [points[0], points[1]]
  for (let i = 2; i + 3 < points.length; i += 2) {
    const midX = (points[i] + points[i + 2]) / 2
    const midY = (points[i + 1] + points[i + 3]) / 2
    // Approximate the quadratic control segment by sampling the curve.
    const cx = points[i]
    const cy = points[i + 1]
    for (let s = 1; s <= 3; s++) {
      const t = s / 4
      const x = (1 - t) * (1 - t) * out[out.length - 2] + 2 * (1 - t) * t * cx + t * t * midX
      const y = (1 - t) * (1 - t) * out[out.length - 1] + 2 * (1 - t) * t * cy + t * t * midY
      out.push(x, y)
    }
    out.push(midX, midY)
  }
  out.push(points[points.length - 2], points[points.length - 1])
  return resample(out)
}

/** Resample to ~SAMPLE_STEP spacing so dash-offset animation stays even. */
function resample(points: readonly number[]): number[] {
  const out: number[] = [points[0], points[1]]
  let carry = 0
  for (let i = 2; i < points.length; i += 2) {
    const x0 = points[i - 2]
    const y0 = points[i - 1]
    const x1 = points[i]
    const y1 = points[i + 1]
    const dx = x1 - x0
    const dy = y1 - y0
    const len = Math.hypot(dx, dy)
    if (len === 0) continue
    let t = carry
    while (t < len) {
      out.push(x0 + dx * (t / len), y0 + dy * (t / len))
      t += SAMPLE_STEP
    }
    carry = t - len
  }
  out.push(points[points.length - 2], points[points.length - 1])
  return out
}

/** Deterministic tiny PRNG (mulberry32): the wobble must be identical on
 * every repaint or strokes visibly swim between frames. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** FNV-style hash of the first coordinates: same shape → same wobble. */
function seedFromPoints(points: readonly number[]): number {
  let hash = 2166136261
  const span = Math.min(points.length, 24)
  for (let i = 0; i < span; i++) {
    hash ^= Math.round(points[i] * 10) & 0xffff
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

const WOBBLE_AMPLITUDE = 2.2

/** Hand-drawn wobble: displace resampled points by small seeded offsets
 * (endpoints pinned so multi-stroke shapes still meet roughly). This plus
 * the double pencil pass is what turns plotter-perfect ops into doodles.
 */
export function sketchify(points: readonly number[], amplitude: number = WOBBLE_AMPLITUDE): number[] {
  if (points.length < 4 || amplitude <= 0) return [...points]
  const rand = mulberry32(seedFromPoints(points))
  const out: number[] = []
  for (let i = 0; i < points.length; i += 2) {
    out.push(
      points[i] + (rand() * 2 - 1) * amplitude,
      points[i + 1] + (rand() * 2 - 1) * amplitude,
    )
  }
  out[0] = points[0]
  out[1] = points[1]
  out[out.length - 2] = points[points.length - 2]
  out[out.length - 1] = points[points.length - 1]
  return out
}

/** Polyline length. */
export function pathLength(points: readonly number[]): number {
  let len = 0
  for (let i = 2; i < points.length; i += 2) {
    len += Math.hypot(points[i] - points[i - 2], points[i + 1] - points[i - 1])
  }
  return len
}

/** One prepared drawable: a resampled path plus its total length. */
export interface PreparedStroke {
  readonly color: string
  readonly width: number
  readonly points: readonly number[]
  readonly length: number
}

/** Shape expanded into a polyline (ellipse/rect/line/arrow). */
function shapePoints(op: Extract<CanvasOp, { bounds: readonly number[] }>): number[] {
  const [a, b, c, d] = op.bounds
  if (op.op === 'line' || op.op === 'arrow') {
    const pts = [a, b, c, d]
    if (op.op !== 'arrow') return resample(pts)
    // Arrow: shaft + head, as one polyline.
    const angle = Math.atan2(d - b, c - a)
    const head = Math.min(16, Math.hypot(c - a, d - b) / 3)
    const h1 = angle + Math.PI - 0.4
    const h2 = angle + Math.PI + 0.4
    return resample([
      a, b, c, d,
      c + head * Math.cos(h1), d + head * Math.sin(h1),
      c, d,
      c + head * Math.cos(h2), d + head * Math.sin(h2),
    ])
  }
  if (op.op === 'rect') {
    return resample([a, b, a + c, b, a + c, b + d, a, b + d, a, b])
  }
  // Ellipse: 64-segment polyline.
  const cx = a + c / 2
  const cy = b + d / 2
  const rx = Math.abs(c) / 2
  const ry = Math.abs(d) / 2
  const pts: number[] = []
  for (let i = 0; i <= 64; i++) {
    const t = (i / 64) * Math.PI * 2
    pts.push(cx + rx * Math.cos(t), cy + ry * Math.sin(t))
  }
  return resample(pts)
}

/**
 * Prepare one op into a drawable stroke (paths only; text is immediate).
 */
export function prepareStroke(op: CanvasOp, palette: CanvasPalette): PreparedStroke | null {
  const color = palette[op.color] ?? palette.ink
  if (op.op === 'stroke') {
    if (op.points.length < 4) return null
    const base = op.points.length > 4 ? smoothPath(op.points) : resample(op.points)
    const points = sketchify(base)
    return { color, width: op.width, points, length: pathLength(points) }
  }
  if (op.op === 'rect' || op.op === 'ellipse' || op.op === 'line' || op.op === 'arrow') {
    const points = sketchify(shapePoints(op), 3.2)
    return { color, width: op.width, points, length: pathLength(points) }
  }
  return null
}

/** Set up the canvas element's backing store for the logical space. */
export function setupCanvas(canvas: HTMLCanvasElement): CanvasRenderingContext2D | null {
  const rect = canvas.getBoundingClientRect()
  const dpr = window.devicePixelRatio || 1
  canvas.width = Math.max(1, Math.round(rect.width * dpr))
  canvas.height = Math.max(1, Math.round(rect.height * dpr))
  const ctx = canvas.getContext('2d')
  if (ctx === null) return null
  ctx.setTransform(canvas.width / CANVAS_W, 0, 0, canvas.height / CANVAS_H, 0, 0)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  return ctx
}

/**
 * Paint one prepared stroke at reveal fraction (1 = complete). Dash-array
 * reveal: dash [len, len] with offset len·(1−frac) — the paper.js trick.
 */
export function paintStroke(ctx: CanvasRenderingContext2D, stroke: PreparedStroke, frac: number, doublePass = true): void {
  if (frac <= 0) return
  const trace = (): void => {
    ctx.beginPath()
    ctx.moveTo(stroke.points[0], stroke.points[1])
    for (let i = 2; i < stroke.points.length; i += 2) {
      ctx.lineTo(stroke.points[i], stroke.points[i + 1])
    }
  }
  const dashFor = (): void => {
    if (frac >= 1) ctx.setLineDash([])
    else {
      ctx.setLineDash([stroke.length, stroke.length])
      ctx.lineDashOffset = stroke.length * (1 - frac)
    }
  }
  ctx.strokeStyle = stroke.color
  ctx.lineWidth = stroke.width
  dashFor()
  trace()
  ctx.stroke()
  ctx.setLineDash([])
  // Faint nudged second pass — pencil-overdraw texture. Freehand user ink
  // skips it (already hand-made).
  if (!doublePass || stroke.points.length < 4) return
  ctx.save()
  ctx.globalAlpha *= 0.38
  ctx.lineWidth = stroke.width * 0.7
  ctx.translate(1.1, -0.9)
  dashFor()
  trace()
  ctx.stroke()
  ctx.setLineDash([])
  ctx.restore()
}

/** Paint one text op (immediate; no reveal animation). */
export function paintText(ctx: CanvasRenderingContext2D, op: Extract<CanvasOp, { op: 'text' }>, palette: CanvasPalette): void {
  ctx.fillStyle = palette[op.color] ?? palette.ink
  ctx.font = `${op.size}px var(--dsw-font-family-sans, ui-sans-serif, system-ui, sans-serif)`
  ctx.textBaseline = 'alphabetic'
  ctx.fillText(op.text, op.at[0], op.at[1])
}
