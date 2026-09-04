import { describe, expect, it } from 'vitest'
import type {
  ChatConversationViewNode, ConversationEventInput, ConversationNodeDefinition,
  ConversationViewBuilder, ConversationViewDefinition,
} from '@deepseek-ai/dsh-client-runtime/client'
import { ConversationNodeAssembler } from '@deepseek-ai/dsh-client-runtime/client'
import { selectVisualizerCards, visualizerTurnDefinition, type VisualizerTurnCard } from '../src/client/turn-tail.ts'

interface ProbeState {
  readonly turn: number
}

/**
 * Test-only companion Definition: exposes the shared per-turn location (and
 * therefore its `.data` store, the same one `visualizerTurnDefinition`
 * publishes into) as an ordinary Chat node, the way a real turn-tail owner
 * would reach it in production.
 */
const probeDefinition: ConversationNodeDefinition<ProbeState> = {
  kind: 'probe',
  target: 'chat',
  match: (event) => event.type === 'turn/start'
    ? { id: String((event.data as { turn: number }).turn), role: 'start' }
    : null,
  start: (_context, match) => {
    if (match.event.type !== 'turn/start') throw new Error('probe start requires turn/start')
    return { turn: (match.event.data as { turn: number }).turn }
  },
  buildViewNode: (context) => {
    const location = context.start?.location
    if (location === undefined || location.kind !== 'turn') return null
    return {
      key: context.key, kind: 'probe', id: context.id, target: 'chat', anchorSeq: 0, visibility: 'visible',
      location, data: {},
    }
  },
}

class TestEventDefinitions {
  entries(): readonly ConversationNodeDefinition[] {
    return [visualizerTurnDefinition, probeDefinition]
  }

  fallbackEntry(): ConversationNodeDefinition {
    return probeDefinition
  }
}

interface CollectedSnapshot {
  readonly nodes: readonly ChatConversationViewNode[]
}

/** Minimal chat-target builder: the latest materialized node set. */
class CollectingBuilder implements ConversationViewBuilder<ChatConversationViewNode, CollectedSnapshot> {
  private snapshot: CollectedSnapshot = { nodes: [] }
  readonly empty: CollectedSnapshot = { nodes: [] }
  replace(input: { readonly nodes: readonly ChatConversationViewNode[] }): CollectedSnapshot {
    this.snapshot = { nodes: input.nodes }
    return this.snapshot
  }
  apply(input: { readonly upserts: readonly ChatConversationViewNode[] }): CollectedSnapshot {
    const byKey = new Map(this.snapshot.nodes.map(node => [node.key, node]))
    for (const node of input.upserts) byKey.set(node.key, node)
    this.snapshot = { nodes: [...byKey.values()] }
    return this.snapshot
  }
}

class TestViewDefinitions {
  entries(): readonly ConversationViewDefinition[] {
    return [{
      target: 'chat',
      create: (): ConversationViewBuilder<ChatConversationViewNode, CollectedSnapshot> => new CollectingBuilder(),
    }]
  }
}

function at(seq: number, type: string, data: unknown): ConversationEventInput {
  return {
    event: { seq, time: 1_700_000_000_000 + seq, type, data } as unknown as ConversationEventInput['event'],
    view: undefined,
  }
}

function toolCall(seq: number, callId: string, args: unknown): ConversationEventInput {
  return at(seq, 'tool/call', { turn: 1, step: 1, callId, name: 'visualizer', arguments: JSON.stringify(args) })
}

function toolResult(seq: number, callId: string, isError = false): ConversationEventInput {
  return at(seq, 'tool/result', {
    turn: 1, step: 1,
    message: { source: { callId }, content: [{ isError }] },
  })
}

function assembler(entries: readonly ConversationEventInput[]): ConversationNodeAssembler {
  const value = new ConversationNodeAssembler(new TestEventDefinitions(), new TestViewDefinitions())
  value.replaceWindow(entries, false)
  value.flush()
  return value
}

/** This turn's cards, as a turn-tail owner with an unbounded closing seq would see them. */
function cardsFor(value: ConversationNodeAssembler, turn = 1): readonly VisualizerTurnCard[] | null {
  const nodes = (value.snapshot('chat') as CollectedSnapshot | undefined)?.nodes ?? []
  const probe = nodes.find(node => node.kind === 'probe')
  if (probe === undefined || probe.location.kind !== 'turn') return null
  expect(probe.location.turn.turn).toBe(turn)
  return selectVisualizerCards({ turn: probe.location.turn, seq: Number.POSITIVE_INFINITY, openFile: () => {} })
}

const ARGS = { title: 'Dash', html: '<!DOCTYPE html><p>revenue</p>' }

describe('visualizer-turn accumulator', () => {
  it('declines the chain before any call settles', () => {
    const value = assembler([
      at(1, 'turn/start', { turn: 1 }),
      toolCall(2, 'call-1', ARGS),
    ])
    expect(cardsFor(value)).toBeNull()
  })

  it('accumulates one settled successful call', () => {
    const value = assembler([
      at(1, 'turn/start', { turn: 1 }),
      toolCall(2, 'call-1', ARGS),
      toolResult(3, 'call-1'),
    ])
    expect(cardsFor(value)).toEqual([{ callId: 'call-1', seq: 3, argsRaw: JSON.stringify(ARGS) }])
  })

  it('excludes a failed call', () => {
    const value = assembler([
      at(1, 'turn/start', { turn: 1 }),
      toolCall(2, 'call-1', ARGS),
      toolResult(3, 'call-1', true),
    ])
    expect(cardsFor(value)).toBeNull()
  })

  it('ignores tool/result events for calls it never dispatched', () => {
    const value = assembler([
      at(1, 'turn/start', { turn: 1 }),
      toolResult(2, 'call-9'),
    ])
    expect(cardsFor(value)).toBeNull()
  })

  it('keeps multiple settled calls in dispatch order', () => {
    const value = assembler([
      at(1, 'turn/start', { turn: 1 }),
      toolCall(2, 'call-1', { title: 'First', html: '<p>1</p>' }),
      toolResult(3, 'call-1'),
      toolCall(4, 'call-2', { title: 'Second', html: '<p>2</p>' }),
      toolResult(5, 'call-2'),
    ])
    expect(cardsFor(value)?.map(card => card.callId)).toEqual(['call-1', 'call-2'])
  })

  it('does not confuse a foreign tool call with the same call id', () => {
    const value = assembler([
      at(1, 'turn/start', { turn: 1 }),
      at(2, 'tool/call', { turn: 1, step: 1, callId: 'call-1', name: 'bash', arguments: '{"command":"ls"}' }),
      toolResult(3, 'call-1'),
    ])
    expect(cardsFor(value)).toBeNull()
  })
})
