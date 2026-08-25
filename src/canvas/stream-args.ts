/**
 * Streaming-prefix decode of one `canvas_draw` call's raw arguments JSON.
 * The schema places `ops` last, so while the model writes, argsRaw holds a
 * growing prefix of `{"clear":false,"ops":[{...},{...` — this module walks
 * the prefix with a string-aware scanner and recovers every COMPLETE op
 * object plus the trailing incomplete one's decoded string fields, so the
 * canvas can paint strokes live.
 *
 * @module dsh-visualizer/canvas/stream-args
 */

import type { CanvasOp, CanvasColor } from './types.ts'

/** Latest decodable view of one streaming canvas call. */
export interface CanvasStreamArgsView {
  /** Whether the `clear` argument arrived and is true. */
  readonly clear: boolean
  /** Complete decoded ops, in call order. */
  readonly ops: readonly CanvasOp[]
  /** The trailing partial op, when the prefix cut inside one; its decoded
   * string fields (color/text) are readable even while points are partial. */
  readonly partial: PartialOpView | null
  /** Whether the ops array's closing bracket has arrived. */
  readonly complete: boolean
}

/** Trailing partial op: known statics plus the flat number run so far. */
export interface PartialOpView {
  readonly op: string | null
  readonly color: string | null
  readonly width: number | null
  readonly size: number | null
  /** points/bounds/at numbers decoded so far, in order. */
  readonly numbers: readonly number[]
  /** text value decoded so far (may be cut). */
  readonly text: string | null
}

/**
 * Convert a trailing partial op into a drawable op for live previews; a
 * partial with no recognizable shape yet returns null. Numbers map onto
 * points/bounds/at per the decoded op kind; missing statics take defaults.
 * @param partial - the trailing partial view, or null.
 * @returns a drawable op approximation of what has streamed so far.
 */
export function partialPreviewOp(partial: PartialOpView | null): CanvasOp | null {
  if (partial === null) return null
  const color = (partial.color ?? 'ink') as CanvasColor
  switch (partial.op) {
    case 'stroke':
      if (partial.numbers.length < 4) return null
      return { op: 'stroke', color, width: partial.width ?? 3, points: partial.numbers }
    case 'rect': case 'ellipse': case 'line': case 'arrow':
      if (partial.numbers.length < 2) return null
      return { op: partial.op, color, width: partial.width ?? 2, bounds: partial.numbers }
    case 'text': {
      const x = partial.numbers[0]
      const y = partial.numbers[1]
      if (x === undefined || y === undefined) return null
      return { op: 'text', color, text: partial.text ?? '', size: partial.size ?? 20, at: [x, y] }
    }
    default:
      return null
  }
}

/** Decode one JSON string value starting after its opening quote; a cut tail
 * yields what arrived with closed=false. */
function decodeString(src: string, pos: number): { value: string; closed: boolean; next: number } {
  let out = ''
  let i = pos
  while (i < src.length) {
    const ch = src.charAt(i)
    if (ch === '"') return { value: out, closed: true, next: i + 1 }
    if (ch !== '\\') { out += ch; i++; continue }
    const esc = src[i + 1]
    if (esc === undefined) return { value: out, closed: false, next: i + 1 }
    if (esc === 'u') {
      const hex = src.slice(i + 2, i + 6)
      if (!/^[0-9a-fA-F]{4}$/.test(hex)) return { value: out, closed: false, next: i + 1 }
      out += String.fromCharCode(Number.parseInt(hex, 16))
      i += 6
      continue
    }
    const map: Record<string, string> = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' }
    const decoded = map[esc]
    if (decoded === undefined) return { value: out, closed: false, next: i + 1 }
    out += decoded
    i += 2
  }
  return { value: out, closed: false, next: i }
}

/**
 * Try to parse one complete op object; returns null when it is not valid.
 * Deliberately lenient (best-effort paint): invalid ops are dropped here and
 * the authoritative execute-time validation still rejects the call.
 */
