// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
// Pulls this package's LocaleNamespaceMap merge into the program so the
// composed props type carries the `t` seat (the merge lives in the entry).
import type {} from '../src/client/index.ts'
import { SettledDoc, type SettledDocProps } from '../src/client/SettledDoc.tsx'
import { EXPORTS_ROUTE_PATH, exportShareName } from '../src/shared/export-name.ts'

import { STREAM_SHELL } from '../src/client/shell.ts'
import { REVOKE_DELAY_MS, COPY_FEEDBACK_MS } from '../src/client/download.ts'
import { WIDGET_PROMPT_MIN_INTERVAL_MS } from '../src/client/AutoFrame.tsx'
import { EXPORT_FAILURE_REVERT_MS, UNSHARE_CONFIRM_MS } from '../src/client/export-control.ts'
import { en } from '../src/client/locales.ts'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

/** Locale seat over the package dictionary; interpolates the single numeric param. */
const t = ((key: keyof typeof en, params?: Record<string, string | number>) =>
  en[key].replace(/\{(\w+)\}/g, (_m, name: string) => String(params?.[name] ?? ''))) as SettledDocProps['t']

const DOC = '<!DOCTYPE html><html><body><p>revenue</p></body></html>'

function args(fields: Record<string, unknown>): string {
  return JSON.stringify(fields)
}

