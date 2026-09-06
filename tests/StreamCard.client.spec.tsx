// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, render, screen, waitFor } from '@testing-library/react'
import type { ConversationSnapshot, SessionId, SessionListState, WorkspaceListState } from '@deepseek-ai/dsh-client-runtime/client'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'
// Pulls this package's LocaleNamespaceMap merge into the program so the
// composed props type carries the `t` seat (the merge lives in the entry).
import type {} from '../src/client/index.ts'
import { StreamCard, type StreamCardProps } from '../src/client/StreamCard.tsx'
import { EXPORTS_ROUTE_PATH, exportShareName } from '../src/shared/export-name.ts'

import type { GenerativeCardData } from '../src/client/stream-node.ts'
import { REVOKE_DELAY_MS, COPY_FEEDBACK_MS } from '../src/client/download.ts'
import { WIDGET_PROMPT_MIN_INTERVAL_MS } from '../src/client/AutoFrame.tsx'
import { en } from '../src/client/locales.ts'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
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
    renderCard([{ callId: 'call-1', phase: 'streaming', title: 'Dash', height: 320, html: '<p>rev' }])
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

  it('shows the model-authored loading messages, rotating on a dwell', () => {
    vi.useFakeTimers()
    renderCard([{ callId: 'call-2', phase: 'streaming', title: 'Dash', height: null, html: '<p>rev', loadingMessages: ['Bribing bars', 'Asking Q4'] }])
    expect(screen.getByText('Bribing bars…')).toBeTruthy()
    expect(screen.queryByText('Streaming...')).toBeNull()
    // The loader text waves while messages are cycling.
    expect(document.querySelector('[class*="summaryWave"]')).not.toBeNull()

    elapse(4_800)
    expect(screen.getByText('Asking Q4…')).toBeTruthy()
    elapse(4_800)
    expect(screen.getByText('Bribing bars…')).toBeTruthy()

    // A settled card drops the sweep class and messages for the char count.
    cleanup()
    renderCard([{ callId: 'call-3', phase: 'complete', title: 'Dash', height: null, html: '<p>done</p>', loadingMessages: ['Bribing bars'] }])
    expect(screen.queryByText('Bribing bars')).toBeNull()
    expect(screen.getByText('11 chars')).toBeTruthy()
    expect(document.querySelector('[class*="summaryWave"]')).toBeNull()
  })

  it('does not apply the wave class when messages are absent', () => {
    renderCard([{ callId: 'call-4', phase: 'streaming', title: 'Dash', height: null, html: '' }])
    expect(screen.getByText('Composing the document…')).toBeTruthy()
    expect(document.querySelector('[class*="summaryWave"]')).toBeNull()
  })

  it('still appends a trailing ellipsis when the message has one mid-string', () => {
    renderCard([{ callId: 'call-5', phase: 'streaming', title: 'Dash', height: null, html: '<p>rev', loadingMessages: ['Warming up… almost there'] }])
    expect(screen.getByText('Warming up… almost there…')).toBeTruthy()
  })

  it('waves the loader message in staggered 3-character bobs, left to right', () => {
    renderCard([{ callId: 'call-6', phase: 'streaming', title: 'Dash', height: null, html: '<p>rev', loadingMessages: ['Big wave'] }])
    const wave = document.querySelector('[class*="summaryWave"]')
    expect(wave).not.toBeNull()
    // The screen-reader twin carries the whole message...
    expect(wave?.querySelector('[class*="srOnly"]')?.textContent).toBe('Big wave…')
    // ...and the visual copy splits each word into one bob of ≤4 chars: the
    // bob lags one stagger behind its left neighbor, so the wave travels in
    // reading direction. Word boundaries sit between the word spans.
    const bobs = Array.from(wave?.querySelectorAll<HTMLElement>('[style*="animation-delay"]') ?? [])
    expect(bobs.map(b => b.textContent).join('')).toBe('Bigwave…')
    expect(bobs.map(b => b.textContent)).toEqual(['Big', 'wav', 'e…'])
    expect(bobs[0]?.style.animationDelay).toBe('0ms')
    // The space after "Big" advances the phase: "wav" starts at -140ms.
    expect(bobs[1]?.style.animationDelay).toBe('-140ms')
    expect(bobs[2]?.style.animationDelay).toBe('-210ms')
    // The visual half is hidden from assistive tech; the sr twin reads it.
    expect(wave?.querySelector('[aria-hidden="true"]')).not.toBeNull()
  })

  it('keeps the composing label plain; the frame sweep carries the live phase', () => {
    renderCard([{ callId: 'call-7', phase: 'streaming', title: 'Dash', height: null, html: '' }])
    expect(screen.getByText('Composing the document…')).toBeTruthy()
    expect(document.querySelector('[class*="summaryLive"]')).toBeNull()
    expect(document.querySelector('[class*="streamSweep"]')).not.toBeNull()
  })

  it('falls back to the generic title when args carried none', () => {
    renderCard([{ callId: 'call-8', phase: 'streaming', title: null, height: null, html: '<p>x' }])
    const frame = document.querySelector('iframe')
    expect(frame?.getAttribute('title')).toBe('HTML preview')
    expect(frame?.style.height).toBe('32px')
  })

  it('grows and shrinks the frame to the content size the bridge reports', () => {
    renderCard([{ callId: 'call-9', phase: 'streaming', title: 'Dash', height: 320, html: '<p>growing' }])
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
    renderCard([{ callId: 'call-10', phase: 'complete', title: 'Rev "Q3"/dash', height: 400, html: '<p>done</p>' }])

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
    expect(anchor.download).toBe('rev-q3-dash.html')
  })

  it('copies the settled bytes and confirms briefly, reverting on denial', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    vi.useFakeTimers()
    renderCard([{ callId: 'call-11', phase: 'complete', title: 'Dash', height: null, html: '<p>done</p>' }])

    await flushClick(() => { screen.getByRole('button', { name: 'Copy HTML' }).click() })
    expect(writeText).toHaveBeenCalledWith('<p>done</p>')
    // The confirmation is the icon swap plus the accessible name change.
    expect(screen.getByRole('button', { name: 'Copied' })).toBeTruthy()

    elapse(COPY_FEEDBACK_MS)
    expect(screen.getByRole('button', { name: 'Copy HTML' })).toBeTruthy()

    writeText.mockRejectedValueOnce(new Error('denied'))
    await flushClick(() => { screen.getByRole('button', { name: 'Copy HTML' }).click() })
    expect(screen.getByRole('button', { name: 'Copy HTML' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Copied' })).toBeNull()
  })

  it('offers no copy control while the document is still streaming', () => {
    renderCard([{ callId: 'call-12', phase: 'streaming', title: 'Dash', height: null, html: '<p>par' }])
    expect(screen.queryByRole('button', { name: 'Copy HTML' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Fullscreen' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Open standalone page' })).toBeNull()
  })

  it('fullscreens the frame wrapper from a control before copy, reverting on the event', async () => {
    const request = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(HTMLDivElement.prototype, 'requestFullscreen', { configurable: true, value: request })
    const stubElement = (value: Element | null): void => {
      Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => value })
    }
    renderCard([{ callId: 'call-13', phase: 'complete', title: 'Dash', height: null, html: '<p>done</p>' }])
    const wrapper = document.querySelector('[class*="frameWrap"]')
    if (wrapper === null) throw new Error('frame wrapper not rendered')

    // The control sits before Copy and fullscreens the frame's wrapper.
    const copy = screen.getByRole('button', { name: 'Copy HTML' })
    expect(copy.previousElementSibling?.getAttribute('aria-label')).toBe('Fullscreen')
    await flushClick(() => { screen.getByRole('button', { name: 'Fullscreen' }).click() })
    expect(request).toHaveBeenCalledTimes(1)
    expect(request.mock.instances[0]).toBe(wrapper)

    // The event, not the request's promise, flips the label — so an Escape
    // pressed inside the frame reverts the control without a click.
    stubElement(wrapper)
    act(() => { document.dispatchEvent(new Event('fullscreenchange')) })
    expect(screen.getByRole('button', { name: 'Exit fullscreen' })).toBeTruthy()
    stubElement(null)
    act(() => { document.dispatchEvent(new Event('fullscreenchange')) })
    expect(screen.getByRole('button', { name: 'Fullscreen' })).toBeTruthy()
  })

  it('hides the fullscreen control on a collapsed card while copy stays', () => {
    renderCard([{ callId: 'call-14', phase: 'complete', title: 'Dash', height: null, html: '<p>done</p>' }])
    expect(screen.getByRole('button', { name: 'Fullscreen' })).toBeTruthy()
    act(() => { screen.getByText('Dash').click() })
    // The wrapper unmounts on collapse, so fullscreen has no surface; copy
    // and download act on the bytes and stay.
    expect(screen.queryByRole('button', { name: 'Fullscreen' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Copy HTML' })).toBeTruthy()
  })

  /** Stubs the boot token and a fetch mock answering the export POST with `name`. */
  function stubExport(name: string): ReturnType<typeof vi.fn> {
    vi.stubGlobal('__DSH_VISUALIZER_EXPORTS__', 'test-boot-token')
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ name }) })
    vi.stubGlobal('fetch', fetchSpy)
    return fetchSpy
  }

  it('exports on demand, then opens the served page, named for the document', async () => {
    const SVG_DOC = '<svg><rect/></svg>'
    const name = exportShareName('中文 图表', SVG_DOC)
    stubExport(name)
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    renderCard([{ callId: 'call-15', phase: 'complete', title: '中文 图表', height: null, html: SVG_DOC }])

    expect(screen.queryByRole('button', { name: 'Open standalone page' })).toBeNull()
    await act(async () => { screen.getByRole('button', { name: 'Export' }).click() })
    // The write already ran; opening is now synchronous with its own click.
    screen.getByRole('button', { name: 'Open standalone page' }).click()
    expect(open).toHaveBeenCalledWith(
      `${window.location.origin}${EXPORTS_ROUTE_PATH}/${encodeURIComponent(name)}?k=test-boot-token`,
      '_blank',
      'noopener,noreferrer',
    )
  })

  it('copy-link is reachable only once exported, and copies without opening a tab', async () => {
    const SVG_DOC = '<svg><rect/></svg>'
    stubExport(exportShareName('中文 图表', SVG_DOC))
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    renderCard([{ callId: 'call-16', phase: 'complete', title: '中文 图表', height: null, html: SVG_DOC }])

    expect(screen.queryByRole('button', { name: 'Copy share link' })).toBeNull()
    await act(async () => { screen.getByRole('button', { name: 'Export' }).click() })
    await act(async () => { screen.getByRole('button', { name: 'Copy share link' }).click() })
    expect(writeText).toHaveBeenCalledWith(
      `${window.location.origin}${EXPORTS_ROUTE_PATH}/${encodeURIComponent(exportShareName('中文 图表', SVG_DOC))}?k=test-boot-token`,
    )
    expect(open).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Link copied' })).toBeTruthy()
  })

  it('unshare arms, confirms, and returns the card all the way to Export', async () => {
    const SVG_DOC = '<svg><rect/></svg>'
    const fetchSpy = stubExport(exportShareName('中文 图表', SVG_DOC))
    renderCard([{ callId: 'call-18', phase: 'complete', title: '中文 图表', height: null, html: SVG_DOC }])

    await act(async () => { screen.getByRole('button', { name: 'Export' }).click() })
    await act(async () => { screen.getByRole('button', { name: 'Unshare' }).click() })
    expect(screen.getByRole('button', { name: 'Click again to confirm unshare' })).toBeTruthy()
    await act(async () => { screen.getByRole('button', { name: 'Click again to confirm unshare' }).click() })
    expect(fetchSpy).toHaveBeenCalledWith(
      `${window.location.origin}${EXPORTS_ROUTE_PATH}/${encodeURIComponent(exportShareName('中文 图表', SVG_DOC))}?k=test-boot-token`,
      { method: 'DELETE' },
    )
    await waitFor(() => { expect(screen.getByRole('button', { name: 'Export' })).toBeTruthy() })
    expect(screen.queryByRole('button', { name: 'Copy share link' })).toBeNull()
  })

  it('hides the share controls when the host never announced the route', () => {
    renderCard([{ callId: 'call-17', phase: 'complete', title: 'Dash', height: null, html: '<p>done</p>' }])
    expect(screen.queryByRole('button', { name: 'Open standalone page' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Export' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Copy share link' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Unshare' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Download HTML' })).toBeTruthy()
  })

  it('shows one load-failure notice when a CDN script fails inside the frame', () => {
    renderCard([{ callId: 'call-18', phase: 'complete', title: 'Dash', height: null, html: '<p>done</p>' }])
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
    renderCard([{ callId: 'call-19', phase: 'complete', title: 'Dash', height: null, html: '<p>done</p>' }])
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
    renderCard([{ callId: 'call-20', phase: 'complete', title: 'Dash', height: null, html: '<p>done</p>' }])
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
    renderCard([{ callId: 'call-21', phase: 'interrupted', title: null, height: null, html: '<p>par' }])
    expect(screen.getByText('Interrupted; document incomplete')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Download HTML' })).toBeNull()
  })

  it('sweeps the frame diagonally only while the document streams', () => {
    const live = render(<StreamCard node={nodeOf([{ callId: 'call-22', phase: 'streaming', title: 'Dash', height: null, html: '<p>par' }])} t={t} {...kit} />)
    expect(live.container.querySelector('[class*="streamSweep"]')).toBeTruthy()
    live.unmount()

    renderCard([{ callId: 'call-23', phase: 'complete', title: 'Dash', height: null, html: '<p>done</p>' }])
    expect(document.querySelector('[class*="streamSweep"]')).toBeNull()
  })

  it('labels runtime errors from the frame: first message wins, bursts cap, junk drops', () => {
    renderCard([{ callId: 'call-24', phase: 'complete', title: 'Dash', height: null, html: '<p>done</p>' }])
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
      node={nodeOf([{ callId: 'call-25', phase: 'complete', title: 'Dash', height: null, html: '<p>done' }])}
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
    renderCard([{ callId: 'call-26', phase: 'complete', title: 'Dash', height: null, html: '<p>done' }])
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
      { callId: 'call-27', phase: 'streaming', title: 'One', height: null, html: '<p>1' },
      { callId: 'call-28', phase: 'streaming', title: 'Two', height: null, html: '<p>2' },
    ])
    expect(document.querySelectorAll('iframe')).toHaveLength(2)
    expect(document.querySelectorAll('[data-tool="visualizer"]')).toHaveLength(2)
  })
})
