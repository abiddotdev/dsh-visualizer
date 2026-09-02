/**
 * Settled-preview Conversation Node for the `visualizer` tool. When a call's
 * `tool/result` lands clean, this Definition promotes the document into its
 * own chat node so the finished artifact stays visible in the flow —
 * including compact transcript mode, where the keyed `tool.call.toolview`
 * row folds away with the rest of the turn's process. The node anchors just
 * past the turn's latest `assistant/message` (the same never-folded region
 * the harness's turn-tail occupies, at a smaller offset so the tail keeps its
 * place), so the fold window never covers it once the turn closes; while the
 * turn is still open nothing folds anyway and the preview shows where the
 * call happened. The keyed tool row suppresses its own frame for exactly the
 * calls a mounted preview covers ({@link ./preview-coverage.ts}), and the
 * two surfaces never double-render. Replaying the log reproduces the same
 * sequence deterministically. The Definition itself always registers; a
 * deployment with `chatPreview` disabled never contributes a preview, since
 * {@link chatPreviewEnabled} gates `buildViewNode`'s output instead.
 */

import type {
  ConversationNodeDefinition,
} from '@deepseek-ai/dsh-client-ui-conversation/client'
import { TOOL_NAME } from './stream-node.ts'
import { argsView } from './settled-document.ts'
import { CHAT_PREVIEW_BOOT_GLOBAL } from '../shared/chat-preview.ts'

/**
 * Whether the host announced the settled-preview feature: the served page
 * carries a `globalThis` flag the boot table pushes only while `chatPreview`
 * is live ({@link ./boot-table.ts}), so a deployment that disabled it never
 * sets the flag. Read fresh on every {@link settledPreviewDefinition.buildViewNode}
 * call — same as the share control's {@link exportShareEnabled} — rather than
 * cached once at plugin `apply()`: the boot script that sets the flag is not
 * guaranteed to have run yet at that early, synchronous point, so a one-time
 * check there can permanently latch "disabled" for the rest of the page's
 * life even though the flag is set moments later.
 * @returns true only where the host announced the feature.
 */
export function chatPreviewEnabled(): boolean {
  return typeof (globalThis as unknown as Record<string, unknown>)[CHAT_PREVIEW_BOOT_GLOBAL] === 'string'
}

/** Fractional anchor offset past the turn's latest assistant message. The
 * harness's own synthetic offsets end at 0.1 (`finalizedFollowup`, the
 * turn-tail row), so a smaller fraction parks the preview between the
 * answer and the tail while staying outside the compact-mode fold window. */
const ANSWER_ANCHOR_OFFSET = 0.05

/** One settled visualizer document promoted into the chat flow. */
export interface GenerativePreviewData {
  /** The settled call this preview renders; keys the row's coverage check. */
  readonly callId: string
  /** Explicit `title` argument once decodable, else null (view shows its fallback). */
  readonly title: string | null
  /** Explicit `height` argument once decodable, else null (view falls back to the default). */
  readonly height: number | null
  /** The complete document. */
  readonly html: string
}

/** Chat payload of the settled-preview node: the turn's clean settles, in call order. */
export interface GenerativePreviewChatData {
  readonly previews: readonly GenerativePreviewData[]
}

/** One visualizer call tracked from its `tool/call` to its `tool/result`. */
interface PreviewCall {
  readonly callId: string
  readonly step: number
  /** The complete arguments as logged by `tool/call` — the document's home. */
  readonly argsRaw: string
  readonly settled: boolean
  readonly isError: boolean
}

/** Turn-scoped State: every visualizer call of the turn, plus anchor evidence. */
interface PreviewState {
  readonly turn: number
  /** Seq of the turn's first visualizer evidence; the anchor before any message lands. */
  readonly anchorSeq: number
  /** Latest `assistant/message` seq of the turn; the anchor once one arrives. */
  readonly lastMessageSeq: number | null
  /** Tracked calls by call id; Map insertion order preserves call order. */
  readonly calls: ReadonlyMap<string, PreviewCall>
}

