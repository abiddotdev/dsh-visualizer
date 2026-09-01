/**
 * Live-preview Conversation Node for the `visualizer` tool. While the model
 * writes the call, `assistant/chunk` `tool-call-delta` events grow the raw
 * arguments string in this Step's State; this Definition decodes each prefix
 * into card data the streaming renderer paints. When the executor logs the
 * matching `tool/call`, the keyed `tool.call.toolview` row (`visualizer`)
 * takes over with the authoritative arguments and this node hides — the two
 * surfaces never double-render. Replaying the log reproduces the same
 * sequence deterministically.
 */

import type {
  ConversationLocation, ConversationNodeDefinition,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { extractStreamArgs } from './partial-args.ts'

/** Wire Tool name this package's cards key on. */
export const TOOL_NAME = 'visualizer'

/** One live document card derived from a streaming or complete call block. */
export interface GenerativeCardData {
  /** Live phase of the underlying call block. */
  readonly phase: 'streaming' | 'complete' | 'interrupted'
  /** Explicit `title` argument once decodable, else null (card shows its fallback). */
  readonly title: string | null
  /**
   * Explicit `height` argument once decodable, else null. The live card
   * ignores it — measurements own the streaming height — and the settled
   * row reads the same argument from the logged call as its opening height.
   */
  readonly height: number | null
  /** Model-authored loading messages, shown rotating while the document streams. */
  readonly loadingMessages: readonly string[]
  /** Latest decoded document prefix, or the complete document. */
  readonly html: string
}

/** Chat payload of the streaming node: the step's live cards, in block order. */
export interface GenerativeStreamChatData {
  readonly cards: readonly GenerativeCardData[]
}

/** Accumulated tool-call block of this step, kept only for `visualizer`. */
interface StreamBlock {
  readonly callId: string
  /** Tool name; empty while the first delta has not named the call. */
  readonly name: string
  readonly argsRaw: string
  readonly complete: boolean
}

interface StreamState {
  readonly turn: number
  readonly step: number
  /** Seq of the first accepted visualizer evidence; orders the card in the step. */
  readonly anchorSeq: number
  readonly blocks: ReadonlyMap<number, StreamBlock>
  /** Call ids whose `tool/call` landed; their card leaves this node. */
  readonly dispatched: readonly string[]
  /** Whether the step's `assistant/message` finalized the blocks. */
  readonly finalized: boolean
}

declare module '@deepseek-ai/dsh-client-ui-chat/client' {
  interface ChatNodeDataMap {
    /** Live visualizer streaming cards of one Assistant step. */
    'visualizer-stream': GenerativeStreamChatData
  }
}

function initialState(turn: number, step: number, anchorSeq: number): StreamState {
  return { turn, step, anchorSeq, blocks: new Map(), dispatched: [], finalized: false }
}

/**
 * Fold one streamed tool-call block delta; foreign tools drop their record so
 * their arguments never accumulate here.
 * @param state - current step State.
 * @param index - streamed block index.
 * @param callId - delta's call identity.
 * @param name - delta's optional tool name.
 * @param delta - raw arguments fragment.
 * @param seq - the delta event's log seq; anchors the card when it is the
 * step's first visualizer evidence.
 * @returns the next State.
 */
function foldDelta(
  state: StreamState, index: number, callId: string, name: string | undefined, delta: string, seq: number,
): StreamState {
  const previous = state.blocks.get(index)
  if (previous?.complete === true) return state
  const known = name ?? previous?.name ?? ''
  if (known !== '' && known !== TOOL_NAME) {
    if (previous === undefined) return state
    const blocks = new Map(state.blocks)
    blocks.delete(index)
    return { ...state, blocks }
  }
  const blocks = new Map(state.blocks)
  blocks.set(index, {
    callId: callId || previous?.callId || '',
    name: known,
    argsRaw: (previous?.argsRaw ?? '') + delta,
    complete: false,
  })
  return { ...state, blocks, anchorSeq: state.blocks.size === 0 ? seq : state.anchorSeq }
}

/**
 * Adopt a finalized tool-call block from `block-end` or `assistant/message`.
 * @param state - current step State.
 * @param index - block index (content position in a finalized message).
 * @param block - the complete tool-call content block.
 * @param seq - the event's log seq; anchors the card when it is the step's
 * first visualizer evidence.
 * @returns the next State.
 */
function foldFinalBlock(
  state: StreamState, index: number, block: { id: unknown; name: string; arguments: string }, seq: number,
): StreamState {
  if (block.name !== TOOL_NAME) {
    if (!state.blocks.has(index)) return state
    const blocks = new Map(state.blocks)
    blocks.delete(index)
    return { ...state, blocks }
  }
  const blocks = new Map(state.blocks)
  blocks.set(index, { callId: String(block.id), name: block.name, argsRaw: block.arguments, complete: true })
  return { ...state, blocks, anchorSeq: state.blocks.size === 0 ? seq : state.anchorSeq }
}

/**
 * Whether the Step or Turn closed without a final assistant message — the
 * interruption evidence the streaming card marks.
 * @param location - best currently loaded event Location.
 * @returns true when a closed boundary exists.
 */
function closedBoundary(location: ConversationLocation | undefined): boolean {
  if (location === undefined) return false
  if (location.kind === 'step' && location.step.status === 'closed') return true
  return (location.kind === 'step' || location.kind === 'turn') && location.turn.status === 'closed'
}

/** The streaming live-card Conversation Node Definition. */
export const generativeStreamDefinition: ConversationNodeDefinition<StreamState> = {
  kind: 'visualizer-stream',
  target: 'chat',
  match: (event) => {
    if (event.type === 'step/start') return { id: `${event.data.turn}:${event.data.step}`, role: 'start' }
    if (event.type === 'assistant/chunk') {
      const chunk = event.data.chunk
      const relevant = chunk.type === 'block-start' && chunk.blockType === 'tool-call'
        || chunk.type === 'tool-call-delta'
        || chunk.type === 'block-end' && chunk.block.type === 'tool-call'
      if (!relevant) return null
      return { id: `${event.data.turn}:${event.data.step}`, role: 'update' }
    }
    if (event.type === 'assistant/message' || event.type === 'llm/retry') {
      return { id: `${event.data.turn}:${event.data.step}`, role: 'update' }
    }
    if (event.type === 'tool/call' && event.data.name === TOOL_NAME) {
      return { id: `${event.data.turn}:${event.data.step}`, role: 'update' }
    }
    return null
  },
  start: (_context, match) => {
    if (match.event.type !== 'step/start') throw new Error('visualizer-stream start requires step/start')
    const anchorSeq = match.event.seq
    return initialState(match.event.data.turn, match.event.data.step, anchorSeq)
  },
  update: (context, match) => {
    const state = context.state
    const event = match.event
    if (event.type === 'assistant/chunk') {
      const chunk = event.data.chunk
      if (chunk.type === 'tool-call-delta') {
        return foldDelta(state, chunk.index, String(chunk.id), chunk.name, chunk.argumentsDelta, event.seq)
      }
      if (chunk.type === 'block-end' && chunk.block.type === 'tool-call') {
        return foldFinalBlock(state, chunk.index, chunk.block, event.seq)
      }
      return state
    }
    if (event.type === 'assistant/message') {
      let next = { ...state, finalized: true }
      const content = event.data.message.content
      for (let index = 0; index < content.length; index++) {
        const block = content[index]
        if (block !== undefined && block.type === 'tool-call') next = foldFinalBlock(next, index, block, event.seq)
      }
      return next
    }
    if (event.type === 'llm/retry') {
      return initialState(state.turn, state.step, match.event.seq)
    }
    if (event.type === 'tool/call') {
      const callId = String(event.data.callId)
      if (state.dispatched.includes(callId)) return state
      return { ...state, dispatched: [...state.dispatched, callId] }
    }
    return state
  },
  publication: match => match.event.type === 'assistant/chunk' ? 'animation-frame' : 'immediate',
  buildViewNode: (context) => {
    const state = context.state
    if (state === undefined) return null
    const interrupted = !state.finalized
      && closedBoundary(context.start?.location ?? context.matches.at(-1)?.location)
    const cards: GenerativeCardData[] = []
    const live: GenerativeCardData[] = []
    const blocks = [...state.blocks.entries()].sort((left, right) => left[0] - right[0])
    for (const [, block] of blocks) {
      const view = extractStreamArgs(block.argsRaw)
      if (view === null) continue
      const card: GenerativeCardData = {
        phase: block.complete ? 'complete' : interrupted ? 'interrupted' : 'streaming',
        title: view.title,
        height: view.height,
        html: view.html,
        loadingMessages: view.loadingMessages,
      }
      cards.push(card)
      if (!state.dispatched.includes(block.callId)) live.push(card)
    }
    const anchorSeq = state.anchorSeq || context.matches[0]?.event.seq || 0
    const base = {
      key: context.key,
      kind: 'visualizer-stream',
      id: context.id,
      target: 'chat',
      anchorSeq,
      location: context.start?.location ?? context.matches[0]?.location ?? { kind: 'unresolved' },
    } as const
    if (cards.length === 0) {
      // Never published anything, or the retry reset dropped the evidence:
      // withdraw only when no node is currently mounted.
      return context.current.get('chat') === undefined
        ? null
        : { ...base, visibility: 'hidden', data: { cards: [] } }
    }
    return live.length > 0
      ? { ...base, visibility: 'visible', data: { cards: live } }
      : { ...base, visibility: 'hidden', data: { cards: [] } }
  },
}
