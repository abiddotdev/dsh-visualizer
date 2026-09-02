/**
 * Streaming inline HTML card, browser half: the `visualizer` dictionaries,
 * the `visualizer-stream` Chat Node fed by streamed `visualizer` call
 * arguments — which, once the host announces `chatPreview`, keeps rendering
 * right through settlement instead of handing off — and the keyed
 * `visualizer` Tool row that otherwise takes over once the call dispatches.
 * The surfaces are inert until their tool exists: sessions whose presets do
 * not mount this package's host half never produce such calls, and this
 * half composes no host behavior at all.
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls each plugin's Context / SlotMap merges into the program.
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-chat/client'
import type {} from '@deepseek-ai/dsh-client-ui-tool/client'
import { StreamCard } from './StreamCard.tsx'
import { ResultRow } from './ResultRow.tsx'
import { en, zh, type GenerativeUiKey } from './locales.ts'
import { generativeStreamDefinition } from './stream-node.ts'

export type { StreamCardProps } from './StreamCard.tsx'
export type { ResultRowProps } from './ResultRow.tsx'
export type { GenerativeCardData, GenerativeStreamChatData } from './stream-node.ts'
export type { GenerativeUiKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The streaming inline HTML cards' copy. */
    'visualizer': GenerativeUiKey
  }
}

/** Dictionary namespace owned by this plugin. */
const NS = 'visualizer'

/** Required services: the slot registry, the card's copy, and the conversation-event engine. */
export const inject = ['slots', 'locale', 'uiConversation']

/**
 * Client plugin body: register the `visualizer` dictionaries, the streaming
 * node, and the `visualizer` row. Both key domains are open, so the
 * contributions render only for this tool's calls and stay inert everywhere
 * else.
 * @param ctx - client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-visualizer: dictionaries')

  ctx.uiConversation.events.register(generativeStreamDefinition)

  ctx.slots.inject('conversation.chat.node', () => ctx.slots.register({
    name: 'conversation.chat.node', key: 'visualizer-stream', locale: NS,
  }, StreamCard))

  ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({
    name: 'tool.call.toolview', key: 'visualizer', locale: NS,
  }, ResultRow))
}