declare module '@deepseek-ai/dsh-client-ui-chat/client' {
  interface ChatNodeDataMap {
    /** Settled visualizer documents of one turn, shown straight in the chat flow. */
    'visualizer-preview': GenerativePreviewChatData
  }
}

function initialState(turn: number, anchorSeq: number): PreviewState {
  return { turn, anchorSeq, lastMessageSeq: null, calls: new Map() }
}

/** The settled-preview chat node Definition. */
export const settledPreviewDefinition: ConversationNodeDefinition<PreviewState> = {
  kind: 'visualizer-preview',
  target: 'chat',
  match: (event) => {
    if (event.type === 'turn/start') return { id: String(event.data.turn), role: 'start' }
    if (event.type === 'tool/call' && event.data.name === TOOL_NAME) {
      return { id: String(event.data.turn), role: 'update' }
    }
    // Results and messages of any tool/name route here too — the update fold
    // discards those that concern no tracked call, and matching broadly keeps
    // the answer anchor tracking every message of the turn.
    if (event.type === 'tool/result' || event.type === 'assistant/message') {
      return { id: String(event.data.turn), role: 'update' }
    }
    return null
  },
  start: (_context, match) => {
    if (match.event.type !== 'turn/start') throw new Error('visualizer-preview start requires turn/start')
    return initialState(match.event.data.turn, match.event.seq)
  },
  update: (context, match) => {
    const state = context.state
    const event = match.event
    if (event.type === 'tool/call') {
      const callId = String(event.data.callId)
      const calls = new Map(state.calls)
      calls.set(callId, {
        callId,
        step: event.data.step,
        argsRaw: event.data.arguments,
        settled: false,
        isError: false,
      })
      // A re-logged call keeps its first-seen slot (Map.set preserves the
      // original insertion position); the anchor follows only fresh evidence.
      return { ...state, calls, anchorSeq: state.calls.size === 0 ? event.seq : state.anchorSeq }
    }
    if (event.type === 'tool/result') {
      const callId = String(event.data.message.source.callId)
      const tracked = state.calls.get(callId)
      if (tracked === undefined) return state
      const block = event.data.message.content[0]
      const calls = new Map(state.calls)
      calls.set(callId, { ...tracked, settled: true, isError: block?.isError === true })
      return { ...state, calls }
    }
    if (event.type === 'assistant/message') {
      return { ...state, lastMessageSeq: event.seq }
    }
    return state
  },
  buildViewNode: (context) => {
    const state = context.state
    if (state === undefined) return null
    const previews: GenerativePreviewData[] = []
    // Checked fresh, not at registration time: see chatPreviewEnabled's doc.
    // A disabled deployment never contributes a preview, so the row below
    // keeps its settled frame outright.
    if (chatPreviewEnabled()) {
      for (const call of state.calls.values()) {
        if (!call.settled || call.isError) continue
        const view = argsView(call.argsRaw)
        if (view === null) continue
        previews.push({ callId: call.callId, title: view.title, height: view.height, html: view.html })
      }
    }
    const anchorSeq = (state.lastMessageSeq ?? state.anchorSeq) + ANSWER_ANCHOR_OFFSET
    const base = {
      key: context.key,
      kind: 'visualizer-preview',
      id: context.id,
      target: 'chat',
      anchorSeq,
      location: context.start?.location ?? context.matches[0]?.location ?? { kind: 'unresolved' },
    } as const
    if (previews.length === 0) {
      // Nothing renderable yet — an interrupted or failed settle, or no
      // settle at all. Withdraw only when no node is currently mounted, so a
      // retry reset never flickers the flow.
      return context.current.get('chat') === undefined
        ? null
        : { ...base, visibility: 'hidden', data: { previews: [] } }
    }
    return { ...base, visibility: 'visible', data: { previews } }
  },
}