function tryOp(raw: string): CanvasOp | null {
  let parsed: unknown
  try { parsed = JSON.parse(raw) } catch { return null }
  if (typeof parsed !== 'object' || parsed === null) return null
  const op = parsed as Record<string, unknown>
  const color = (typeof op.color === 'string' ? op.color : 'ink') as CanvasColor
  if (op.op === 'text') {
    if (typeof op.text !== 'string' || !Array.isArray(op.at) || op.at.length !== 2) return null
    return { op: 'text', text: op.text, color, size: typeof op.size === 'number' ? op.size : 20, at: [Number(op.at[0]), Number(op.at[1])] }
  }
  if (op.op === 'stroke') {
    if (!Array.isArray(op.points) || op.points.length < 4) return null
    return { op: 'stroke', color, width: typeof op.width === 'number' ? op.width : 3, points: op.points.map(Number) }
  }
  if (op.op === 'rect' || op.op === 'ellipse' || op.op === 'line' || op.op === 'arrow') {
    if (!Array.isArray(op.bounds) || op.bounds.length !== 4) return null
    return { op: op.op, color, width: typeof op.width === 'number' ? op.width : 3, bounds: op.bounds.map(Number) }
  }
  return null
}

/**
 * Scan the streaming prefix of one canvas_draw call's arguments.
 * @param argsRaw - raw arguments string accumulated so far.
 * @returns the view once the `ops` key and its opening bracket arrived, else null.
 */
export function extractCanvasStreamArgs(argsRaw: string): CanvasStreamArgsView | null {
  let pos = 0
  const ws = (): void => { while (pos < argsRaw.length && ' \n\r\t'.includes(argsRaw[pos] ?? '')) pos++ }
  ws()
  if (argsRaw[pos] !== '{') return null
  pos++
  let clear = false
  let opsKeySeen = false
  while (pos < argsRaw.length) {
    ws()
    if (argsRaw[pos] === '}') return null
    if (argsRaw[pos] !== '"') return null
    const key = decodeString(argsRaw, pos + 1)
    if (!key.closed) return null
    pos = key.next
    ws()
    if (argsRaw[pos] !== ':') return null
    pos++
    ws()
    if (key.value === 'clear') {
      const rest = argsRaw.slice(pos)
      clear = /^true/.test(rest)
      const consumed = /^(true|false)/.exec(rest)
      if (consumed === null) return null
      pos += consumed[0].length
    } else if (key.value === 'ops') {
      if (argsRaw[pos] !== '[') return null
      opsKeySeen = true
      return scanOps(argsRaw, pos + 1, clear)
    } else {
      // Unknown key: skip string-aware to its value's end (best effort).
      const value = decodeValueEnd(argsRaw, pos)
      if (value === -1) return null
      pos = value
    }
    ws()
    if (argsRaw[pos] === ',') { pos++; continue }
    if (argsRaw[pos] === '}') return null
    if (pos >= argsRaw.length) return null
  }
  return opsKeySeen ? null : null
}

/** Best-effort end of one JSON value at pos (-1 = cut). */
function decodeValueEnd(src: string, pos: number): number {
  const ch = src[pos]
  if (ch === '"') {
    const decoded = decodeString(src, pos + 1)
    return decoded.closed ? decoded.next : -1
  }
  if (ch === '{' || ch === '[') {
    let depth = 0
    let i = pos
    let inString = false
    while (i < src.length) {
      const c = src[i]
      if (inString) {
        if (c === '\\') i++
        else if (c === '"') inString = false
        i++
        continue
      }
      if (c === '"') inString = true
      else if (c === '{' || c === '[') depth++
      else if (c === '}' || c === ']') {
        depth--
        if (depth === 0) return i + 1
      }
      i++
    }
    return -1
  }
  let i = pos
  while (i < src.length && src[i] !== ',' && src[i] !== '}') i++
  return i
}