describe('SettledDoc', () => {
  it('renders nothing for arguments with no document', () => {
    const { container } = render(<SettledDoc argsRaw="{}" t={t} onPrompt={() => {}} />)
    expect(container.firstChild).toBeNull()
  })

  it('renders the document in a null-origin frame, defaulting to the ok state', () => {
    render(<SettledDoc argsRaw={args({ title: 'Dash', height: 360, html: DOC })} t={t} onPrompt={() => {}} />)

    const frame = document.querySelector('iframe')
    expect(frame?.getAttribute('srcDoc')).toBe(STREAM_SHELL)
    expect(frame?.getAttribute('sandbox')).toBe('allow-scripts')
    expect(frame?.getAttribute('allow')).toBe('fullscreen *')
    expect(frame?.style.height).toBe('360px')
    expect(screen.getByText('55 chars')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Download HTML' })).toBeTruthy()
  })

  it('uses the dictionary title when the arguments supply none', () => {
    render(<SettledDoc argsRaw={args({ html: '<p>x</p>' })} t={t} onPrompt={() => {}} />)
    expect(screen.getByText('HTML preview')).toBeTruthy()
  })

  it('shows the running summary, a sweep, and no chrome in the running state', () => {
    render(<SettledDoc argsRaw={args({ title: 'Dash', html: DOC })} t={t} onPrompt={() => {}} state="running" />)

    expect(screen.getByText('Rendering…')).toBeTruthy()
    expect(document.querySelector('[class*="streamSweep"]')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Download HTML' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Fullscreen' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Comment mode' })).toBeNull()
  })

  it('leaves the ok-state frame without a sweep', () => {
    render(<SettledDoc argsRaw={args({ title: 'Dash', html: DOC })} t={t} onPrompt={() => {}} />)
    expect(document.querySelector('[class*="streamSweep"]')).toBeNull()
  })

  it('shows no inspect control when the owner supplies none', () => {
    render(<SettledDoc argsRaw={args({ title: 'Dash', html: DOC })} t={t} onPrompt={() => {}} />)
    expect(screen.queryByRole('button', { name: 'Inspect' })).toBeNull()
  })

  it('jumps to the trajectory view from the inspect control, in both running and ok states', () => {
    const inspect = vi.fn()
    render(<SettledDoc argsRaw={args({ title: 'Dash', html: DOC })} t={t} onPrompt={() => {}} inspect={inspect} state="running" />)
    screen.getByRole('button', { name: 'Inspect' }).click()
    expect(inspect).toHaveBeenCalledTimes(1)

    cleanup()
    render(<SettledDoc argsRaw={args({ title: 'Dash', html: DOC })} t={t} onPrompt={() => {}} inspect={inspect} />)
    screen.getByRole('button', { name: 'Inspect' }).click()
    expect(inspect).toHaveBeenCalledTimes(2)
  })

  /** Stubs the boot token and a fetch mock answering the export POST with `name`. */
  function stubExport(name = exportShareName('Dash', DOC)): ReturnType<typeof vi.fn> {
    vi.stubGlobal('__DSH_VISUALIZER_EXPORTS__', 'test-boot-token')
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ name }) })
    vi.stubGlobal('fetch', fetchSpy)
    return fetchSpy
  }

  it('shows only Export until the write confirms, then Open/Copy-link/Unshare — never a tab before the write resolves', async () => {
    const fetchSpy = stubExport()
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    render(<SettledDoc argsRaw={args({ title: 'Dash', html: DOC })} t={t} onPrompt={() => {}} callId="call-1" />)

    expect(screen.queryByRole('button', { name: 'Open standalone page' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Copy share link' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Unshare' })).toBeNull()
    const exportButton = screen.getByRole('button', { name: 'Export' })
    await act(async () => { exportButton.click() })
    expect(fetchSpy).toHaveBeenCalledWith(
      `${window.location.origin}${EXPORTS_ROUTE_PATH}/?k=test-boot-token`,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ callId: 'call-1' }) },
    )
    expect(screen.queryByRole('button', { name: 'Export' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Copy share link' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Unshare' })).toBeTruthy()

    // Now that the write is confirmed, opening is synchronous with its own click.
    await act(async () => { screen.getByRole('button', { name: 'Open standalone page' }).click() })
    expect(open).toHaveBeenCalledWith(
      `${window.location.origin}${EXPORTS_ROUTE_PATH}/${encodeURIComponent(exportShareName('Dash', DOC))}?k=test-boot-token`,
      '_blank',
      'noopener,noreferrer',
    )
  })

  it('reverts Export to a retryable state when the write fails', async () => {
    vi.stubGlobal('__DSH_VISUALIZER_EXPORTS__', 'test-boot-token')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 429 }))
    vi.useFakeTimers()
    render(<SettledDoc argsRaw={args({ title: 'Dash', html: DOC })} t={t} onPrompt={() => {}} callId="call-1" />)

    await act(async () => { screen.getByRole('button', { name: 'Export' }).click() })
    expect(screen.getByRole('button', { name: 'Export failed' })).toBeTruthy()
    act(() => { vi.advanceTimersByTime(EXPORT_FAILURE_REVERT_MS) })
    expect(screen.getByRole('button', { name: 'Export' })).toBeTruthy()
  })

  it('never offers Export without a callId to name', () => {
    render(<SettledDoc argsRaw={args({ title: 'Dash', html: DOC })} t={t} onPrompt={() => {}} />)
    // Still shareable (route announced elsewhere in other tests), but this
    // card carries no callId — Copy link and Export both need one.
    expect(screen.queryByRole('button', { name: 'Export' })).toBeNull()
  })

  it('hides the share controls when the host never announced the route', () => {
    render(<SettledDoc argsRaw={args({ title: 'Dash', html: DOC })} t={t} onPrompt={() => {}} callId="call-1" />)
    expect(screen.queryByRole('button', { name: 'Open standalone page' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Export' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Copy share link' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Download HTML' })).toBeTruthy()
  })

  it('copy-link is reachable only once exported, and copies immediately with no export of its own', async () => {
    const fetchSpy = stubExport()
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    render(<SettledDoc argsRaw={args({ title: 'Dash', html: DOC })} t={t} onPrompt={() => {}} callId="call-1" />)

    await act(async () => { screen.getByRole('button', { name: 'Export' }).click() })
    fetchSpy.mockClear()
    await act(async () => { screen.getByRole('button', { name: 'Copy share link' }).click() })
    expect(writeText).toHaveBeenCalledWith(
      `${window.location.origin}${EXPORTS_ROUTE_PATH}/${encodeURIComponent(exportShareName('Dash', DOC))}?k=test-boot-token`,
    )
    // No new request: the name was already known, nothing left to ensure.
    expect(fetchSpy).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Link copied' })).toBeTruthy()
  })

  it('confirms nothing when the clipboard refuses the link', async () => {
    stubExport()
    const writeText = vi.fn().mockRejectedValue(new Error('denied'))
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    render(<SettledDoc argsRaw={args({ title: 'Dash', html: DOC })} t={t} onPrompt={() => {}} callId="call-1" />)

    await act(async () => { screen.getByRole('button', { name: 'Export' }).click() })
    await act(async () => { screen.getByRole('button', { name: 'Copy share link' }).click() })
    expect(screen.getByRole('button', { name: 'Copy share link' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Link copied' })).toBeNull()
  })

  describe('unshare', () => {
    it('arms on the first click and only unshares on a second click while armed', async () => {
      const fetchSpy = stubExport()
      render(<SettledDoc argsRaw={args({ title: 'Dash', html: DOC })} t={t} onPrompt={() => {}} callId="call-1" />)
      await act(async () => { screen.getByRole('button', { name: 'Export' }).click() })

      const unshare = screen.getByRole('button', { name: 'Unshare' })
      await act(async () => { unshare.click() })
      expect(screen.getByRole('button', { name: 'Click again to confirm unshare' })).toBeTruthy()
      expect(fetchSpy).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ method: 'DELETE' }))

      await act(async () => { screen.getByRole('button', { name: 'Click again to confirm unshare' }).click() })
      expect(fetchSpy).toHaveBeenCalledWith(
        `${window.location.origin}${EXPORTS_ROUTE_PATH}/${encodeURIComponent(exportShareName('Dash', DOC))}?k=test-boot-token`,
        { method: 'DELETE' },
      )
      // Genuinely unshared, not just forgotten locally: the row reverts all
      // the way back to Export, not to some half-shared in-between state.
      await waitFor(() => { expect(screen.getByRole('button', { name: 'Export' })).toBeTruthy() })
      expect(screen.queryByRole('button', { name: 'Copy share link' })).toBeNull()
      expect(screen.queryByRole('button', { name: 'Open standalone page' })).toBeNull()
    })

    it('reverts the armed state on its own after the confirm window elapses', async () => {
      vi.useFakeTimers()
      stubExport()
      render(<SettledDoc argsRaw={args({ title: 'Dash', html: DOC })} t={t} onPrompt={() => {}} callId="call-1" />)
      await act(async () => { screen.getByRole('button', { name: 'Export' }).click() })

      await act(async () => { screen.getByRole('button', { name: 'Unshare' }).click() })
      expect(screen.getByRole('button', { name: 'Click again to confirm unshare' })).toBeTruthy()
      act(() => { vi.advanceTimersByTime(UNSHARE_CONFIRM_MS) })
      expect(screen.getByRole('button', { name: 'Unshare' })).toBeTruthy()
    })

    it('leaves the card shared when the host refuses the unshare', async () => {
      vi.stubGlobal('__DSH_VISUALIZER_EXPORTS__', 'test-boot-token')
      const name = exportShareName('Dash', DOC)
      vi.stubGlobal('fetch', vi.fn().mockImplementation((_url: string, init?: RequestInit) =>
        Promise.resolve(init?.method === 'DELETE' ? { ok: false, status: 404 } : { ok: true, json: () => Promise.resolve({ name }) })))
      render(<SettledDoc argsRaw={args({ title: 'Dash', html: DOC })} t={t} onPrompt={() => {}} callId="call-1" />)

      await act(async () => { screen.getByRole('button', { name: 'Export' }).click() })
      await act(async () => { screen.getByRole('button', { name: 'Unshare' }).click() })
      await act(async () => { screen.getByRole('button', { name: 'Click again to confirm unshare' }).click() })
      expect(screen.getByRole('button', { name: 'Unshare' })).toBeTruthy()
      expect(screen.getByRole('button', { name: 'Copy share link' })).toBeTruthy()
    })
  })

  it('downloads the bytes client-side under a sanitized file name', () => {
    const created = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:doc-2')
    const revoked = vi.spyOn(URL, 'revokeObjectURL').mockReturnValue()
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    render(<SettledDoc argsRaw={args({ title: 'Q3: "final"', html: DOC })} t={t} onPrompt={() => {}} />)

    vi.useFakeTimers()
    screen.getByRole('button', { name: 'Download HTML' }).click()
    expect(created).toHaveBeenCalledTimes(1)
    expect(revoked).not.toHaveBeenCalled()
    vi.advanceTimersByTime(REVOKE_DELAY_MS)
    expect(revoked).toHaveBeenCalledWith('blob:doc-2')
    const anchor = click.mock.instances[0] as HTMLAnchorElement
    expect(anchor.download).toBe('q3-final.html')
  })

  it('shows the load-failure notice once a frame script fails', () => {
    render(<SettledDoc argsRaw={args({ title: 'Dash', html: DOC })} t={t} onPrompt={() => {}} />)
    const frame = document.querySelector('iframe')
    if (frame === null) throw new Error('frame not rendered')

    act(() => {
      window.dispatchEvent(new MessageEvent('message', {
        data: { __dshGui: true, type: 'scriptError', src: 'https://unpkg.com/chart.js' },
        source: frame.contentWindow,
      }))
    })
    expect(screen.getByText('A library failed to load; interactivity may be unavailable')).toBeTruthy()

    act(() => {
      window.dispatchEvent(new MessageEvent('message', {
        data: { __dshGui: true, type: 'scriptError', src: '' },
        source: frame.contentWindow,
      }))
    })
    expect(screen.getAllByText('A library failed to load; interactivity may be unavailable')).toHaveLength(1)
  })

  it('labels a runtime error with its message beside the summary', () => {
    render(<SettledDoc argsRaw={args({ title: 'Dash', html: DOC })} t={t} onPrompt={() => {}} />)
    const frame = document.querySelector('iframe')
    if (frame === null) throw new Error('frame not rendered')

    act(() => {
      window.dispatchEvent(new MessageEvent('message', {
        data: { __dshGui: true, type: 'runtimeError', message: 'ReferenceError: cloud is not defined', line: 41 },
        source: frame.contentWindow,
      }))
    })
    expect(screen.getByText((_, el) => el?.textContent === 'Script error: ReferenceError: cloud is not defined')).toBeTruthy()

    act(() => {
      window.dispatchEvent(new MessageEvent('message', {
        data: { __dshGui: true, type: 'runtimeError', message: 'TypeError: later', line: null },
        source: frame.contentWindow,
      }))
    })
    expect(screen.getByText((_, el) => el?.textContent === 'Script error: ReferenceError: cloud is not defined')).toBeTruthy()
    expect(screen.queryByText(/TypeError: later/)).toBeNull()
  })

  it('offers no fix control while the render is healthy', () => {
    render(<SettledDoc argsRaw={args({ title: 'Dash', html: DOC })} t={t} onPrompt={() => {}} />)
    expect(screen.queryByRole('button', { name: 'Ask for a fix' })).toBeNull()
  })

  it('sends one composed fix request naming both failures, then stays spent', () => {
    const onPrompt = vi.fn()
    render(<SettledDoc argsRaw={args({ title: 'Dash', html: DOC })} t={t} onPrompt={onPrompt} />)
    const frame = document.querySelector('iframe')
    if (frame === null) throw new Error('frame not rendered')
    const post = (data: Record<string, unknown>): void => {
      act(() => {
        window.dispatchEvent(new MessageEvent('message', {
          data: { __dshGui: true, ...data },
          source: frame.contentWindow,
        }))
      })
    }

    post({ type: 'scriptError', src: 'https://unpkg.com/chart.js' })
    post({ type: 'runtimeError', message: 'ReferenceError: Chart is not defined', line: 12 })

    const fix = screen.getByRole('button', { name: 'Ask for a fix' })
    act(() => { fix.click() })
    expect(onPrompt).toHaveBeenCalledTimes(1)
    const composed = onPrompt.mock.calls[0]![0] as string
    expect(composed).toContain('"Dash"')
    expect(composed).toContain('- a library failed to load: https://unpkg.com/chart.js')
    expect(composed).toContain('- a script error on line 12: ReferenceError: Chart is not defined')

    // One request per broken render: the control stays, relabeled and inert.
    const spent = screen.getByRole('button', { name: 'Fix requested' })
    expect((spent as HTMLButtonElement).disabled).toBe(true)
    act(() => { spent.click() })
    expect(onPrompt).toHaveBeenCalledTimes(1)
  })

  it('appears for a load failure alone and survives a collapse', () => {
    render(<SettledDoc argsRaw={args({ title: 'Dash', html: DOC })} t={t} onPrompt={() => {}} />)
    const frame = document.querySelector('iframe')
    if (frame === null) throw new Error('frame not rendered')
    act(() => {
      window.dispatchEvent(new MessageEvent('message', {
        data: { __dshGui: true, type: 'scriptError', src: 'https://unpkg.com/chart.js' },
        source: frame.contentWindow,
      }))
    })
    expect(screen.getByRole('button', { name: 'Ask for a fix' })).toBeTruthy()

    // It acts on card state, not on the frame, so collapsing keeps it — the
    // same rule copy and download follow.
    act(() => { screen.getByText('Dash').click() })
    expect(screen.queryByRole('button', { name: 'Fullscreen' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Ask for a fix' })).toBeTruthy()
  })

  it('offers no fix control on a still-running card', () => {
    render(<SettledDoc argsRaw={args({ title: 'Dash', html: DOC })} t={t} onPrompt={() => {}} state="running" />)
    const frame = document.querySelector('iframe')
    if (frame === null) throw new Error('frame not rendered')
    act(() => {
      window.dispatchEvent(new MessageEvent('message', {
        data: { __dshGui: true, type: 'runtimeError', message: 'TypeError: early', line: 3 },
        source: frame.contentWindow,
      }))
    })
    expect(screen.queryByRole('button', { name: 'Ask for a fix' })).toBeNull()
  })

  it('copies the bytes and confirms briefly on the row', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    vi.useFakeTimers()
    render(<SettledDoc argsRaw={args({ title: 'Dash', html: DOC })} t={t} onPrompt={() => {}} />)

    await act(async () => { screen.getByRole('button', { name: 'Copy HTML' }).click() })
    expect(writeText).toHaveBeenCalledWith(DOC)
    expect(screen.getByRole('button', { name: 'Copied' })).toBeTruthy()
    act(() => { vi.advanceTimersByTime(COPY_FEEDBACK_MS) })
    expect(screen.getByRole('button', { name: 'Copy HTML' })).toBeTruthy()
  })

  it('fullscreens the frame wrapper from a control before copy, reverting on the event', async () => {
    const request = vi.fn().mockResolvedValue(undefined)
    const exit = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(HTMLDivElement.prototype, 'requestFullscreen', { configurable: true, value: request })
    Object.defineProperty(document, 'exitFullscreen', { configurable: true, value: exit })
    const stubElement = (value: Element | null): void => {
      Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => value })
    }
    render(<SettledDoc argsRaw={args({ title: 'Dash', html: DOC })} t={t} onPrompt={() => {}} />)
    const wrapper = document.querySelector('[class*="frameWrap"]')
    if (wrapper === null) throw new Error('frame wrapper not rendered')

    const copy = screen.getByRole('button', { name: 'Copy HTML' })
    expect(copy.previousElementSibling?.getAttribute('aria-label')).toBe('Comment mode')
    expect(copy.previousElementSibling?.previousElementSibling?.getAttribute('aria-label')).toBe('Fullscreen')
    await act(async () => { screen.getByRole('button', { name: 'Fullscreen' }).click() })
    expect(request).toHaveBeenCalledTimes(1)
    expect(request.mock.instances[0]).toBe(wrapper)

    stubElement(wrapper)
    act(() => { document.dispatchEvent(new Event('fullscreenchange')) })
    expect(screen.getByRole('button', { name: 'Exit fullscreen' })).toBeTruthy()

    await act(async () => { screen.getByRole('button', { name: 'Exit fullscreen' }).click() })
    expect(exit).toHaveBeenCalledTimes(1)
    stubElement(null)
    act(() => { document.dispatchEvent(new Event('fullscreenchange')) })
    expect(screen.getByRole('button', { name: 'Fullscreen' })).toBeTruthy()
  })

  it('hides the fullscreen control once collapsed; byte actions stay', () => {
    render(<SettledDoc argsRaw={args({ title: 'Dash', html: DOC })} t={t} onPrompt={() => {}} />)
    expect(screen.getByRole('button', { name: 'Fullscreen' })).toBeTruthy()
    act(() => { screen.getByText('Dash').click() })
    // The wrapper unmounts on collapse, so fullscreen has no surface; copy
    // and download act on the bytes and stay.
    expect(screen.queryByRole('button', { name: 'Fullscreen' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Copy HTML' })).toBeTruthy()
  })

  it('forwards a widget prompt as one tagged turn per interval', () => {
    const onPrompt = vi.fn()
    vi.useFakeTimers()
    vi.setSystemTime(1_000_000)
    render(<SettledDoc argsRaw={args({ title: 'Dash', html: DOC })} t={t} onPrompt={onPrompt} />)
    const frame = document.querySelector('iframe')
    if (frame === null) throw new Error('frame not rendered')

    window.dispatchEvent(new MessageEvent('message', {
      data: { __dshGui: true, type: 'sendPrompt', text: 'break down Q3 by region' },
      source: frame.contentWindow,
    }))
    expect(onPrompt).toHaveBeenCalledWith('break down Q3 by region')

    window.dispatchEvent(new MessageEvent('message', {
      data: { __dshGui: true, type: 'sendPrompt', text: 'too soon' },
      source: frame.contentWindow,
    }))
    expect(onPrompt).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(WIDGET_PROMPT_MIN_INTERVAL_MS + 1)
    window.dispatchEvent(new MessageEvent('message', {
      data: { __dshGui: true, type: 'sendPrompt', text: 'and by product' },
      source: frame.contentWindow,
    }))
    expect(onPrompt).toHaveBeenCalledTimes(2)
  })

  it('shows comment controls while expanded and hides them on collapse', () => {
    render(<SettledDoc argsRaw={args({ title: 'Dash', html: DOC })} t={t} onPrompt={() => {}} />)
    expect(screen.getByRole('button', { name: 'Comment mode' })).toBeTruthy()
    act(() => { screen.getByText('Dash').click() })
    expect(screen.queryByRole('button', { name: 'Comment mode' })).toBeNull()
  })

  it('collects picks as comment rows and sends one composed widget prompt', async () => {
    const onPrompt = vi.fn()
    render(<SettledDoc argsRaw={args({ title: 'Dash', html: DOC })} t={t} onPrompt={onPrompt} />)
    const frame = document.querySelector('iframe')
    if (frame === null) throw new Error('frame not rendered')

    expect(screen.queryByTestId('comment-bar')).toBeNull()

    act(() => {
      window.dispatchEvent(new MessageEvent('message', {
        data: {
          __dshGui: true, type: 'annotation',
          pick: { id: 'a1', kind: 'element', selector: 'p', tag: 'p', snippet: '<p>revenue</p>', text: 'revenue' },
        },
        source: frame.contentWindow,
      }))
    })
    const bar = screen.getByTestId('comment-bar')
    expect(bar).toBeTruthy()
    expect(screen.getByText('revenue')).toBeTruthy()

    const note = screen.getByRole('textbox', { name: 'Comment note' })
    await act(async () => { fireEvent.change(note, { target: { value: 'make this bold' } }) })
    await act(async () => { screen.getByRole('button', { name: 'Send' }).click() })
    expect(onPrompt).toHaveBeenCalledTimes(1)
    const composed = onPrompt.mock.calls[0]![0] as string
    expect(composed).toContain('\n\n1. make this bold\n')
    expect(composed).toContain('element: <p> p')
    expect(composed).toContain('markup: <p>revenue</p>')
    expect(screen.queryByTestId('comment-bar')).toBeNull()
    expect(screen.getByRole('button', { name: 'Comment mode' }).getAttribute('aria-pressed')).toBe('false')
  })

  it('removes one pick from the bar and clears all', () => {
    render(<SettledDoc argsRaw={args({ title: 'Dash', html: DOC })} t={t} onPrompt={() => {}} />)
    const frame = document.querySelector('iframe')
    if (frame === null) throw new Error('frame not rendered')
    const pick = (id: string): void => {
      act(() => {
        window.dispatchEvent(new MessageEvent('message', {
          data: { __dshGui: true, type: 'annotation', pick: { id, kind: 'element', selector: 'p', tag: 'p', snippet: '<p>x</p>', text: 'x' } },
          source: frame.contentWindow,
        }))
      })
    }
    pick('a1')
    pick('a2')
    expect(screen.getAllByRole('textbox', { name: 'Comment note' })).toHaveLength(2)

    act(() => { screen.getAllByRole('button', { name: 'Remove comment' })[0]!.click() })
    expect(screen.getAllByRole('textbox', { name: 'Comment note' })).toHaveLength(1)

    act(() => { screen.getByRole('button', { name: 'Clear' }).click() })
    expect(screen.queryByTestId('comment-bar')).toBeNull()
  })

  it('drops malformed annotation posts silently', () => {
    render(<SettledDoc argsRaw={args({ title: 'Dash', html: DOC })} t={t} onPrompt={() => {}} />)
    const frame = document.querySelector('iframe')
    if (frame === null) throw new Error('frame not rendered')
    act(() => {
      window.dispatchEvent(new MessageEvent('message', {
        data: { __dshGui: true, type: 'annotation', pick: { id: '', kind: 'weird' } },
        source: frame.contentWindow,
      }))
    })
    expect(screen.queryByTestId('comment-bar')).toBeNull()
  })

  it('reverts the mode button when the frame exits on Escape', () => {
    render(<SettledDoc argsRaw={args({ title: 'Dash', html: DOC })} t={t} onPrompt={() => {}} />)
    const frame = document.querySelector('iframe')
    if (frame === null) throw new Error('frame not rendered')

    act(() => { screen.getByRole('button', { name: 'Comment mode' }).click() })
    expect(screen.getByRole('button', { name: 'Comment mode' }).getAttribute('aria-pressed')).toBe('true')

    act(() => {
      window.dispatchEvent(new MessageEvent('message', {
        data: { __dshGui: true, type: 'annotateExited' },
        source: frame.contentWindow,
      }))
    })
    expect(screen.getByRole('button', { name: 'Comment mode' }).getAttribute('aria-pressed')).toBe('false')
  })
})
