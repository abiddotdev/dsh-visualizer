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
import { REVOKE_DELAY_MS, COPY_FEEDBACK_MS } from '../src/client/download.ts'
import { WIDGET_PROMPT_MIN_INTERVAL_MS } from '../src/client/AutoFrame.tsx'
import { en } from '../src/client/locales.ts'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.useRealTimers()
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
    key: 'k1', kind: 'visualizer-stream', id: '1:1', target: 'chat',
    anchorSeq: 5, location: { kind: 'unresolved' }, visibility: 'visible', data: { cards },
  } as unknown as StreamCardProps['node']
}

function renderCard(cards: readonly GenerativeCardData[]): void {
  render(<StreamCard node={nodeOf(cards)} t={t} {...kit} />)
}

/** Click and flush the copy promise chain plus its React update. */
async function flushClick(click: () => void): Promise<void> {
  await act(async () => { click() })
}

/** Advance fake time inside act so the reverted label re-renders. */
function elapse(ms: number): void {
  act(() => { vi.advanceTimersByTime(ms) })
}

describe('StreamCard', () => {
  it('renders a live streaming card with a null-origin shell frame', () => {
    renderCard([{ phase: 'streaming', title: 'Dash', height: 320, html: '<p>rev' }])
    const card = document.querySelector('[data-tool="visualizer"][data-phase="streaming"]')
    expect(card).not.toBeNull()
    const frame = document.querySelector('iframe')
    expect(frame?.getAttribute('srcdoc')).toContain('dsh-gui-viewport')
    expect(frame?.getAttribute('sandbox')).toBe('allow-scripts')
    // Fullscreen is delegated and nothing else: charts may expand, Escape
    // reverses, no clipboard/popups/camera ride the permission policy.
    expect(frame?.getAttribute('allow')).toBe('fullscreen *')
    expect(frame?.getAttribute('title')).toBe('Dash')
    // The card opens at chat-line height; a height argument never pre-sizes
    // the streaming frame — measurements own the height.
    expect(frame?.style.height).toBe('32px')
    expect(screen.getByText('Streaming...')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Download HTML' })).toBeNull()
  })

  it('keeps the composing label plain; the frame sweep carries the live phase', () => {
    renderCard([{ phase: 'streaming', title: 'Dash', height: null, html: '' }])
    expect(screen.getByText('Composing the document')).toBeTruthy()
    expect(document.querySelector('[class*="summaryLive"]')).toBeNull()
    expect(document.querySelector('[class*="streamSweep"]')).not.toBeNull()
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
    vi.useFakeTimers()
    button.click()

    expect(created).toHaveBeenCalledTimes(1)
    // The URL must outlive the click task: the browser reads the blob for
    // the download only after click() returns.
    expect(revoked).not.toHaveBeenCalled()
    vi.advanceTimersByTime(REVOKE_DELAY_MS)
    expect(revoked).toHaveBeenCalledWith('blob:doc-1')
    const anchor = click.mock.instances[0] as HTMLAnchorElement
    expect(anchor.download).toBe('Rev _Q3__dash.html')
  })

  it('copies the settled bytes and confirms briefly, reverting on denial', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    vi.useFakeTimers()
    renderCard([{ phase: 'complete', title: 'Dash', height: null, html: '<p>done</p>' }])

    await flushClick(() => { screen.getByRole('button', { name: 'Copy HTML' }).click() })
    expect(writeText).toHaveBeenCalledWith('<p>done</p>')
    expect(screen.getByText('Copied')).toBeTruthy()

    elapse(COPY_FEEDBACK_MS)
    expect(screen.getByText('Copy HTML')).toBeTruthy()

    writeText.mockRejectedValueOnce(new Error('denied'))
    await flushClick(() => { screen.getByRole('button', { name: 'Copy HTML' }).click() })
    expect(screen.getByText('Copy HTML')).toBeTruthy()
    expect(screen.queryByText('Copied')).toBeNull()
  })

  it('offers no copy control while the document is still streaming', () => {
    renderCard([{ phase: 'streaming', title: 'Dash', height: null, html: '<p>par' }])
    expect(screen.queryByRole('button', { name: 'Copy HTML' })).toBeNull()
  })

  it('shows one load-failure notice when a CDN script fails inside the frame', () => {
    renderCard([{ phase: 'complete', title: 'Dash', height: null, html: '<p>done</p>' }])
    const frame = document.querySelector('iframe')
    if (frame === null) throw new Error('frame not rendered')
    const fail = (src: unknown, fromFrame = true): void => {
      window.dispatchEvent(new MessageEvent('message', {
        data: { __dshGui: true, type: 'scriptError', src },
        source: fromFrame ? frame.contentWindow : window,
      }))
    }

    expect(screen.queryByText('A library failed to load; interactivity may be unavailable')).toBeNull()
    act(() => { fail('https://cdn.jsdelivr.net/npm/chart.js') })
    expect(screen.getByText('A library failed to load; interactivity may be unavailable')).toBeTruthy()

    // Later failures and foreign-source payloads add nothing and open none.
    act(() => {
      fail('https://esm.sh/three')
      fail('https://esm.sh/three', false)
      fail(42)
    })
    expect(screen.getAllByText('A library failed to load; interactivity may be unavailable')).toHaveLength(1)
  })

  it('answers window.storage requests from the session store', () => {
    renderCard([{ phase: 'complete', title: 'Dash', height: null, html: '<p>done</p>' }])
    const frame = document.querySelector('iframe')
    if (frame === null) throw new Error('frame not rendered')
    const respond = vi.spyOn(frame.contentWindow!, 'postMessage')
    const ask = (payload: Record<string, unknown>): void => {
      window.dispatchEvent(new MessageEvent('message', {
        data: { __dshGui: true, type: 'storage-request', ...payload },
        source: frame.contentWindow,
      }))
    }

    ask({ op: 'set', id: 'op1', key: 'routing:marker', value: 'live' })
    ask({ op: 'get', id: 'op2', key: 'routing:marker' })
    ask({ op: 'get', id: 'op3', key: 'routing:absent' })
    ask({ op: 'set', id: 'op4', key: 'routing:bad key', value: 'x' })
    ask({ id: 'op5', key: 'routing:marker' })
    ask({ op: 'rename', id: 'op6', key: 'routing:marker' })

    const replies = respond.mock.calls.map(([message]) => message as { id: string; ok: boolean; value?: string; error?: string })
    expect(replies.find(r => r.id === 'op1')).toMatchObject({ ok: true })
    expect(replies.find(r => r.id === 'op2')).toMatchObject({ ok: true, value: 'live' })
    expect(replies.find(r => r.id === 'op3')).toMatchObject({ ok: false, error: 'no stored value for key "routing:absent"' })
    expect(replies.find(r => r.id === 'op4')).toMatchObject({ ok: false, error: expect.stringContaining('whitespace') })
    expect(replies.find(r => r.id === 'op5')).toMatchObject({ ok: false, error: 'malformed storage request' })
    expect(replies.find(r => r.id === 'op6')).toMatchObject({ ok: false, error: 'malformed storage request' })
  })

  it('answers the shell theme pull and pushes tokens on theme changes', async () => {
    const computedSpy = vi.spyOn(window, 'getComputedStyle').mockReturnValue({
      length: 3,
      0: '--dsw-alias-label-primary',
      1: '--other-token',
      2: '--dsw-empty',
      getPropertyValue: (name: string) => (name === '--dsw-alias-label-primary' ? ' #e8e8e8 ' : ''),
    } as unknown as CSSStyleDeclaration)
    renderCard([{ phase: 'complete', title: 'Dash', height: null, html: '<p>done</p>' }])
    const frame = document.querySelector('iframe')
    if (frame === null) throw new Error('frame not rendered')
    const respond = vi.spyOn(frame.contentWindow!, 'postMessage')

    const ask = (): void => {
      window.dispatchEvent(new MessageEvent('message', {
        data: { __dshGui: true, type: 'theme-request' },
        source: frame.contentWindow,
      }))
    }
    const themePosts = (): number => respond.mock.calls
      .filter(([message]) => (message as { type?: string }).type === 'theme').length
    ask()
    expect(respond).toHaveBeenLastCalledWith(
      { __dshGui: true, type: 'theme', vars: { '--dsw-alias-label-primary': '#e8e8e8' } },
      '*',
    )
    expect(themePosts()).toBe(1)

    // Observer callbacks run as microtasks; act flushes them.
    await act(async () => { document.body.setAttribute('data-theme', 'dark') })
    expect(themePosts()).toBe(2)
    await act(async () => { document.body.setAttribute('data-unrelated', 'x') })
    expect(themePosts()).toBe(2)
    computedSpy.mockRestore()
  })

  it('marks an interrupted card and never offers its partial bytes', () => {
    renderCard([{ phase: 'interrupted', title: null, height: null, html: '<p>par' }])
    expect(screen.getByText('Interrupted; document incomplete')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Download HTML' })).toBeNull()
  })

  it('sweeps the frame diagonally only while the document streams', () => {
    const live = render(<StreamCard node={nodeOf([{ phase: 'streaming', title: 'Dash', height: null, html: '<p>par' }])} t={t} {...kit} />)
    expect(live.container.querySelector('[class*="streamSweep"]')).toBeTruthy()
    live.unmount()

    renderCard([{ phase: 'complete', title: 'Dash', height: null, html: '<p>done</p>' }])
    expect(document.querySelector('[class*="streamSweep"]')).toBeNull()
  })

  it('labels runtime errors from the frame: first message wins, bursts cap, junk drops', () => {
    renderCard([{ phase: 'complete', title: 'Dash', height: null, html: '<p>done</p>' }])
    const frame = document.querySelector('iframe')
    if (frame === null) throw new Error('frame not rendered')
    const raise = (payload: Record<string, unknown>, fromFrame = true): void => {
      window.dispatchEvent(new MessageEvent('message', {
        data: { __dshGui: true, type: 'runtimeError', ...payload },
        source: fromFrame ? frame.contentWindow : window,
      }))
    }

    expect(screen.queryByText(/Script error:/)).toBeNull()
    act(() => { raise({ message: 'ReferenceError: cloud is not defined', line: 41 }) })
    expect(screen.getByText((_, el) => el?.textContent === 'Script error: ReferenceError: cloud is not defined')).toBeTruthy()

    // Later errors repeat the first defect; the card keeps one notice.
    act(() => {
      for (let index = 0; index < 5; index++) {
        raise({ message: `TypeError: boom ${index} of a resize loop`, line: null })
      }
    })
    expect(screen.getByText((_, el) => el?.textContent === 'Script error: ReferenceError: cloud is not defined')).toBeTruthy()

    // Foreign source and malformed payloads drop without a notice.
    raise({ message: 'forged', line: 1 }, false)
    act(() => {
      window.dispatchEvent(new MessageEvent('message', {
        data: { __dshGui: true, type: 'runtimeError', message: '' },
        source: frame.contentWindow,
      }))
      window.dispatchEvent(new MessageEvent('message', {
        data: { __dshGui: true, type: 'runtimeError', message: 'x'.repeat(301) },
        source: frame.contentWindow,
      }))
    })
    expect(screen.getByText((_, el) => el?.textContent === 'Script error: ReferenceError: cloud is not defined')).toBeTruthy()
  })

  it('submits a widget prompt as a tagged turn, dropping bursts and bad payloads', () => {
    const setDraft = vi.fn()
    const submit = vi.fn()
    vi.useFakeTimers()
    vi.setSystemTime(1_000_000)
    render(<StreamCard
      node={nodeOf([{ phase: 'complete', title: 'Dash', height: null, html: '<p>done' }])}
      t={t}
      {...{ ...kit, inputActions: { setDraft, submit } }}
    />)
    const frame = document.querySelector('iframe')
    if (frame === null) throw new Error('frame not rendered')
    const send = (text: unknown, fromFrame = true): void => {
      window.dispatchEvent(new MessageEvent('message', {
        data: { __dshGui: true, type: 'sendPrompt', text },
        source: fromFrame ? frame.contentWindow : window,
      }))
    }

    send('explain the spike at 14:00')
    expect(setDraft).toHaveBeenCalledWith('[widget] explain the spike at 14:00')
    expect(submit).toHaveBeenCalledTimes(1)

    // Inside the interval, later prompts from the same widget are dropped.
    send('again')
    expect(submit).toHaveBeenCalledTimes(1)

    // Non-string, blank, and foreign-source payloads never reach the turn.
    vi.advanceTimersByTime(WIDGET_PROMPT_MIN_INTERVAL_MS + 1)
    send(42)
    send('   ')
    send('from elsewhere', false)
    expect(submit).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(WIDGET_PROMPT_MIN_INTERVAL_MS + 1)
    send('what drove the dip at 09:00')
    expect(submit).toHaveBeenCalledTimes(2)
    expect(setDraft).toHaveBeenLastCalledWith('[widget] what drove the dip at 09:00')
  })

  it('opens a widget link through the host after the frame posts it', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    renderCard([{ phase: 'complete', title: 'Dash', height: null, html: '<p>done' }])
    const frame = document.querySelector('iframe')
    if (frame === null) throw new Error('frame not rendered')
    const link = (url: unknown): void => {
      window.dispatchEvent(new MessageEvent('message', {
        data: { __dshGui: true, type: 'openLink', url },
        source: frame.contentWindow,
      }))
    }

    link('https://example.com/source')
    expect(open).toHaveBeenCalledWith('https://example.com/source', '_blank', 'noopener,noreferrer')
    // The scheme gate lives in the host action; a hostile URL never opens.
    link('javascript:alert(1)')
    expect(open).toHaveBeenCalledTimes(1)
  })

  it('renders one card per streamed call of the step in block order', () => {
    renderCard([
      { phase: 'streaming', title: 'One', height: null, html: '<p>1' },
      { phase: 'streaming', title: 'Two', height: null, html: '<p>2' },
    ])
    expect(document.querySelectorAll('iframe')).toHaveLength(2)
    expect(document.querySelectorAll('[data-tool="visualizer"]')).toHaveLength(2)
  })
})
