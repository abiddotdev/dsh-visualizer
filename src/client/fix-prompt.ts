/**
 * Prompt composition for the card's fix control. A document can fail two ways
 * after it settles — an external library never loaded, or a script threw — and
 * the frame reports both to the host (see AutoFrame's `scriptError` and
 * `runtimeError` handling). Neither reaches the model on its own: the
 * settle-time check in `src/inspect.ts` compiles script bodies but never runs
 * them, so the tool result said the document check passed. This turns the
 * card's error notice into one turn the user can send, naming the failure the
 * model could not have seen.
 *
 * The composed text rides the same `[widget]` prompt channel comment mode
 * uses, so it inherits that path's tagging unchanged.
 *
 * @module dsh-visualizer/fix-prompt
 */

/** Longest document title echoed into the prompt; titles are model output. */
const MAX_TITLE_CHARS = 120

/** One card's failure state at the moment the user asks for a fix. */
export interface RenderFailure {
  /** The document's title, or null when the call carried none. */
  readonly title: string | null
  /** Source URL of the external script that failed to load, or null. */
  readonly scriptSrc: string | null
  /** First runtime error message the frame reported, or null. */
  readonly runtimeMessage: string | null
  /** Line the runtime error was raised on, where the frame knew it. */
  readonly runtimeLine: number | null
}

/** Closing instruction: the fix belongs in a fresh render, not in prose. */
const FIX_INSTRUCTION = 'Fix the cause and re-render the corrected document.'

/**
 * Extra guidance when a library never loaded. A failed load usually explains
 * whatever threw afterwards (`Chart is not defined` because the CDN answered
 * 404), so the model is told to treat it as the likely root cause rather than
 * chasing the symptom.
 */
const SCRIPT_HINT = 'A failed load is usually the root cause of any script error above — inline the dependency or load it from one of the allowed CDNs.'

/**
 * Compose the fix request for one failed render.
 * @param failure - the card's current failure state.
 * @returns the prompt text, or null when nothing failed and there is
 * therefore nothing to ask about.
 */
export function composeFixPrompt(failure: RenderFailure): string | null {
  const findings: string[] = []
  if (failure.scriptSrc !== null && failure.scriptSrc.length > 0) {
    findings.push(`- a library failed to load: ${failure.scriptSrc}`)
  }
  if (failure.runtimeMessage !== null && failure.runtimeMessage.length > 0) {
    const at = failure.runtimeLine !== null ? ` on line ${failure.runtimeLine}` : ''
    findings.push(`- a script error${at}: ${failure.runtimeMessage}`)
  }
  if (findings.length === 0) return null
  const name = describeDocument(failure.title)
  const lines = [`${name} failed in the preview:`, '', ...findings, '', FIX_INSTRUCTION]
  if (failure.scriptSrc !== null && failure.scriptSrc.length > 0) lines.push(SCRIPT_HINT)
  return lines.join('\n')
}

/**
 * Name the document for the prompt's first line. The model holds the document
 * itself in its own call arguments, so the title alone identifies which render
 * broke — an untitled one is named by position instead.
 * @param title - the call's `title` argument, or null when absent.
 * @returns the subject phrase opening the prompt.
 */
function describeDocument(title: string | null): string {
  const trimmed = (title ?? '').trim()
  if (trimmed.length === 0) return 'The document you just rendered'
  return `The document you just rendered, "${trimmed.slice(0, MAX_TITLE_CHARS)}",`
}
