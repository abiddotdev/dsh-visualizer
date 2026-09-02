import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  ChatConversationViewNode, ConversationEventInput, ConversationNodeDefinition,
  ConversationViewBuilder, ConversationViewDefinition,
} from '@deepseek-ai/dsh-client-runtime/client'
import { ConversationNodeAssembler } from '@deepseek-ai/dsh-client-runtime/client'
import { generativeStreamDefinition, type GenerativeStreamChatData } from '../src/client/stream-node.ts'
import { CHAT_PREVIEW_BOOT_GLOBAL } from '../src/shared/chat-preview.ts'

afterEach(() => {
  vi.unstubAllGlobals()
})

class TestEventDefinitions {
  entries(): readonly ConversationNodeDefinition[] {
    return [generativeStreamDefinition]
  }

  fallbackEntry(): ConversationNodeDefinition {
    return generativeStreamDefinition
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
  return collected(value).find(candidate => candidate.kind === 'visualizer-stream')
}

function data(value: ConversationNodeAssembler): GenerativeStreamChatData | undefined {
  return node(value)?.data as GenerativeStreamChatData | undefined
}

const CALL_ARGS = { title: 'Dash', height: 320, html: '<!DOCTYPE html><p>revenue</p>' }

/** The event prefix of one visualizer turn, up to but excluding the closer under test. */
function streamPrefix(seq: number): ConversationEventInput[] {
  return [
    at(seq, 'turn/start', { turn: 1 }),
    at(seq + 1, 'step/start', { turn: 1, step: 1 }),
    at(seq + 2, 'assistant/chunk', { turn: 1, step: 1, chunk: { type: 'block-start', index: 0, blockType: 'tool-call' } }),
    at(seq + 3, 'assistant/chunk', {
      turn: 1, step: 1,
      chunk: { type: 'tool-call-delta', index: 0, id: 'call-1', name: 'visualizer', argumentsDelta: '{"title":"Dash","height":320,"html":"<p>rev' },
    }),
  ]
}

describe('visualizer-stream node', () => {
  it('publishes a streaming card once the html prefix is decodable', () => {
    const value = assembler(streamPrefix(1))
    const current = node(value)
    expect(current?.visibility).toBe('visible')
    expect(data(value)?.cards).toEqual([{ phase: 'streaming', title: 'Dash', height: 320, html: '<p>rev', loadingMessages: [], callId: 'call-1' }])
  })

  it('stays unpublished while another tool streams and ignores its arguments', () => {
    const value = assembler([
      at(1, 'turn/start', { turn: 1 }),
      at(2, 'step/start', { turn: 1, step: 1 }),
      at(3, 'assistant/chunk', {
        turn: 1, step: 1,
        chunk: { type: 'tool-call-delta', index: 0, id: 'call-9', name: 'bash', argumentsDelta: '{"command":"ls -la"}' },
      }),
    ])
    expect(node(value)).toBeUndefined()
  })

  it('commits the complete document at block-end and keeps the same node key', () => {
    const argsJson = JSON.stringify(CALL_ARGS)
    const value = assembler([
      ...streamPrefix(1),
      at(5, 'assistant/chunk', {
        turn: 1, step: 1,
        chunk: { type: 'block-end', index: 0, block: { type: 'tool-call', id: 'call-1', name: 'visualizer', arguments: argsJson } },
      }),
    ])
    const streaming = node(value)
    expect(data(value)?.cards).toEqual([{ phase: 'complete', title: 'Dash', height: 320, html: CALL_ARGS.html, loadingMessages: [], callId: 'call-1' }])
    expect(node(value)?.key).toBe(streaming?.key)
  })

  it('hides the card when the tool/call dispatches, ceding the flow to the keyed toolview row', () => {
    const value = assembler([
      ...streamPrefix(1),
      at(5, 'assistant/message', {
        turn: 1, step: 1,
        message: { id: 'm1', role: 'assistant', content: [{ type: 'tool-call', id: 'call-1', name: 'visualizer', arguments: JSON.stringify(CALL_ARGS) }] },
      }),
      at(6, 'tool/call', { callId: 'call-1', name: 'visualizer', turn: 1, step: 1, arguments: CALL_ARGS }),
    ])
    expect(node(value)?.visibility).toBe('hidden')
    expect(data(value)?.cards).toEqual([])
  })

  it('marks an unterminated stream interrupted when the step closes without a final message', () => {
    const value = assembler([
      ...streamPrefix(1),
      at(5, 'step/end', { turn: 1, step: 1 }),
    ])
    expect(data(value)?.cards).toEqual([{ phase: 'interrupted', title: 'Dash', height: 320, html: '<p>rev', loadingMessages: [], callId: 'call-1' }])
  })

  it('withdraws the evidence on model retry and re-anchors a fresh attempt', () => {
    const retried = assembler([
      ...streamPrefix(1),
      at(5, 'llm/retry', { turn: 1, step: 1 }),
    ])
    // No node is currently mounted for the retried attempt: nothing to keep.
    expect(node(retried)).toBeUndefined()

    const second = assembler([
      ...streamPrefix(1),
      at(5, 'llm/retry', { turn: 1, step: 1 }),
      at(6, 'assistant/chunk', {
        turn: 1, step: 1,
        chunk: { type: 'tool-call-delta', index: 0, id: 'call-2', name: 'visualizer', argumentsDelta: '{"html":"<p>two"}' },
      }),
    ])
    const current = node(second)
    expect(current?.visibility).toBe('visible')
    expect(current?.anchorSeq).toBe(6)
    expect(data(second)?.cards).toEqual([{ phase: 'streaming', title: null, height: null, html: '<p>two', loadingMessages: [], callId: 'call-2' }])
  })

  it('produces the same settled result through replay as live append produced', () => {
    const events = [
      ...streamPrefix(1),
      at(5, 'assistant/message', {
        turn: 1, step: 1,
        message: { id: 'm1', role: 'assistant', content: [{ type: 'tool-call', id: 'call-1', name: 'visualizer', arguments: JSON.stringify(CALL_ARGS) }] },
      }),
    ]
    const replayed = data(assembler(events))
    expect(replayed?.cards).toEqual([{ phase: 'complete', title: 'Dash', height: 320, html: CALL_ARGS.html, loadingMessages: [], callId: 'call-1' }])
  })
})

describe('visualizer-stream node with chatPreview live', () => {
  function enable(): void {
    vi.stubGlobal(CHAT_PREVIEW_BOOT_GLOBAL, '1')
  }

  const dispatchEvent = (seq: number, callId = 'call-1'): ConversationEventInput =>
    at(seq, 'tool/call', { callId, name: 'visualizer', turn: 1, step: 1, arguments: CALL_ARGS })

  const settleEvent = (seq: number, callId = 'call-1', isError = false): ConversationEventInput =>
    at(seq, 'tool/result', { turn: 1, step: 1, message: { source: { callId }, content: [{ isError }] } })

  const finalMessage = (seq: number): ConversationEventInput => at(seq, 'assistant/message', {
    turn: 1, step: 1,
    message: { id: 'm1', role: 'assistant', content: [{ type: 'tool-call', id: 'call-1', name: 'visualizer', arguments: JSON.stringify(CALL_ARGS) }] },
  })

  it('keeps rendering once dispatched, pending settlement', () => {
    enable()
    const value = assembler([...streamPrefix(1), finalMessage(5), dispatchEvent(6)])
    expect(node(value)?.visibility).toBe('visible')
    expect(data(value)?.cards).toEqual([
      { phase: 'complete', title: 'Dash', height: 320, html: CALL_ARGS.html, loadingMessages: [], callId: 'call-1' },
    ])
  })

  it('keeps rendering with settled controls once tool/result lands clean', () => {
    enable()
    const value = assembler([...streamPrefix(1), finalMessage(5), dispatchEvent(6), settleEvent(7)])
    expect(node(value)?.visibility).toBe('visible')
    expect(data(value)?.cards).toEqual([
      { phase: 'complete', title: 'Dash', height: 320, html: CALL_ARGS.html, loadingMessages: [], callId: 'call-1' },
    ])
  })

  it('withdraws the card once the call settles with an error, leaving the row to show it', () => {
    enable()
    const value = assembler([...streamPrefix(1), finalMessage(5), dispatchEvent(6), settleEvent(7, 'call-1', true)])
    expect(node(value)?.visibility).toBe('hidden')
    expect(data(value)?.cards).toEqual([])
  })

  it('anchors past the turn\'s latest assistant message once dispatched', () => {
    enable()
    const value = assembler([...streamPrefix(1), finalMessage(5), dispatchEvent(6)])
    expect(node(value)?.anchorSeq).toBe(5.05)
  })

  it('keeps the natural anchor while still streaming, before any answer', () => {
    enable()
    const value = assembler(streamPrefix(1))
    expect(node(value)?.anchorSeq).toBe(4)
  })

  it('still hides on dispatch when the host never announced the feature', () => {
    const value = assembler([...streamPrefix(1), finalMessage(5), dispatchEvent(6)])
    expect(node(value)?.visibility).toBe('hidden')
    expect(data(value)?.cards).toEqual([])
  })
})
