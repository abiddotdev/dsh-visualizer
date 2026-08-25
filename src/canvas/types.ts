/**
 * Pure types of the interactive-canvas domain: the op vocabulary, the scene
 * fold, and validation shared by the host tool and the client card. Zero
 * runtime imports — both planes may depend on this module (the client
 * bundle's purity gate forbids host value edges, and this module has none).
 *
 * @module dsh-visualizer/canvas/types
 */

/** Logical canvas width; ops express coordinates in this space and the
 * renderer scales to the element. */
export const CANVAS_W = 1000
/** Logical canvas height. */
export const CANVAS_H = 640

/** Named palette ids the `color` field accepts; the card resolves them to
 * theme-safe ink values (custom hex would let streamed output smuggle
 * arbitrary styling into the page). */
export const CANVAS_COLORS = ['ink', 'inkSoft', 'accent', 'accentWarm', 'guide', 'white', 'black'] as const

export type CanvasColor = (typeof CANVAS_COLORS)[number]

/** One in-progress polyline the model streams in (shared front anchor). */
export interface CanvasStrokeFront {
  readonly op: 'stroke'
  readonly color: (typeof CANVAS_COLORS)[number]
  readonly width: number
  /** Flattened [x0,y0,x1,y1,...] in logical space; may grow while streaming. */
  readonly points: readonly number[]
}

/** One in-progress shape the model streams in (shared front anchor). */
export interface CanvasShapeFront {
  readonly op: 'rect' | 'ellipse' | 'line' | 'arrow'
  readonly color: (typeof CANVAS_COLORS)[number]
  readonly width: number
  /** [x, y, w, h] (rect/ellipse) or [x0, y0, x1, y1] (line/arrow). */
  readonly bounds: readonly number[]
}

/** One op of the streaming canvas scene. */
export type CanvasOp =
  | CanvasStrokeFront
  | CanvasShapeFront
  | { readonly op: 'text'; readonly text: string; readonly color: (typeof CANVAS_COLORS)[number]; readonly size: number; readonly at: readonly [number, number] }

/** The one settled op every plane derives its views from. */
export interface CanvasDrawOp {
  readonly op: 'draw'
  /** Authoritative scene after this call: complete ops, draw order. */
  readonly ops: readonly CanvasOp[]
}

/** Canonical result of one `canvas_draw` call. */
export interface CanvasDrawResult {
  /** Total ops in the scene after applying this call. */
  readonly ops: number
  /** Number of ops this call added. */
  readonly added: number
  /** Raw ops dropped by tolerance normalization (absent when none). */
  readonly skippedCount?: number
  /** Human-readable skip reasons, first few only. */
  readonly skipped?: string[]
}

/** The wire view of the durable canvas state. */
export interface CanvasSceneView {
  /** Latest complete scene (draw order); null before the first draw. */
  readonly scene: readonly CanvasOp[] | null
  /** Whether the agent is writing a new batch right now (a streaming
   * canvas_draw call is in flight in the live window). */
  readonly live: boolean
}

/** Prefix marking a canvas-initiated prompt turn in the conversation. */
export const CANVAS_PROMPT_PREFIX = '[canvas] '

/** Longest user note accepted on canvas Send. */
export const CANVAS_NOTE_MAX_CHARS = 2_000

/**
 * Build the user-turn text a canvas Send submits: the note plus the user's
 * raw strokes as compact JSON. Kept here so host validation limits and the
 * client payload agree.
 * @param ops - the user's ops (strokes/shapes/text drawn on the overlay).
 * @param note - optional user note.
 * @returns the prompt text.
 */
export function canvasPromptText(ops: readonly CanvasOp[], note: string): string {
  const trimmed = note.trim()
  const payload = JSON.stringify(ops)
  return trimmed.length > 0
    ? `${CANVAS_PROMPT_PREFIX}${trimmed}\n${payload}`
    : `${CANVAS_PROMPT_PREFIX}${payload}`
}
