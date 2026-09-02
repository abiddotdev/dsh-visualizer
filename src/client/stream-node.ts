/**
 * Live-and-settled preview Conversation Node for the `visualizer` tool.
 * While the model writes the call, `assistant/chunk` `tool-call-delta`
 * events grow the raw arguments string in this Turn's State; this
 * Definition decodes each prefix into card data the streaming renderer
 * paints. Deltas, `block-end`, and `assistant/message` all feed the same
 * accumulator, so the document is complete and known here well before
 * `tool/call` ever fires — unlike that event's own `arguments`, which is
 * not a "surface" event and can be windowed out of older loaded history,
 * this Node's own accumulated bytes are never at risk of going missing.
 *
 * When `tool/call` dispatches, the card does not hide: it keeps rendering
 * through execution, gaining the settled controls the moment `phase` flips
 * to `complete`, and re-anchors past the turn's latest `assistant/message`
 * so it survives compact-mode folding once the turn's process (including
 * the keyed `tool.call.toolview` row) collapses — the row
 * ({@link ./preview-coverage.ts}) drops to a bare summary line for exactly
 * the calls this card covers. A call that settles with an error is dropped
 * from this card entirely; the row alone shows the failure. Replaying the
 * log reproduces the same sequence deterministically.
 */

import type {
  ConversationLocation, ConversationNodeDefinition,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { extractStreamArgs } from './partial-args.ts'

/** Wire Tool name this package's cards key on. */
export const TOOL_NAME = 'visualizer'

/** Fractional anchor offset past the turn's latest assistant message. The
 * harness's own synthetic offsets end at 0.1 (`finalizedFollowup`, the
 * turn-tail row), so a smaller fraction parks the card between the answer
 * and the tail while staying outside the compact-mode fold window. */
const ANSWER_ANCHOR_OFFSET = 0.05

/** One live document card derived from a streaming or complete call block. */
export interface GenerativeCardData {
  /** Live phase of the underlying call block. */
  readonly phase: 'streaming' | 'complete' | 'interrupted'
  /** Explicit `title` argument once decodable, else null (card shows its fallback). */
  readonly title: string | null
  /**
   * Explicit `height` argument once decodable, else null. The live card
   * ignores it — measurements own the frame's height for this card's whole
   * life, streaming through settled — and the settled row reads the same
   * argument from the logged call as its own opening height.
   */
  readonly height: number | null
  /** Model-authored loading messages, shown rotating while the document streams. */
  readonly loadingMessages: readonly string[]
  /** Latest decoded document prefix, or the complete document. */
  readonly html: string
  /**
   * The call this card renders, once `tool/call` names it; keys the row's
   * coverage check ({@link ./preview-coverage.ts}). Undefined before
   * dispatch, since no row exists yet to coordinate with.
   */
  readonly callId?: string
}

/** Chat payload of the streaming node: the turn's live cards, in block order. */
export interface GenerativeStreamChatData {
  readonly cards: readonly GenerativeCardData[]
}

/** Accumulated tool-call block, keyed by step and index; kept only for `visualizer`. */
interface StreamBlock {
  readonly callId: string
  /** Tool name; empty while the first delta has not named the call. */
  readonly name: string
  readonly argsRaw: string
  readonly complete: boolean
  /** Whether the executor's `tool/call` named this block's callId. */
  readonly dispatched: boolean
  /** Whether `tool/result` landed for this callId. */
  readonly settled: boolean
  readonly isError: boolean
}

interface StreamState {
  readonly turn: number
  /** Seq of the first accepted visualizer evidence; the card's natural, pre-answer position. */
  readonly anchorSeq: number
  /** Latest `assistant/message` seq of the turn; the anchor once one arrives. */
  readonly lastMessageSeq: number | null
  /** Blocks keyed by `step * BLOCK_KEY_STEP_FACTOR + index`; Map insertion order is call order. */
  readonly blocks: ReadonlyMap<number, StreamBlock>
}

declare module '@deepseek-ai/dsh-client-ui-chat/client' {
  interface ChatNodeDataMap {
    /** Live and settled visualizer cards of one turn. */
    'visualizer-stream': GenerativeStreamChatData
  }
}

/** Block-index space per step; steps rarely emit more than a handful of blocks. */
const BLOCK_KEY_STEP_FACTOR = 1_000_000

function blockKey(step: number, index: number): number {
  return step * BLOCK_KEY_STEP_FACTOR + index
}

function initialState(turn: number, anchorSeq: number): StreamState {
  return { turn, anchorSeq, lastMessageSeq: null, blocks: new Map() }
}

/**
 * Fold one streamed tool-call block delta; foreign tools drop their record so
 * their arguments never accumulate here.
 * @param state - current turn State.
 * @param step - the delta's step.
 * @param index - streamed block index within the step.
 * @param callId - delta's call identity.
 * @param name - delta's optional tool name.
 * @param delta - raw arguments fragment.
 * @param seq - the delta event's log seq; anchors the card when it is the
 * turn's first visualizer evidence.
 * @returns the next State.
 */
function foldDelta(
  state: StreamState, step: number, index: number, callId: string, name: string | undefined, delta: string, seq: number,
): StreamState {
  const key = blockKey(step, index)
  const previous = state.blocks.get(key)
  if (previous?.complete === true) return state
  const known = name ?? previous?.name ?? ''
  if (known !== '' && known !== TOOL_NAME) {
    if (previous === undefined) return state
    const blocks = new Map(state.blocks)
    blocks.delete(key)
    return { ...state, blocks }
  }
  const blocks = new Map(state.blocks)
  blocks.set(key, {
    callId: callId || previous?.callId || '',
    name: known,
    argsRaw: (previous?.argsRaw ?? '') + delta,
    complete: false,
    dispatched: previous?.dispatched ?? false,
    settled: previous?.settled ?? false,
    isError: previous?.isError ?? false,
  })
  return { ...state, blocks, anchorSeq: state.blocks.size === 0 ? seq : state.anchorSeq }
}

/**
 * Adopt a finalized tool-call block from `block-end` or `assistant/message`.
 * @param state - current turn State.
 * @param step - the block's step.
 * @param index - block index (content position in a finalized message).
 * @param block - the complete tool-call content block.
 * @param seq - the event's log seq; anchors the card when it is the turn's
 * first visualizer evidence.
 * @returns the next State.
 */
function foldFinalBlock(
  state: StreamState, step: number, index: number, block: { id: unknown; name: string; arguments: string }, seq: number,
): StreamState {
  const key = blockKey(step, index)
  if (block.name !== TOOL_NAME) {
    if (!state.blocks.has(key)) return state
    const blocks = new Map(state.blocks)
    blocks.delete(key)
    return { ...state, blocks }
  }
  const previous = state.blocks.get(key)
  const blocks = new Map(state.blocks)
  blocks.set(key, {
    callId: String(block.id),
    name: block.name,
    argsRaw: block.arguments,
    complete: true,
    dispatched: previous?.dispatched ?? false,
    settled: previous?.settled ?? false,
    isError: previous?.isError ?? false,
  })
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

/** The streaming (and settled) live-card Conversation Node Definition. */
export const generativeStreamDefinition: ConversationNodeDefinition<StreamState> = {
  kind: 'visualizer-stream',
  target: 'chat',
  match: (event) => {
    if (event.type === 'turn/start') return { id: String(event.data.turn), role: 'start' }
    if (event.type === 'assistant/chunk') {
      const chunk = event.data.chunk
      const relevant = chunk.type === 'block-start' && chunk.blockType === 'tool-call'
        || chunk.type === 'tool-call-delta'
        || chunk.type === 'block-end' && chunk.block.type === 'tool-call'
      if (!relevant) return null
      return { id: String(event.data.turn), role: 'update' }
    }
    if (event.type === 'assistant/message' || event.type === 'llm/retry') {
      return { id: String(event.data.turn), role: 'update' }
    }
    if (event.type === 'tool/call' && event.data.name === TOOL_NAME) {
      return { id: String(event.data.turn), role: 'update' }
    }
    // Results of any tool/name route here too — the update fold discards
    // those that concern no tracked block, and matching broadly keeps this
    // simple: no separate "is this call ours" pre-check against the wire.
    if (event.type === 'tool/result') return { id: String(event.data.turn), role: 'update' }
    return null
  },
  start: (_context, match) => {
    if (match.event.type !== 'turn/start') throw new Error('visualizer-stream start requires turn/start')
    return initialState(match.event.data.turn, match.event.seq)
  },
  update: (context, match) => {
    const state = context.state
    const event = match.event
    if (event.type === 'assistant/chunk') {
      const chunk = event.data.chunk
      if (chunk.type === 'tool-call-delta') {
        return foldDelta(state, event.data.step, chunk.index, String(chunk.id), chunk.name, chunk.argumentsDelta, event.seq)
      }
      if (chunk.type === 'block-end' && chunk.block.type === 'tool-call') {
        return foldFinalBlock(state, event.data.step, chunk.index, chunk.block, event.seq)
      }
      return state
    }
    if (event.type === 'assistant/message') {
      let next: StreamState = { ...state, lastMessageSeq: event.seq }
      const content = event.data.message.content
      for (let index = 0; index < content.length; index++) {
        const block = content[index]
        if (block !== undefined && block.type === 'tool-call') next = foldFinalBlock(next, event.data.step, index, block, event.seq)
      }
      return next
    }
    if (event.type === 'llm/retry') {
      // A retry concerns only its own step: earlier steps of the same turn
      // (and their already-dispatched or settled calls) must survive it.
      const prefix = event.data.step * BLOCK_KEY_STEP_FACTOR
      const blocks = new Map([...state.blocks].filter(([key]) =>
        key < prefix || key >= prefix + BLOCK_KEY_STEP_FACTOR))
      return { ...state, blocks }
    }
    if (event.type === 'tool/call') {
      const callId = String(event.data.callId)
      const blocks = new Map(state.blocks)
      let changed = false
      for (const [key, block] of blocks) {
        if (block.callId === callId && !block.dispatched) {
          blocks.set(key, { ...block, dispatched: true })
          changed = true
        }
      }
      return changed ? { ...state, blocks } : state
    }
    if (event.type === 'tool/result') {
      const callId = String(event.data.message.source.callId)
      const resultBlock = event.data.message.content[0]
      const isError = resultBlock?.isError === true
      const blocks = new Map(state.blocks)
      let changed = false
      for (const [key, block] of blocks) {
        if (block.callId === callId && !block.settled) {
          blocks.set(key, { ...block, settled: true, isError })
          changed = true
        }
      }
      return changed ? { ...state, blocks } : state
    }
    return state
  },
  publication: match => match.event.type === 'assistant/chunk' ? 'animation-frame' : 'immediate',
  buildViewNode: (context) => {
    const state = context.state
    if (state === undefined) return null
    const interrupted = closedBoundary(context.matches.at(-1)?.location ?? context.start?.location)
    // Every block whose arguments decode at all, dispatched or not — used
    // only to tell "nothing ever decoded" (ambiguous, might be a retry in
    // flight) from "something decoded but this Definition currently renders
    // none of it" (an unconditional, one-way transition) below.
    const decoded: GenerativeCardData[] = []
    const cards: GenerativeCardData[] = []
    const entries = [...state.blocks.entries()].sort(([left], [right]) => left - right)
    for (const [, block] of entries) {
      const view = extractStreamArgs(block.argsRaw)
      if (view === null) continue
      const card: GenerativeCardData = {
        phase: block.complete ? 'complete' : interrupted ? 'interrupted' : 'streaming',
        title: view.title,
        height: view.height,
        html: view.html,
        loadingMessages: view.loadingMessages,
        callId: block.callId || undefined,
      }
      decoded.push(card)
      // A call the executor rejected never gets a card here: the row alone
      // shows the failure, exactly as it always has.
      if (block.dispatched && block.settled && block.isError) continue
      cards.push(card)
    }
    // Past an answer, park the card where compact-mode folding cannot reach
    // it — the row it covers folds away with the rest of the turn's
    // process, so the card must not share its anchor; before one, its
    // natural position tracks where the call is happening.
    const anchorSeq = state.lastMessageSeq !== null
      ? state.lastMessageSeq + ANSWER_ANCHOR_OFFSET
      : (state.anchorSeq || context.matches[0]?.event.seq || 0)
    const base = {
      key: context.key,
      kind: 'visualizer-stream',
      id: context.id,
      target: 'chat',
      anchorSeq,
      location: context.start?.location ?? context.matches[0]?.location ?? { kind: 'unresolved' },
    } as const
    if (decoded.length === 0) {
      // Never published anything, or the retry reset dropped the evidence:
      // withdraw only when no node is currently mounted.
      return context.current.get('chat') === undefined
        ? null
        : { ...base, visibility: 'hidden', data: { cards: [] } }
    }
    // Something decoded, but every one of it settled with an error: hiding
    // is unconditional and safe here, a one-way transition rather than a
    // retry's ambiguous "nothing yet."
    return cards.length > 0
      ? { ...base, visibility: 'visible', data: { cards } }
      : { ...base, visibility: 'hidden', data: { cards: [] } }
  },
}
