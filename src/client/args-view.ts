// Decoded view of one complete visualizer call's arguments, shared by the
// in-place settled row (title only) and the turn-tail card (full document).

/**
 * Frame height bounds and default mirrored from the tool's execute-time
 * validation in src/index.ts — the client bundle cannot import the node
 * half, so the copy is the price of the two-plane split; change both.
 */
export const MIN_FRAME_HEIGHT_PX = 50
export const MAX_FRAME_HEIGHT_PX = 2_000
export const DEFAULT_FRAME_HEIGHT_PX = 480

/** Decoded view of one complete visualizer call's arguments. */
export interface ArgsView {
  title: string | null
  height: number | null
  html: string
}

/**
 * Decode the complete arguments of one visualizer call.
 * @param argsRaw - the frozen raw arguments string of the call.
 * @returns the view when the JSON parses and carries a non-empty document,
 * else null.
 */
export function argsView(argsRaw: string): ArgsView | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(argsRaw)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null
  const { title, height, html } = parsed as Record<string, unknown>
  if (typeof html !== 'string' || html.length === 0) return null
  const safeHeight = typeof height === 'number' && Number.isInteger(height)
    && height >= MIN_FRAME_HEIGHT_PX && height <= MAX_FRAME_HEIGHT_PX
  return {
    title: typeof title === 'string' && title.trim().length > 0 ? title : null,
    height: safeHeight ? height : null,
    html,
  }
}
