/**
 * Best-effort mirror of harness `ui-chat`'s Compact/Normal transcript-view
 * preference, read directly from its durable settings section. `@deepseek-ai/
 * dsh-client-ui-chat`'s client entry exports only the `TranscriptViewMode`
 * type, not the namespace or field its own settings storage actually uses
 * (`packages/client/ui-chat/src/chat-settings.ts` in the harness source) —
 * those are private implementation constants, not part of its public
 * contract, so this hardcodes the same strings. If `ui-chat` ever renames
 * them, `normalTranscriptView` silently reads `undefined` and this falls
 * back to treating the turn as Compact — the safe direction, since Compact
 * is exactly the case `TurnTailCard` exists to serve; wrongly assuming
 * Normal would hide a document Compact view still folds away.
 */

/** `ui-chat`'s own settings namespace (`CHAT_SETTINGS_NAMESPACE`, unexported). */
export const CHAT_SETTINGS_NAMESPACE = 'ui-chat'

/** The durable section's shape, narrowed to the one field this plugin reads. */
export interface ChatSettingsSection {
  readonly transcriptView?: 'normal' | 'compact'
}

/**
 * Derive whether Normal transcript view is active from one settings snapshot.
 * @param snapshot - the bound `ui-chat` settings scope's current snapshot.
 * @returns true only once the section has loaded and explicitly reads 'normal'.
 */
export function normalTranscriptView(snapshot: { value: ChatSettingsSection | undefined }): boolean {
  return snapshot.value?.transcriptView === 'normal'
}
