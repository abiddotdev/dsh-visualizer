/**
 * Facade over the pinned DeepSeek Harness client-runtime contract snapshot.
 * Re-exports the surface the visualizer client plugin compiles and tests
 * against: the conversation contract types, the event/definition registries,
 * the ConversationNodeAssembler used by the specs, the slot registry, and the
 * `ClientContext` alias with its Context augmentation. At runtime the deployed
 * harness serves the real module-table entry; this snapshot only pins the
 * compile-time contract (see ../README.md).
 */
import type { Context } from '@deepseek-ai/cordis'
// Type-side-effect import: merges the `llm/retry` / `llm/retry-started`
// SessionEventMap members, declared upstream by dsh-llm-retry after rc.1.
import type {} from '@deepseek-ai/dsh-llm-retry'

export { conversationContextKey } from './contract/conversation.ts'
export type {
  ChatConversationViewNode, ConversationEventInput, ConversationLocation,
  ConversationLocationDataStore, ConversationMatchResult, ConversationNodeContext,
  ConversationNodeDefinition, ConversationPreviousContext, ConversationStepDataMap,
  ConversationTurnDataMap, ConversationViewBuilder, ConversationViewDefinition,
} from './contract/conversation.ts'

export { ConversationDefinitionRegistry } from './conversation/definition-registry.ts'

export { ConversationEventRegistry } from './conversation/event-registry.ts'

export { ConversationNodeAssembler } from './sessions/conversation-assembler.ts'
export type { ConversationRuntime } from './sessions/conversation-assembler.ts'

export type { SlotRegistry } from './slots.ts'

/** Client-side Cordis context after declaration merging. */
export type ClientContext = Context

declare module '@deepseek-ai/cordis' {
  interface Context {
    slots: import('./slots.ts').SlotRegistry
    /** Event-to-business-Context Definition registry. */
    conversationEvents: import('./conversation/event-registry.ts').ConversationEventRegistry
  }
}

