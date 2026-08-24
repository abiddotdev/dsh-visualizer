/**
 * Streaming-prefix decode of one `visualizer` call's raw arguments JSON.
 * The tool's schema places `html` last, so while the model is still writing,
 * `argsRaw` holds a growing prefix of
 * `{"title":"…","height":480,"html":"<!DOCTYPE …` — this module walks that
 * prefix with a string-aware scanner and produces the latest decode of the
 * `html` string value plus the earlier-settled `title` and `height`, without
 * requiring the JSON to be complete.
 */

/** Latest decodable view of one streaming call's arguments. */
export interface StreamArgsView {
  /** Grows monotonically as `argsRaw` grows; a dangling escape or cut `\u` sequence is dropped. */
  readonly html: string
  /** Whether the `html` value's closing quote has arrived. */
  readonly complete: boolean
  /** Explicit `title` argument once its complete string value has arrived. */
  readonly title: string | null
  /** Explicit `height` argument once a terminator-terminated integer has arrived. */
  readonly height: number | null
  /** Fully-arrived `loadingMessages` strings, in order; grows as the array streams. */
  readonly loadingMessages: string[]
}

/** Most loading messages the tool schema accepts. */
const MAX_LOADING_MESSAGES = 4

/**
 * Decode a `loadingMessages`-style JSON string array starting at its opening
 * bracket, tolerating a cut tail: only items whose closing quote has arrived
 * are kept, so the view grows monotonically as bytes stream.
 * @param src - raw arguments string.
 * @param pos - index of the opening `[`.
 * @returns the complete items so far and the next unconsumed index, or null
 * when the input ended before anything decodable.
 */
function decodeStringArray(src: string, pos: number): { items: string[]; next: number } | null {
  const items: string[] = []
  let i = skipWs(src, pos + 1)
  while (i < src.length) {
    if (src[i] === ']') return { items, next: i + 1 }
    if (src[i] !== '"') return items.length > 0 ? { items, next: -1 } : null
    const decoded = decodeString(src, i + 1)
    if (!decoded.closed) return items.length > 0 ? { items, next: -1 } : null
    if (items.length < MAX_LOADING_MESSAGES) items.push(decoded.value)
    i = skipWs(src, decoded.next)
    if (src[i] === ',') i = skipWs(src, i + 1)
    else if (src[i] !== ']') return items.length > 0 ? { items, next: -1 } : null
  }
  return items.length > 0 ? { items, next: -1 } : null
}

/**
 * Skip JSON whitespace.
 * @param src - raw arguments string.
 * @param pos - first unconsumed index.
 * @returns the index after the whitespace run.
 */
function skipWs(src: string, pos: number): number {
  while (pos < src.length && (src[pos] === ' ' || src[pos] === '\n' || src[pos] === '\r' || src[pos] === '\t')) pos++
  return pos
}

/**
 * Decode one JSON string value starting after its opening quote; tolerates a
 * cut tail (missing closing quote, dangling escape, partial `\u` sequence).
 * @param src - raw arguments string.
 * @param pos - index of the first character inside the string.
 * @returns the decoded prefix, whether the closing quote arrived, and the
 * next unconsumed index.
 */
function decodeString(src: string, pos: number): { value: string; closed: boolean; next: number } {
  let out = ''
  let i = pos
  while (i < src.length) {
    // charAt over bracket indexing: the loop bound already proves the index,
    // and charAt's unconditional string keeps the append operand typed.
    const ch = src.charAt(i)
    if (ch === '"') return { value: out, closed: true, next: i + 1 }
    if (ch !== '\\') {
      out += ch
      i++
      continue
    }
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
 * Strip a trailing lone high surrogate from a cut prefix: the matching low
 * surrogate may simply not have streamed yet, and rendering a lone half
 * produces a broken glyph. A complete value keeps its bytes verbatim.
 * @param value - decoded string prefix.
 * @param complete - whether the value's closing quote arrived.
 * @returns the value safe to paint.
 */
function withoutDanglingSurrogate(value: string, complete: boolean): string {
  if (complete || value.length === 0) return value
  const last = value.charCodeAt(value.length - 1)
  if (last >= 0xd800 && last <= 0xdbff) return value.slice(0, -1)
  return value
}

/**
 * Read one object key at the cursor.
 * @param src - raw arguments string.
 * @param pos - index of the opening quote.
 * @returns the key and the next unconsumed index, or null when the input
 * ended before the key's closing quote.
 */
function readKey(src: string, pos: number): { key: string; next: number } | null {
  if (src[pos] !== '"') return null
  const decoded = decodeString(src, pos + 1)
  if (!decoded.closed) return null
  return { key: decoded.value, next: decoded.next }
}

/**
 * Skip one value at the cursor (string, number, literal, object, or array),
 * staying string-aware. A cut composite value yields its consumed length so
 * the caller can stop cleanly.
 * @param src - raw arguments string.
 * @param pos - first index of the value.
 * @returns the next unconsumed index, or -1 when the input ended mid-value.
 */
function skipValue(src: string, pos: number): number {
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

/**
 * Decode the streaming view of one `visualizer` call's arguments.
 * @param argsRaw - the raw arguments string as accumulated so far.
 * @returns the latest view once the `html` key and its opening quote have
 * arrived, else null.
 */
export function extractStreamArgs(argsRaw: string): StreamArgsView | null {
  let pos = skipWs(argsRaw, 0)
  if (argsRaw[pos] !== '{') return null
  pos = skipWs(argsRaw, pos + 1)
  let title: string | null = null
  let height: number | null = null
  let loadingMessages: string[] = []
  while (pos < argsRaw.length) {
    if (argsRaw[pos] === '}') return null
    const key = readKey(argsRaw, pos)
    if (key === null) return null
    pos = skipWs(argsRaw, key.next)
    if (argsRaw[pos] !== ':') return null
    pos = skipWs(argsRaw, pos + 1)
    if (key.key === 'html') {
      if (argsRaw[pos] !== '"') return null
      const decoded = decodeString(argsRaw, pos + 1)
      return {
        html: withoutDanglingSurrogate(decoded.value, decoded.closed),
        complete: decoded.closed,
        title,
        height,
        loadingMessages,
      }
    }
    if (key.key === 'title' && argsRaw[pos] === '"') {
      const decoded = decodeString(argsRaw, pos + 1)
      if (decoded.closed) title = decoded.value
    }
    if (key.key === 'loadingMessages' && argsRaw[pos] === '[') {
      const decoded = decodeStringArray(argsRaw, pos)
      if (decoded !== null) loadingMessages = decoded.items
    }
    if (key.key === 'height') {
      const end = skipValue(argsRaw, pos)
      const terminated = end !== -1 && end < argsRaw.length && (argsRaw[end] === ',' || argsRaw[end] === '}')
      const parsed = terminated ? Number(argsRaw.slice(pos, end)) : Number.NaN
      if (Number.isSafeInteger(parsed) && parsed > 0) height = parsed
    }
    const next = skipValue(argsRaw, pos)
    if (next === -1) return null
    pos = skipWs(argsRaw, next)
    if (pos >= argsRaw.length) return null
    if (argsRaw[pos] === ',') pos = skipWs(argsRaw, pos + 1)
    else if (argsRaw[pos] !== '}') return null
  }
  return null
}
