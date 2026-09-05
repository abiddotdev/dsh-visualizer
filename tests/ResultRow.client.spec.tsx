// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
import type { ConversationSnapshot, SessionId, SessionListState, WorkspaceListState } from '@deepseek-ai/dsh-client-runtime/client'
import type { ToolCallBlock } from '@deepseek-ai/dsh-client-runtime/client'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'
// Pulls this package's LocaleNamespaceMap merge into the program so the
// composed props type carries the `t` seat (the merge lives in the entry).
import type {} from '../src/client/index.ts'
import { ResultRow, type ResultRowProps } from '../src/client/ResultRow.tsx'
import { en } from '../src/client/locales.ts'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const SID = 's1' as SessionId

/** Locale seat over the package dictionary; interpolates the single numeric param. */
const t = ((key: keyof typeof en, params?: Record<string, string | number>) =>
  en[key].replace(/\{(\w+)\}/g, (_m, name: string) => String(params?.[name] ?? ''))) as ResultRowProps['t']

/** Framework standard-kit stubs: the card consumes only the block, inputActions, and the locale seat. */
const kit = {
  sessionId: SID,
  useSession: (() => { throw new Error('unused') }) as unknown as SnapshotSelectorHook<ConversationSnapshot>,
  useSessions: (() => { throw new Error('unused') }) as unknown as SnapshotSelectorHook<SessionListState>,
  useWorkspaces: (() => { throw new Error('unused') }) as unknown as SnapshotSelectorHook<WorkspaceListState>,
  useProjection: (() => undefined) as never,
  useInput: (() => { throw new Error('unused') }) as never,
  inputActions: { setDraft: () => { throw new Error('unused') }, submit: () => { throw new Error('unused') } } as never,
}

function props(block: ToolCallBlock): ResultRowProps {
  return {
    callId: 'c1',
    toolName: 'visualizer',
    block,
    openFile: () => { throw new Error('unused') },
    ...kit,
    t,
  }
}

function runningBlock(argsRaw: string): ToolCallBlock {
  return {
    callId: 'c1', name: 'visualizer', argsRaw, turn: 1, step: 1, time: 0, callView: null, subCalls: [],
  }
}

/** Result content blocks, as the harness hands them to a settled view. */
type ResultContent = Extract<ToolCallBlock, { kind: 'tool-result' }>['content']

function settledBlock(argsRaw: string | null, isError = false, content: unknown[] = []): ToolCallBlock {
  return {
    kind: 'tool-result', seq: 2, time: 0, callId: 'c1',
    call: argsRaw === null ? null : { name: 'visualizer', argsRaw },
    callTime: 0, content: content as ResultContent, isError,
    ...isError ? { error: { name: 'Error', code: 'E_TOOL' } } : {},
    callView: null, resultView: null, subCalls: [],
  }
}

const DOC = '<!DOCTYPE html><html><body><p>revenue</p></body></html>'

describe('ResultRow', () => {
  it('renders the live frame while the call runs — the full experience, not a stub', () => {
    render(<ResultRow {...props(runningBlock(JSON.stringify({ title: 'Dash', html: DOC })))} />)

    expect(document.querySelector('iframe')).not.toBeNull()
    expect(document.querySelector('[class*="streamSweep"]')).toBeTruthy()
    expect(screen.getByText('Rendering…')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Download HTML' })).toBeNull()
  })

  it('keeps the frame in place, with full chrome, once the call settles successfully', () => {
    render(<ResultRow {...props(settledBlock(JSON.stringify({ title: 'Dash', html: DOC })))} />)

    expect(document.querySelector('iframe')).not.toBeNull()
    expect(document.querySelector('[class*="streamSweep"]')).toBeNull()
    expect(screen.getByRole('button', { name: 'Download HTML' })).toBeTruthy()
  })

  it('names the failure code on an error result and renders no frame', () => {
    render(<ResultRow {...props(settledBlock(JSON.stringify({ html: DOC }), true))} />)

    expect(document.querySelector('iframe')).toBeNull()
    // The alert icon carries the failure; its native tooltip holds the
    // logged error.
    const alert = document.querySelector<HTMLElement>('[title="Error: E_TOOL"]')
    expect(alert).not.toBeNull()
    expect(alert?.getAttribute('aria-label')).toBe('Error: E_TOOL')
  })

  it('states the cause of a failed call from the result content', () => {
    const cause = 'the document is 300000 bytes, over the 262144-byte render limit'
    render(<ResultRow {...props(settledBlock(JSON.stringify({ html: DOC }), true, [{ type: 'text', text: cause }]))} />)

    // `error` carries only "Error: E_TOOL"; the thrown message is the only
    // thing that tells the reader what to change.
    expect(screen.getByText(cause)).toBeTruthy()
    expect(document.querySelector<HTMLElement>('[title="Error: E_TOOL"]')).not.toBeNull()
  })

  it('bounds a long cause and skips non-text blocks on the way to it', () => {
    const cause = 'x'.repeat(400)
    render(<ResultRow {...props(settledBlock(null, true, [
      { type: 'image', attachment: {} },
      { type: 'text', text: `  ${cause}  ` },
      { type: 'text', text: 'later block, never shown' },
    ]))} />)

    expect(screen.getByText('x'.repeat(160))).toBeTruthy()
    expect(screen.queryByText(/later block/)).toBeNull()
  })

  it('leaves the summary empty when a failed result carries no message', () => {
    render(<ResultRow {...props(settledBlock(null, true, [{ type: 'text', text: '   ' }]))} />)

    expect(document.querySelector('iframe')).toBeNull()
    expect(screen.queryByText('Call arguments carry no renderable HTML')).toBeNull()
    expect(document.querySelector<HTMLElement>('[title="Error: E_TOOL"]')).not.toBeNull()
  })

  it('falls back to the missing-summary when the arguments carry no document', () => {
    render(<ResultRow {...props(settledBlock('{"title":"x"}'))} />)

    expect(document.querySelector('iframe')).toBeNull()
    expect(screen.getByText('Call arguments carry no renderable HTML')).toBeTruthy()
  })

  it('forwards the framework inspect callback to the trajectory-jump control', () => {
    const inspect = vi.fn()
    render(<ResultRow {...{ ...props(settledBlock(JSON.stringify({ title: 'Dash', html: DOC }))), inspect }} />)

    screen.getByRole('button', { name: 'Inspect' }).click()
    expect(inspect).toHaveBeenCalledTimes(1)
  })

  it('shows no inspect control when the framework offers no callback', () => {
    render(<ResultRow {...props(settledBlock(JSON.stringify({ title: 'Dash', html: DOC })))} />)
    expect(screen.queryByRole('button', { name: 'Inspect' })).toBeNull()
  })
})
