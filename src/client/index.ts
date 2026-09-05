/**
 * Streaming inline HTML card, browser half: the `visualizer` dictionaries,
 * the live `visualizer-stream` Chat Node fed by streamed `visualizer` call
 * arguments, and the keyed `visualizer` Tool row that takes over once the
 * call dispatches. The rows are inert until their tool exists: sessions whose
 * presets do not mount this package's host half never produce
 * such calls, and this half composes no host behavior at all.
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls each plugin's Context / SlotMap merges into the program.
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@deepseek-ai/dsh-client-ui-tool/client'
import { StreamCard } from './StreamCard.tsx'
import { ResultRow } from './ResultRow.tsx'
import { TurnTailCard } from './TurnTailCard.tsx'
import { ArtifactGallery } from './ArtifactGallery.tsx'
import { en, zh, type GenerativeUiKey } from './locales.ts'
import { generativeStreamDefinition } from './stream-node.ts'
import { selectVisualizerCards, visualizerTurnDefinition } from './turn-tail.ts'
import { CHAT_SETTINGS_NAMESPACE, type ChatSettingsSection } from './transcript-view.ts'
import { exportShareEnabled } from './share.ts'

export type { StreamCardProps } from './StreamCard.tsx'
export type { ResultRowProps } from './ResultRow.tsx'
export type { TurnTailCardProps } from './TurnTailCard.tsx'
export type { ArtifactGalleryProps } from './ArtifactGallery.tsx'
export type { GenerativeCardData, GenerativeStreamChatData } from './stream-node.ts'
export type { VisualizerTurnCard, VisualizerTurnData } from './turn-tail.ts'
export type { GenerativeUiKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The streaming inline HTML cards' copy. */
    'visualizer': GenerativeUiKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'visualizer'

/** Required services: the slot registry, the card's copy, the conversation-event engine, and the settings scope. */
export const inject = ['slots', 'locale', 'uiConversation', 'settingsScope']

/**
 * Client plugin body: register the `visualizer` dictionaries, the live
 * streaming node, and the `visualizer` row. Both key domains are open, so
 * the contributions render only for this tool's calls and stay inert
 * everywhere else.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-visualizer: dictionaries')

  ctx.uiConversation.events.register(generativeStreamDefinition)
  ctx.uiConversation.events.register(visualizerTurnDefinition)

  // The gallery lists what the export fanout mirrors to disk; without that
  // feature mounted there is nothing to list, so the tab tracks the same
  // boot-table announcement the card's Share control gates on.
  if (exportShareEnabled()) {
    const t = ctx.locale.bind(NS)
    ctx.slots.inject('conversation.view', () => ctx.slots.register({
      name: 'conversation.view',
      id: 'visualizer-artifacts',
      order: 100,
      label: () => t('view.artifacts'),
      locale: NS,
    }, ArtifactGallery))
  }

  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({
    name: 'conversation.chat.node', key: 'visualizer-stream', locale: NS,
  }, StreamCard))

  ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({
    name: 'tool.call.toolview', key: 'visualizer', locale: NS,
  }, ResultRow))

  // Compact transcript view folds the tool-call node ResultRow renders into
  // once its turn closes (see turn-tail.ts); `turn-tail` is exempt from that
  // fold, so every settled document republishes there instead. In Normal
  // view nothing folds — ResultRow's own copy already survives — so
  // TurnTailCard reads the same harness transcript-view preference
  // (transcript-view.ts) and stays empty there, avoiding a duplicate.
  const chatSettings = ctx.settingsScope.bind<ChatSettingsSection>({ namespace: CHAT_SETTINGS_NAMESPACE })
  ctx.slots.inject('conversation.chat.turnTail', () => ctx.slots.register({
    name: 'conversation.chat.turnTail',
    select: selectVisualizerCards,
    locale: NS,
    inject: () => ({ hooks: { transcriptView: chatSettings } }),
  }, TurnTailCard))
}
