/**
 * Turn-scoped settled-visualizer accumulator and its `conversation.chat.turnTail`
 * selector. Harness 0.1.2-rc.1's Compact transcript view folds every chat-node
 * kind that is not on a fixed independent-kind allowlist behind one disclosure
 * once its owning turn closes; the tool-call node this package's settled
 * `ResultRow` renders into is not on that list, so a completed document folded
 * away with every other tool call in the turn. `turn-tail` IS exempt — the
 * shipped `ui-deliverables` package relies on the same exemption for its
 * produced-files row — so this module republishes each turn's successful
 * visualizer documents there instead: they render once, after the closing
 * message, independent of the fold in both Normal and Compact view.
 */

import type {
  ConversationNodeDefinition,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { TurnTailOwnerProps } from '@deepseek-ai/dsh-client-ui-chat/client'
import { TOOL_NAME } from './stream-node.ts'

/** One settled visualizer call's raw arguments, kept for the turn-tail card. */
export interface VisualizerTurnCard {
  readonly callId: string
  readonly seq: number
  readonly argsRaw: string
}

/** Successful visualizer calls accumulated for one Turn. */
export interface VisualizerTurnData {
  readonly cards: readonly VisualizerTurnCard[]
}

declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  interface ConversationTurnDataMap {
    /** Successful visualizer documents produced by this Turn, in call order. */
    visualizer: VisualizerTurnData
  }
}

interface VisualizerTurnState extends VisualizerTurnData {
  readonly turn: number
  /** Dispatched calls' raw arguments awaiting their result, by call id. */
  readonly pending: ReadonlyMap<string, string>
}

/**
 * Narrow a `tool/result` event's result-content variant without importing the
 * Session package: the compact/replay stand-in this package never sees at
 * turn-tail time (only a currently-rendering turn's own live events reach this
 * Definition) carries no `message`, so this checks for it structurally.
 */
function toolResultOutcome(event: { data: unknown }): { callId: string; isError: boolean } | null {
  const data = event.data
  if (typeof data !== 'object' || data === null || !('message' in data)) return null
  const message = (data as { message: unknown }).message
  if (typeof message !== 'object' || message === null) return null
  const { source, content } = message as { source?: unknown; content?: unknown }
  if (typeof source !== 'object' || source === null || !('callId' in source)) return null
  if (!Array.isArray(content) || content.length === 0) return null
  const first = content[0] as { isError?: unknown }
  return { callId: String((source as { callId: unknown }).callId), isError: first.isError === true }
}

/** Turn-local successful-call accumulator; it publishes no view Node of its own. */
export const visualizerTurnDefinition: ConversationNodeDefinition<VisualizerTurnState> = {
  // Must equal the `key` published below: the assembler rejects Location
  // data whose key differs from its owning Definition's own kind.
  kind: 'visualizer',
  match: (event) => {
    if (event.type === 'turn/start') return { id: String(event.data.turn), role: 'start' }
    if (event.type === 'tool/call' && event.data.name === TOOL_NAME) {
      return { id: String(event.data.turn), role: 'update' }
    }
    if (event.type === 'tool/result') return { id: String(event.data.turn), role: 'update' }
    return null
  },
  start: (_context, match) => {
    if (match.event.type !== 'turn/start') throw new Error('visualizer start requires turn/start')
    return { turn: match.event.data.turn, pending: new Map(), cards: [] }
  },
  update: (context, match) => {
    const event = match.event
    if (event.type === 'tool/call') {
      const pending = new Map(context.state.pending)
      pending.set(String(event.data.callId), event.data.arguments)
      return { ...context.state, pending }
    }
    if (event.type !== 'tool/result') return context.state
    const outcome = toolResultOutcome(event)
    if (outcome === null) return context.state
    const argsRaw = context.state.pending.get(outcome.callId)
    if (argsRaw === undefined) return context.state
    const pending = new Map(context.state.pending)
    pending.delete(outcome.callId)
    if (outcome.isError) return { ...context.state, pending }
    const card: VisualizerTurnCard = { callId: outcome.callId, seq: event.seq, argsRaw }
    return { ...context.state, pending, cards: [...context.state.cards, card] }
  },
  buildLocationData: (context, scope, previous) => {
    if (scope !== 'turn' || context.state === undefined) return null
    if (previous?.kind === 'turn' && previous.turn === context.state.turn
      && previous.key === 'visualizer' && previous.value.cards === context.state.cards) return previous
    return { kind: 'turn', turn: context.state.turn, key: 'visualizer', value: { cards: context.state.cards } }
  },
}

/**
 * Claim the turn-tail chain only when this turn produced settled documents.
 * @param owner - Turn-tail owner currency for the closing assistant.
 * @returns This turn's settled cards in call order, or null to decline before mount.
 */
export function selectVisualizerCards(owner: TurnTailOwnerProps): readonly VisualizerTurnCard[] | null {
  const cards = owner.turn.data.get('visualizer')?.cards ?? []
  return cards.length === 0 ? null : cards
}
