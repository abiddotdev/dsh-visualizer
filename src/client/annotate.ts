/**
 * Comment-mode types and prompt composition, host side. A "pick" is one
 * element (or dragged area) the user marked inside the rendered frame; the
 * bridge computes a selector bundle in the frame (the host cannot reach the
 * null-origin document's DOM), the card shows picks as comment rows, and
 * Send composes them into one text block for the model through the widget
 * prompt channel. Every string the frame posts is model-derived, so the
 * host bounds each field again before it reaches row state.
 *
 * @module dsh-visualizer/annotate
 */

/**
 * Longest prompt text accepted from a widget; also the composed annotation
 * prompt's own budget, since it rides the same `sendPrompt` channel. Owned
 * here rather than in AutoFrame.tsx (which re-exports it) so this module
 * never imports back from its own caller.
 */
export const WIDGET_PROMPT_MAX_CHARS = 4_000

/** One pick as accepted into host state; all strings already bounded. */
export interface AnnotationPick {
  /** Frame-assigned identity, unique within one rendered document. */
  readonly id: string
  /** `element` for a click pick; `area` for a dragged region. */
  readonly kind: 'element' | 'area'
  /** CSS selector naming the picked element (best element, for areas). */
  readonly selector: string
  /** Lowercase tag name of the picked element. */
  readonly tag: string
  /** Trimmed `outerHTML` of the picked element, ellipsized. */
  readonly snippet: string
  /** The element's visible text, trimmed and ellipsized; may be empty. */
  readonly text: string
  /** The user's note for this pick; empty until written. */
  comment: string
}

/** Bounds re-applied host-side to every field the frame posts. */
const MAX_ID_CHARS = 64
const MAX_SELECTOR_CHARS = 300
const MAX_TAG_CHARS = 32
const MAX_SNIPPET_CHARS = 400
const MAX_TEXT_CHARS = 200
const MAX_COMMENT_CHARS = 500

/**
 * Validate and bound one pick posted from the frame.
 * @param raw - the message data payload of an `annotation` post.
 * @returns the pick, or null when any field is malformed.
 */
export function parseAnnotation(raw: unknown): AnnotationPick | null {
  if (typeof raw !== 'object' || raw === null) return null
  const data = raw as Record<string, unknown>
  if (typeof data.id !== 'string' || data.id.length === 0 || data.id.length > MAX_ID_CHARS) return null
  if (data.kind !== 'element' && data.kind !== 'area') return null
  if (typeof data.selector !== 'string' || data.selector.length === 0) return null
  if (typeof data.tag !== 'string' || data.tag.length === 0) return null
  if (typeof data.snippet !== 'string') return null
  if (typeof data.text !== 'string') return null
  return {
    id: data.id,
    kind: data.kind,
    selector: data.selector.slice(0, MAX_SELECTOR_CHARS),
    tag: data.tag.slice(0, MAX_TAG_CHARS),
    snippet: data.snippet.slice(0, MAX_SNIPPET_CHARS),
    text: data.text.slice(0, MAX_TEXT_CHARS),
    comment: '',
  }
}

/** Header line of every composed prompt; the count lands below it. */
const PROMPT_HEADER = 'Please update the rendered document. Comments on marked elements:'

/**
 * Compose the picks into one prompt block for the model. Items are numbered
 * and separated by blank lines, each carrying its note plus the locator
 * bundle (selector, snippet, text); the whole block stays within the widget
 * prompt cap so it rides the existing sendPrompt channel unchanged.
 * @param picks - the card's current annotations, in pick order.
 * @returns the composed text, or null when there is nothing to send.
 */
export function composeAnnotationPrompt(picks: readonly AnnotationPick[]): string | null {
  if (picks.length === 0) return null
  const items = picks.map((pick, index) => itemLines(pick, index + 1, true))
  let joined = `${PROMPT_HEADER}\n\n${items.join('\n\n')}`
  if (joined.length <= WIDGET_PROMPT_MAX_CHARS) return joined
  // Over cap: drop the deepest locator lines first, notes last.
  const reduced = `${PROMPT_HEADER}\n\n${picks.map((pick, index) => itemLines(pick, index + 1, false)).join('\n\n')}`
  if (reduced.length <= WIDGET_PROMPT_MAX_CHARS) return reduced
  return notesOnlyPrompt(picks)
}

/** One numbered item's lines; `withMarkup` drops the deepest locator first. */
function itemLines(pick: AnnotationPick, number: number, withMarkup: boolean): string {
  const note = pick.comment.trim().length > 0 ? pick.comment.trim() : '(no note)'
  const lines = [
    `${number}. ${note}`,
    `  element: <${pick.tag}> ${pick.selector}`,
  ]
  if (pick.text.length > 0) lines.push(`  text: ${JSON.stringify(pick.text)}`)
  if (withMarkup && pick.snippet.length > 0) lines.push(`  markup: ${pick.snippet}`)
  return lines.join('\n')
}

/** One pick's line in the notes-only tier: number, note, and a bare selector. */
function noteOnlyLine(pick: AnnotationPick, number: number): string {
  const note = pick.comment.trim().length > 0 ? pick.comment.trim() : '(no note)'
  return `${number}. ${note} (${pick.selector})`
}

/**
 * Last-resort tier: the header plus as many whole notes-only lines as fit
 * under the cap, earliest picks first. Appends a whole line or not at all —
 * never a mid-line slice — so a still-over-cap pick set drops its tail
 * cleanly instead of ending in a truncated fragment, and the header always
 * survives even when no pick does.
 */
function notesOnlyPrompt(picks: readonly AnnotationPick[]): string {
  let text = PROMPT_HEADER
  for (let index = 0; index < picks.length; index++) {
    const candidate = `${text}\n\n${noteOnlyLine(picks[index]!, index + 1)}`
    if (candidate.length > WIDGET_PROMPT_MAX_CHARS) break
    text = candidate
  }
  return text
}

/** Longest comment accepted into one pick's note input. */
export const ANNOTATION_COMMENT_MAX_CHARS = MAX_COMMENT_CHARS
