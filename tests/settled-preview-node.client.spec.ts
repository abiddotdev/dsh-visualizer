import { describe, expect, it } from 'vitest'
import type {
  ChatConversationViewNode, ConversationEventInput, ConversationNodeDefinition,
  ConversationViewBuilder, ConversationViewDefinition,
} from '@deepseek-ai/dsh-client-runtime/client'
import { ConversationNodeAssembler } from '@deepseek-ai/dsh-client-runtime/client'
import { settledPreviewDefinition, type GenerativePreviewChatData } from '../src/client/settled-preview-node.ts'

class TestEventDefinitions {
  entries(): readonly ConversationNodeDefinition[] {
    return [settledPreviewDefinition]
  }

  fallbackEntry(): ConversationNodeDefinition | undefined {
    return undefined
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

function assembler(entries: readonly ConversationEventInput[]): ConversationNodeAssembler {
  const value = new ConversationNodeAssembler(new TestEventDefinitions(), new TestViewDefinitions())
  value.replaceWindow(entries, false)
  value.flush()
  return value
}

function collected(value: ConversationNodeAssembler): readonly ChatConversationViewNode[] {
  return (value.snapshot('chat') as CollectedSnapshot | undefined)?.nodes ?? []
}

function node(value: ConversationNodeAssembler): ChatConversationViewNode | undefined {
  return collected(value).find(candidate => candidate.kind === 'visualizer-preview')
}

function data(value: ConversationNodeAssembler): GenerativePreviewChatData | undefined {
  return node(value)?.data as GenerativePreviewChatData | undefined
}

function toolCall(seq: number, callId: string, args: unknown, turn = 1, step = 1): ConversationEventInput {
  return at(seq, 'tool/call', { turn, step, callId, name: 'visualizer', arguments: JSON.stringify(args) })
}

function toolResult(seq: number, callId: string, isError = false, turn = 1, step = 1): ConversationEventInput {
  return at(seq, 'tool/result', { turn, step, message: { source: { callId }, content: [{ isError }] } })
}

function assistantMessage(seq: number, turn = 1, step = 1): ConversationEventInput {
  return at(seq, 'assistant/message', { turn, step, message: { id: `m${seq}`, role: 'assistant', content: [] } })
}

const CALL_ARGS = { title: 'Dash', height: 320, html: '<!DOCTYPE html><p>revenue</p>' }

describe('visualizer-preview node', () => {
  it('stays unmounted while a call is only running', () => {
    const value = assembler([
      at(1, 'turn/start', { turn: 1 }),
      toolCall(2, 'call-1', CALL_ARGS),
    ])
    expect(node(value)).toBeUndefined()
  })

  it('publishes the settled document once the call resolves clean', () => {
    const value = assembler([
      at(1, 'turn/start', { turn: 1 }),
      toolCall(2, 'call-1', CALL_ARGS),
      toolResult(3, 'call-1'),
    ])
    const current = node(value)
    expect(current?.visibility).toBe('visible')
    expect(data(value)?.previews).toEqual([
      { callId: 'call-1', title: 'Dash', height: 320, html: CALL_ARGS.html },
    ])
  })

  it('never mounts a call that settled with an error', () => {
    const value = assembler([
      at(1, 'turn/start', { turn: 1 }),
      toolCall(2, 'call-1', CALL_ARGS),
      toolResult(3, 'call-1', true),
    ])
    expect(node(value)).toBeUndefined()
  })

  it('lists two calls of the same turn in call order', () => {
    const second = { title: 'Two', html: '<p>two' }
    const value = assembler([
      at(1, 'turn/start', { turn: 1 }),
      toolCall(2, 'call-1', CALL_ARGS),
      toolResult(3, 'call-1'),
      toolCall(4, 'call-2', second),
      toolResult(5, 'call-2'),
    ])
    expect(data(value)?.previews.map(preview => preview.callId)).toEqual(['call-1', 'call-2'])
  })

  it('anchors past the turn\'s latest assistant message once one lands', () => {
    const value = assembler([
      at(1, 'turn/start', { turn: 1 }),
      toolCall(2, 'call-1', CALL_ARGS),
      toolResult(3, 'call-1'),
      assistantMessage(4),
    ])
    expect(node(value)?.anchorSeq).toBe(4.05)
  })

  it('anchors at the first evidence seq before any assistant message lands', () => {
    const value = assembler([
      at(1, 'turn/start', { turn: 1 }),
      toolCall(2, 'call-1', CALL_ARGS),
      toolResult(3, 'call-1'),
    ])
    expect(node(value)?.anchorSeq).toBe(2.05)
  })
})
