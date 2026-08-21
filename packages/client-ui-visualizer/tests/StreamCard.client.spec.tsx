// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen } from '@testing-library/react'
import type { ConversationSnapshot, SessionId, SessionListState, WorkspaceListState } from '@deepseek-ai/dsh-client-runtime/client'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'
// Pulls this package's LocaleNamespaceMap merge into the program so the
// composed props type carries the `t` seat (the merge lives in the entry).
import type {} from '../src/client/index.ts'
import { StreamCard, type StreamCardProps } from '../src/client/StreamCard.tsx'
import type { GenerativeCardData } from '../src/client/stream-node.ts'
import { en } from '../src/client/locales.ts'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const SID = 's1' as SessionId

/** Locale seat over the package dictionary; interpolates the single numeric param. */
const t = ((key: keyof typeof en, params?: Record<string, string | number>) =>
  en[key].replace(/\{(\w+)\}/g, (_m, name: string) => String(params?.[name] ?? ''))) as StreamCardProps['t']

/** Framework standard-kit stubs: the card consumes only the node and the locale seat. */
const kit = {
  sessionId: SID,
  useSession: (() => { throw new Error('unused') }) as unknown as SnapshotSelectorHook<ConversationSnapshot>,
  useSessions: (() => { throw new Error('unused') }) as unknown as SnapshotSelectorHook<SessionListState>,
  useWorkspaces: (() => { throw new Error('unused') }) as unknown as SnapshotSelectorHook<WorkspaceListState>,
  useProjection: (() => undefined) as never,
  useInput: (() => { throw new Error('unused') }) as never,
  inputActions: { setDraft: () => { throw new Error('unused') }, submit: () => { throw new Error('unused') } } as never,
  openFile: () => { throw new Error('unused') },
  inspectCall: () => { throw new Error('unused') },
  forkAt: () => { throw new Error('unused') },
  loadImage: () => Promise.reject(new Error('unused')),
  fileMentions: () => undefined,
  useTurnData: (() => { throw new Error('unused') }) as never,
}

function nodeOf(cards: readonly GenerativeCardData[]): StreamCardProps['node'] {
  return {
    key: 'k1', kind: 'generativeui-stream', id: '1:1', target: 'chat',
    anchorSeq: 5, location: { kind: 'unresolved' }, visibility: 'visible', data: { cards },
  } as unknown as StreamCardProps['node']
}

function renderCard(cards: readonly GenerativeCardData[]): void {
  render(<StreamCard node={nodeOf(cards)} t={t} {...kit} />)
}

describe('StreamCard', () => {
  it('renders a live streaming card with a null-origin shell frame', () => {
    renderCard([{ phase: 'streaming', title: 'Dash', height: 320, html: '<p>rev' }])
    const card = document.querySelector('[data-tool="render_html"][data-phase="streaming"]')
    expect(card).not.toBeNull()
    const frame = document.querySelector('iframe')
    expect(frame?.getAttribute('srcdoc')).toContain('dsh-gui-viewport')
    expect(frame?.getAttribute('sandbox')).toBe('allow-scripts')
    expect(frame?.getAttribute('title')).toBe('Dash')
    // The card opens at chat-line height; a height argument never pre-sizes
    // the streaming frame — measurements own the height.
    expect(frame?.style.height).toBe('32px')
    expect(screen.getByText('Streaming…')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Download HTML' })).toBeNull()
  })

  it('falls back to the generic title when args carried none', () => {
    renderCard([{ phase: 'streaming', title: null, height: null, html: '<p>x' }])
    const frame = document.querySelector('iframe')
    expect(frame?.getAttribute('title')).toBe('HTML preview')
    expect(frame?.style.height).toBe('32px')
  })

  it('grows and shrinks the frame to the content size the bridge reports', () => {
    renderCard([{ phase: 'streaming', title: 'Dash', height: 320, html: '<p>growing' }])
    const frame = document.querySelector('iframe')
    if (frame === null) throw new Error('frame not rendered')
    const report = (height: number): void => {
      act(() => {
        window.dispatchEvent(new MessageEvent('message', {
          data: { __dshGui: true, type: 'size', height },
          source: frame.contentWindow,
        }))
      })
    }

    // A size report from this frame's window drives the height, clamped to
    // the frame bounds; reports from other windows never match the source.
    report(212.4)
    expect(frame.style.height).toBe('213px')
    report(99_999)
    expect(frame.style.height).toBe('4000px')
    report(1)
    expect(frame.style.height).toBe('24px')
    window.dispatchEvent(new MessageEvent('message', { data: { __dshGui: true, type: 'size', height: 666 } }))
    expect(frame.style.height).toBe('24px')
  })

  it('offers a download on the complete card and materializes the bytes client-side', () => {
    const created = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:doc-1')
    const revoked = vi.spyOn(URL, 'revokeObjectURL').mockReturnValue()
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    renderCard([{ phase: 'complete', title: 'Rev "Q3"/dash', height: 400, html: '<p>done</p>' }])

    expect(screen.getByText('11 chars')).toBeTruthy()
    const button = screen.getByRole('button', { name: 'Download HTML' })
    button.click()

    expect(created).toHaveBeenCalledTimes(1)
    expect(revoked).toHaveBeenCalledWith('blob:doc-1')
    const anchor = click.mock.instances[0] as HTMLAnchorElement
    expect(anchor.download).toBe('Rev _Q3__dash.html')
  })

  it('marks an interrupted card and never offers its partial bytes', () => {
    renderCard([{ phase: 'interrupted', title: null, height: null, html: '<p>par' }])
    expect(screen.getByText('Interrupted; document incomplete')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Download HTML' })).toBeNull()
  })

  it('renders one card per streamed call of the step in block order', () => {
    renderCard([
      { phase: 'streaming', title: 'One', height: null, html: '<p>1' },
      { phase: 'streaming', title: 'Two', height: null, html: '<p>2' },
    ])
    expect(document.querySelectorAll('iframe')).toHaveLength(2)
    expect(document.querySelectorAll('[data-tool="render_html"]')).toHaveLength(2)
  })
})
