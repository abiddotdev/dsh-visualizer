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

import { WIDGET_PROMPT_MAX_CHARS } from './AutoFrame.tsx'

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

/**
 * Compose the picks into one prompt block for the model. Each pick reads as
 * its note plus the locator bundle (selector, snippet, text); the whole
 * block stays within the widget prompt cap so it rides the existing
 * sendPrompt channel unchanged.
 * @param picks - the card's current annotations, in pick order.
 * @returns the composed text, or null when there is nothing to send.
 */
export function composeAnnotationPrompt(picks: readonly AnnotationPick[]): string | null {
  if (picks.length === 0) return null
  const lines: string[] = ['Please update the rendered document. Comments on marked elements:']
  for (const pick of picks) {
    const note = pick.comment.trim().length > 0 ? pick.comment.trim() : '(no note)'
    lines.push(`${picks.length > 1 ? '- ' : ''}${note}`)
    lines.push(`  element: <${pick.tag}> ${pick.selector}`)
    if (pick.text.length > 0) lines.push(`  text: ${JSON.stringify(pick.text)}`)
    if (pick.snippet.length > 0) lines.push(`  markup: ${pick.snippet}`)
  }
  const joined = lines.join('\n')
  if (joined.length <= WIDGET_PROMPT_MAX_CHARS) return joined
  // Over cap: drop the deepest locator lines first, notes last.
  const reduced = composeWithoutMarkup(picks)
  if (reduced !== null && reduced.length <= WIDGET_PROMPT_MAX_CHARS) return reduced
  return noteOnlyPrompt(picks).slice(0, WIDGET_PROMPT_MAX_CHARS)
}

/** Same bundle without the markup line; null when no picks remain. */
function composeWithoutMarkup(picks: readonly AnnotationPick[]): string | null {
  if (picks.length === 0) return null
  const lines: string[] = ['Please update the rendered document. Comments on marked elements:']
  for (const pick of picks) {
    const note = pick.comment.trim().length > 0 ? pick.comment.trim() : '(no note)'
    lines.push(`${picks.length > 1 ? '- ' : ''}${note}`)
    lines.push(`  element: <${pick.tag}> ${pick.selector}`)
    if (pick.text.length > 0) lines.push(`  text: ${JSON.stringify(pick.text)}`)
  }
  return lines.join('\n')
}

/** Notes and selectors only; the last resort keeps the user's words. */
function noteOnlyPrompt(picks: readonly AnnotationPick[]): string {
  return picks
    .map(pick => `- ${pick.comment.trim().length > 0 ? pick.comment.trim() : '(no note)'} (${pick.selector})`)
    .join('\n')
}

/** Longest comment accepted into one pick's note input. */
export const ANNOTATION_COMMENT_MAX_CHARS = MAX_COMMENT_CHARS