/** Scan the ops array body: complete op objects parsed, the trailing partial decoded. */
function scanOps(src: string, start: number, clear: boolean): CanvasStreamArgsView {
  const ops: CanvasOp[] = []
  let pos = start
  const ws = (): void => { while (pos < src.length && ' \n\r\t'.includes(src[pos] ?? '')) pos++ }
  for (;;) {
    ws()
    const ch = src[pos]
    if (ch === undefined) return { clear, ops, partial: null, complete: false }
    if (ch === ']') return { clear, ops, partial: null, complete: true }
    if (ch !== '{') return { clear, ops, partial: null, complete: false }
    // Find this object's end (string-aware), then try a strict parse.
    const end = decodeValueEnd(src, pos)
    if (end !== -1) {
      const op = tryOp(src.slice(pos, end))
      if (op !== null) ops.push(op)
      pos = end
      ws()
      if (src[pos] === ',') { pos++; continue }
      if (src[pos] === ']') return { clear, ops, partial: null, complete: true }
      if (src[pos] === undefined) return { clear, ops, partial: null, complete: false }
      // Malformed tail (a string or number at array level): stop scanning.
      return { clear, ops, partial: scanPartial(src, pos), complete: false }
    }
    // Object cut mid-way: decode the partial op's fields.
    return { clear, ops, partial: scanPartial(src, pos), complete: false }
  }
}

/** Decode the readable fields of one cut op object. */
function scanPartial(src: string, start: number): PartialOpView | null {
  let pos = start + 1
  const ws = (): void => { while (pos < src.length && ' \n\r\t'.includes(src[pos] ?? '')) pos++ }
  const view: { op: string | null; color: string | null; width: number | null; size: number | null; numbers: number[]; text: string | null } = {
    op: null, color: null, width: null, size: null, numbers: [], text: null,
  }
  while (pos < src.length) {
    ws()
    if (src[pos] === ',') { pos++; continue }
    if (src[pos] === '}') break
    if (src[pos] !== '"') break
    const key = decodeString(src, pos + 1)
    if (!key.closed) break
    pos = key.next
    ws()
    if (src[pos] !== ':') break
    pos++
    ws()
    if (key.value === 'op' || key.value === 'color') {
      if (src[pos] === '"') {
        const value = decodeString(src, pos + 1)
        if (key.value === 'op') view.op = value.value
        else view.color = value.value
        if (value.closed) { pos = value.next; continue }
      }
      break
    }
    if (key.value === 'text') {
      if (src[pos] === '"') {
        const value = decodeString(src, pos + 1)
        view.text = value.value
        if (value.closed) { pos = value.next; continue }
      }
      break
    }
    if (key.value === 'width' || key.value === 'size') {
      const match = /^-?\d+(?:\.\d+)?/.exec(src.slice(pos))
      if (match !== null) {
        if (key.value === 'width') view.width = Number(match[0])
        else view.size = Number(match[0])
        pos += match[0].length
        ws()
        if (src[pos] === ',' || src[pos] === '}') { pos++; continue }
      }
      break
    }
    if (key.value === 'points' || key.value === 'bounds' || key.value === 'at') {
      // Number run: collect complete members until the run cuts.
      if (src[pos] !== '[') break
      pos++
      let closed = false
      for (;;) {
        ws()
        const match = /^-?\d+(?:\.\d+)?/.exec(src.slice(pos))
        if (match === null) break
        view.numbers.push(Number(match[0]))
        pos += match[0].length
        ws()
        if (src[pos] === ',') { pos++; continue }
        if (src[pos] === ']') { pos++; closed = true }
        break
      }
      if (closed) { ws(); if (src[pos] === ',') { pos++; continue } }
      break
    }
    break
  }
  return finishPartial(view)
}

function finishPartial(view: { op: string | null; color: string | null; width: number | null; size: number | null; numbers: number[]; text: string | null }): PartialOpView {
  return { op: view.op, color: view.color, width: view.width, size: view.size, numbers: view.numbers, text: view.text }
}
