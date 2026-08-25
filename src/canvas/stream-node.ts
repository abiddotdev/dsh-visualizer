/**
 * Live-preview Conversation Node for the `canvas_draw` tool: folds streamed
 * `canvas_draw` call arguments into the canvas-scene anchor — a marker card
 * is NOT rendered (the canvas popup owns the surface); the node exists to
 * publish CanvasChatData describing the live front so the dock popup can
 * react to streaming (paint partial strokes, show "drawing…" state).
 *
 * @module dsh-visualizer/canvas/stream-node
 */

import type {
  ConversationLocation, ConversationNodeDefinition,
} from '@deepseek-ai/dsh-client-runtime/client'
import { extractCanvasStreamArgs } from './stream-args.ts'
import type { CanvasOp } from './types.ts'

/** Wire Tool name this node keys on. */
export const CANVAS_TOOL_NAME = 'canvas_draw'

/** Chat payload of the live canvas node. */
export interface CanvasStreamChatData {
  /** Live canvas batches of one Assistant step, in block order. */
  readonly batches: readonly CanvasStreamBatch[]
}

/** One live canvas_draw call block derived from streaming arguments. */
export interface CanvasStreamBatch {
  readonly phase: 'streaming' | 'complete' | 'interrupted'
  /** Whether this batch clears the scene first. */
  readonly clear: boolean
  /** Complete ops decoded so far. */
  readonly ops: readonly CanvasOp[]
  /** Trailing partial op, when the stream cut inside one. */
  readonly partialOp: ReturnType<typeof extractCanvasStreamArgs> extends infer V
    ? V extends { partial: infer P } ? P : never
    : never
}

/** Accumulated tool-call block of this step, kept only for canvas_draw. */
interface StreamBlock {
  readonly callId: string
  readonly name: string
  readonly argsRaw: string
  readonly complete: boolean
}

interface StreamState {
  readonly turn: number
  readonly step: number
  readonly anchorSeq: number
  readonly blocks: ReadonlyMap<number, StreamBlock>
  readonly dispatched: readonly string[]
  readonly finalized: boolean
}

declare module '@deepseek-ai/dsh-client-ui-conversation/client' {
  interface ChatNodeDataMap {
    /** Live canvas batches of one Assistant step. */
    'visualizer-canvas-stream': CanvasStreamChatData
  }
}

function initialState(turn: number, step: number, anchorSeq: number): StreamState {
  return { turn, step, anchorSeq, blocks: new Map(), dispatched: [], finalized: false }
}

function foldDelta(
  state: StreamState, index: number, callId: string, name: string | undefined, delta: string, seq: number,
): StreamState {
  const previous = state.blocks.get(index)
  if (previous?.complete === true) return state
  const known = name ?? previous?.name ?? ''
  if (known !== '' && known !== CANVAS_TOOL_NAME) {
    if (previous === undefined) return state
    const blocks = new Map(state.blocks)
    blocks.delete(index)
    return { ...state, blocks }
  }
  const blocks = new Map(state.blocks)
  blocks.set(index, { callId: callId || previous?.callId || '', name: known, argsRaw: (previous?.argsRaw ?? '') + delta, complete: false })
  return { ...state, blocks, anchorSeq: state.blocks.size === 0 ? seq : state.anchorSeq }
}

function foldFinalBlock(
  state: StreamState, index: number, block: { id: unknown; name: string; arguments: string }, seq: number,
): StreamState {
  if (block.name !== CANVAS_TOOL_NAME) {
    if (!state.blocks.has(index)) return state
    const blocks = new Map(state.blocks)
    blocks.delete(index)
    return { ...state, blocks }
  }
  const blocks = new Map(state.blocks)
  blocks.set(index, { callId: String(block.id), name: block.name, argsRaw: block.arguments, complete: true })
  return { ...state, blocks, anchorSeq: state.blocks.size === 0 ? seq : state.anchorSeq }
}

function closedBoundary(location: ConversationLocation | undefined): boolean {
  if (location === undefined) return false
  if (location.kind === 'step' && location.step.status === 'closed') return true
  return (location.kind === 'step' || location.kind === 'turn') && location.turn.status === 'closed'
}

/** The canvas live-batch Conversation Node Definition. */
export const canvasStreamDefinition: ConversationNodeDefinition<StreamState> = {
  kind: 'visualizer-canvas-stream',
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
    if (event.type === 'tool/call' && event.data.name === CANVAS_TOOL_NAME) {
      return { id: `${event.data.turn}:${event.data.step}`, role: 'update' }
    }
    return null
  },
  start: (_context, match) => {
    if (match.event.type !== 'step/start') throw new Error('visualizer-canvas-stream start requires step/start')
    return initialState(match.event.data.turn, match.event.data.step, match.event.seq)
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
    const batches: CanvasStreamBatch[] = []
    const live: CanvasStreamBatch[] = []
    const blocks = [...state.blocks.entries()].sort((left, right) => left[0] - right[0])
    for (const [, block] of blocks) {
      const view = extractCanvasStreamArgs(block.argsRaw)
      if (view === null) continue
      const batch: CanvasStreamBatch = {
        phase: block.complete ? 'complete' : interrupted ? 'interrupted' : 'streaming',
        clear: view.clear,
        ops: view.ops,
        partialOp: view.partial,
      }
      batches.push(batch)
      if (!state.dispatched.includes(block.callId)) live.push(batch)
    }
    const anchorSeq = state.anchorSeq || context.matches[0]?.event.seq || 0
    const base = {
      key: context.key,
      kind: 'visualizer-canvas-stream',
      id: context.id,
      target: 'chat',
      anchorSeq,
      location: context.start?.location ?? context.matches[0]?.location ?? { kind: 'unresolved' },
    } as const
    // The canvas popup — not the chat — owns the surface: this node renders
    // no card in the flow. It still publishes (visible or hidden) so the
    // dock can read live batches off the node registry.
    if (batches.length === 0) {
      return context.current.get('chat') === undefined
        ? null
        : { ...base, visibility: 'hidden', data: { batches: [] } }
    }
    return live.length > 0
      ? { ...base, visibility: 'hidden', data: { batches: live } }
      : { ...base, visibility: 'hidden', data: { batches: [] } }
  },
}
