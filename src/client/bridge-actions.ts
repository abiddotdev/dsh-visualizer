/**
 * Host-side handlers for messages a rendered widget posts through the shell
 * bridge.
 * @module dsh-visualizer/bridge-actions
 */

/** Prefix marking a widget-initiated prompt turn in the conversation. */
export const WIDGET_PROMPT_PREFIX = '[widget] '

/**
 * The input action face the GUI's session kit hands to slot components;
 * structural so the client bundle stays independent of the conversation
 * package's runtime identity.
 */
export interface WidgetInputActions {
  /** Write the full next composer draft. */
  setDraft(text: string): void
  /** Enter submission of the current draft. */
  submit(): void
}

/**
 * Submit one widget-initiated prompt as a new user turn.
 * @param actions - the card's session input action face.
 * @param text - validated prompt text from the widget.
 */
export function submitWidgetPrompt(actions: WidgetInputActions, text: string): void {
  actions.setDraft(WIDGET_PROMPT_PREFIX + text)
  actions.submit()
}
