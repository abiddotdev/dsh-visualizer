// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import type { ConversationSnapshot, SessionId, SessionListState, WorkspaceListState } from '@deepseek-ai/dsh-client-runtime/client'
import type { ToolCallBlock } from '@deepseek-ai/dsh-client-runtime/client'
import type { SnapshotSelectorHook } from '@deepseek-ai/dsh-client-ui-slots'
// Pulls this package's LocaleNamespaceMap merge into the program so the
// composed props type carries the `t` seat (the merge lives in the entry).
import type {} from '../src/client/index.ts'
import { ResultRow, type ResultRowProps } from '../src/client/ResultRow.tsx'
import { EXPORTS_ROUTE_PATH, exportShareName } from '../src/shared/export-name.ts'

import { STREAM_SHELL } from '../src/client/shell.ts'
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
  en[key].replace(/\{(\w+)\}/g, (_m, name: string) => String(params?.[name] ?? ''))) as ResultRowProps['t']

/** Framework standard-kit stubs: the card consumes only the block and the locale seat. */
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

function settledBlock(argsRaw: string | null, isError = false): ToolCallBlock {
  return {
    kind: 'tool-result', seq: 2, time: 0, callId: 'c1',
    call: argsRaw === null ? null : { name: 'visualizer', argsRaw },
    callTime: 0, content: [], isError,
    ...isError ? { error: { name: 'Error', code: 'E_TOOL' } } : {},
    callView: null, resultView: null, subCalls: [],
  }
}

const DOC = '<!DOCTYPE html><html><body><p>revenue</p></body></html>'

describe('ResultRow', () => {
  it('renders the settled document from the logged call arguments in a null-origin frame', () => {
    render(<ResultRow {...props(settledBlock(JSON.stringify({ title: 'Dash', height: 360, html: DOC })))} />)

    // The settled row drives the shared shell: the document arrives through
    // the bridge, and the frame sizes itself from content measurements.
    const frame = document.querySelector('iframe')
    expect(frame?.getAttribute('srcDoc')).toBe(STREAM_SHELL)
    expect(frame?.getAttribute('sandbox')).toBe('allow-scripts')
    expect(frame?.getAttribute('allow')).toBe('fullscreen *')
    expect(frame?.style.height).toBe('360px')
    expect(screen.getByText('55 chars')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Download HTML' })).toBeTruthy()
  })

  it('renders the document while the call runs, without the download control', () => {
    render(<ResultRow {...props(runningBlock(JSON.stringify({ title: 'Dash', html: DOC })))} />)

    const frame = document.querySelector('iframe')
    expect(frame?.getAttribute('srcDoc')).toBe(STREAM_SHELL)
    expect(frame?.style.height).toBe('480px')
    expect(screen.getByText('Rendering…')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Download HTML' })).toBeNull()
    expect(screen.queryByRole('button', { name: 'Open standalone page' })).toBeNull()
  })

  it('opens the served export page from the settled row, named for the document', () => {
    vi.stubGlobal('__DSH_VISUALIZER_EXPORTS__', 'test-boot-token')
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    render(<ResultRow {...props(settledBlock(JSON.stringify({ title: 'Dash', html: DOC })))} />)

    screen.getByRole('button', { name: 'Open standalone page' }).click()
    // The URL is the same name the host's export fanout finalized under,
    // carrying the boot capability token the route demands.
    expect(open).toHaveBeenCalledWith(
      `${window.location.origin}${EXPORTS_ROUTE_PATH}/${encodeURIComponent(exportShareName('Dash', DOC))}?k=test-boot-token`,
      '_blank',
      'noopener,noreferrer',
    )
  })

  it('hides the share control when the host never announced the route', () => {
    render(<ResultRow {...props(settledBlock(JSON.stringify({ title: 'Dash', html: DOC })))} />)
    expect(screen.queryByRole('button', { name: 'Open standalone page' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Download HTML' })).toBeTruthy()
  })

  it('sweeps the running frame and leaves the settled one plain', () => {
    const running = render(<ResultRow {...props(runningBlock(JSON.stringify({ title: 'Dash', html: DOC })))} />)
    expect(running.container.querySelector('[class*="streamSweep"]')).toBeTruthy()
    running.unmount()

    render(<ResultRow {...props(settledBlock(JSON.stringify({ title: 'Dash', html: DOC })))} />)
    expect(document.querySelector('[class*="streamSweep"]')).toBeNull()
  })

  it('downloads the settled bytes client-side under a sanitized file name', () => {
    const created = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:doc-2')
    const revoked = vi.spyOn(URL, 'revokeObjectURL').mockReturnValue()
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    render(<ResultRow {...props(settledBlock(JSON.stringify({ title: 'Q3: "final"', html: DOC })))} />)

    vi.useFakeTimers()
    screen.getByRole('button', { name: 'Download HTML' }).click()
    expect(created).toHaveBeenCalledTimes(1)
    // The URL must outlive the click task: the browser reads the blob for
    // the download only after click() returns.
    expect(revoked).not.toHaveBeenCalled()
    vi.advanceTimersByTime(REVOKE_DELAY_MS)
    expect(revoked).toHaveBeenCalledWith('blob:doc-2')
    const anchor = click.mock.instances[0] as HTMLAnchorElement
    expect(anchor.download).toBe('q3-final.html')
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

  it('shows the load-failure notice once a frame script fails', () => {
    render(<ResultRow {...props(settledBlock(JSON.stringify({ title: 'Dash', html: DOC })))} />)
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
    render(<ResultRow {...props(settledBlock(JSON.stringify({ title: 'Dash', html: DOC })))} />)
    const frame = document.querySelector('iframe')
    if (frame === null) throw new Error('frame not rendered')

    act(() => {
      window.dispatchEvent(new MessageEvent('message', {
        data: { __dshGui: true, type: 'runtimeError', message: 'ReferenceError: cloud is not defined', line: 41 },
        source: frame.contentWindow,
      }))
    })
    expect(screen.getByText((_, el) => el?.textContent === 'Script error: ReferenceError: cloud is not defined')).toBeTruthy()

    // The first message stays the notice; repeats add nothing.
    act(() => {
      window.dispatchEvent(new MessageEvent('message', {
        data: { __dshGui: true, type: 'runtimeError', message: 'TypeError: later', line: null },
        source: frame.contentWindow,
      }))
    })
    expect(screen.getByText((_, el) => el?.textContent === 'Script error: ReferenceError: cloud is not defined')).toBeTruthy()
    expect(screen.queryByText(/TypeError: later/)).toBeNull()
  })

  it('falls back to the missing-summary when the arguments carry no document', () => {
    render(<ResultRow {...props(settledBlock('{"title":"x"}'))} />)

    expect(document.querySelector('iframe')).toBeNull()
    expect(screen.getByText('Call arguments carry no renderable HTML')).toBeTruthy()
  })

  it('copies the settled bytes and confirms briefly on the row', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    vi.useFakeTimers()
    render(<ResultRow {...props(settledBlock(JSON.stringify({ title: 'Dash', html: DOC })))} />)

    await act(async () => { screen.getByRole('button', { name: 'Copy HTML' }).click() })
    expect(writeText).toHaveBeenCalledWith(DOC)
    // The confirmation is the icon swap plus the accessible name change.
    expect(screen.getByRole('button', { name: 'Copied' })).toBeTruthy()
    act(() => { vi.advanceTimersByTime(COPY_FEEDBACK_MS) })
    expect(screen.getByRole('button', { name: 'Copy HTML' })).toBeTruthy()
  })

  it('uses the dictionary title when the arguments supply none', () => {
    render(<ResultRow {...props(settledBlock(JSON.stringify({ html: '<p>x</p>' })))} />)
    expect(screen.getByText('HTML preview')).toBeTruthy()
  })

  it('fullscreens the frame wrapper from a control before copy, reverting on the event', async () => {
    const request = vi.fn().mockResolvedValue(undefined)
    const exit = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(HTMLDivElement.prototype, 'requestFullscreen', { configurable: true, value: request })
    Object.defineProperty(document, 'exitFullscreen', { configurable: true, value: exit })
    const stubElement = (value: Element | null): void => {
      Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => value })
    }
    render(<ResultRow {...props(settledBlock(JSON.stringify({ title: 'Dash', html: DOC })))} />)
    const wrapper = document.querySelector('[class*="frameWrap"]')
    if (wrapper === null) throw new Error('frame wrapper not rendered')

    // The control sits before Copy (Comment mode between them) and
    // fullscreens the frame's wrapper.
    const copy = screen.getByRole('button', { name: 'Copy HTML' })
    expect(copy.previousElementSibling?.getAttribute('aria-label')).toBe('Comment mode')
    expect(copy.previousElementSibling?.previousElementSibling?.getAttribute('aria-label')).toBe('Fullscreen')
    await act(async () => { screen.getByRole('button', { name: 'Fullscreen' }).click() })
    expect(request).toHaveBeenCalledTimes(1)
    expect(request.mock.instances[0]).toBe(wrapper)

    // The event, not the request's promise, flips the label; Escape rides
    // the same event, so both exits revert the control.
    stubElement(wrapper)
    act(() => { document.dispatchEvent(new Event('fullscreenchange')) })
    expect(screen.getByRole('button', { name: 'Exit fullscreen' })).toBeTruthy()

    await act(async () => { screen.getByRole('button', { name: 'Exit fullscreen' }).click() })
    expect(exit).toHaveBeenCalledTimes(1)
    stubElement(null)
    act(() => { document.dispatchEvent(new Event('fullscreenchange')) })
    expect(screen.getByRole('button', { name: 'Fullscreen' })).toBeTruthy()
  })

  it('hides the fullscreen control while running or collapsed; byte actions stay', () => {
    render(<ResultRow {...props(runningBlock(JSON.stringify({ title: 'Dash', html: DOC })))} />)
    expect(screen.queryByRole('button', { name: 'Fullscreen' })).toBeNull()

    cleanup()
    render(<ResultRow {...props(settledBlock(JSON.stringify({ title: 'Dash', html: DOC })))} />)
    expect(screen.getByRole('button', { name: 'Fullscreen' })).toBeTruthy()
    act(() => { screen.getByText('Dash').click() })
    // The wrapper unmounts on collapse, so fullscreen has no surface; copy
    // and download act on the bytes and stay.
    expect(screen.queryByRole('button', { name: 'Fullscreen' })).toBeNull()
    expect(screen.getByRole('button', { name: 'Copy HTML' })).toBeTruthy()
  })

  it('forwards a settled widget prompt as one tagged turn per interval', () => {
    const setDraft = vi.fn()
    const submit = vi.fn()
    vi.useFakeTimers()
    vi.setSystemTime(1_000_000)
    render(<ResultRow {...{ ...props(settledBlock(JSON.stringify({ title: 'Dash', html: DOC }))), inputActions: { setDraft, submit } }} />)
    const frame = document.querySelector('iframe')
    if (frame === null) throw new Error('frame not rendered')

    window.dispatchEvent(new MessageEvent('message', {
      data: { __dshGui: true, type: 'sendPrompt', text: 'break down Q3 by region' },
      source: frame.contentWindow,
    }))
    expect(setDraft).toHaveBeenCalledWith('[widget] break down Q3 by region')
    expect(submit).toHaveBeenCalledTimes(1)

    window.dispatchEvent(new MessageEvent('message', {
      data: { __dshGui: true, type: 'sendPrompt', text: 'too soon' },
      source: frame.contentWindow,
    }))
    expect(submit).toHaveBeenCalledTimes(1)

    vi.advanceTimersByTime(WIDGET_PROMPT_MIN_INTERVAL_MS + 1)
    window.dispatchEvent(new MessageEvent('message', {
      data: { __dshGui: true, type: 'sendPrompt', text: 'and by product' },
      source: frame.contentWindow,
    }))
    expect(submit).toHaveBeenCalledTimes(2)
  })

  it('shows no comment controls until the call settles expanded', () => {
    render(<ResultRow {...props(runningBlock(JSON.stringify({ title: 'Dash', html: DOC })))} />)
    expect(screen.queryByRole('button', { name: 'Comment mode' })).toBeNull()

    cleanup()
    render(<ResultRow {...props(settledBlock(JSON.stringify({ title: 'Dash', html: DOC })))} />)
    expect(screen.getByRole('button', { name: 'Comment mode' })).toBeTruthy()
    act(() => { screen.getByText('Dash').click() })
    expect(screen.queryByRole('button', { name: 'Comment mode' })).toBeNull()
  })

  it('collects picks as comment rows and sends one composed widget prompt', async () => {
    const setDraft = vi.fn()
    const submit = vi.fn()
    render(<ResultRow {...{ ...props(settledBlock(JSON.stringify({ title: 'Dash', html: DOC }))), inputActions: { setDraft, submit } }} />)
    const frame = document.querySelector('iframe')
    if (frame === null) throw new Error('frame not rendered')

    // No bar before any pick.
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

    // Write a note, then Send.
    const note = screen.getByRole('textbox', { name: 'Comment note' })
    await act(async () => { fireEvent.change(note, { target: { value: 'make this bold' } }) })
    await act(async () => { screen.getByRole('button', { name: 'Send' }).click() })
    expect(submit).toHaveBeenCalledTimes(1)
    const draft = setDraft.mock.calls[0]![0] as string
    expect(draft).toContain('[widget] ')
    expect(draft).toContain('\n\n1. make this bold\n')
    expect(draft).toContain('element: <p> p')
    expect(draft).toContain('markup: <p>revenue</p>')
    // Send clears the bar and exits comment mode.
    expect(screen.queryByTestId('comment-bar')).toBeNull()
    expect(screen.getByRole('button', { name: 'Comment mode' }).getAttribute('aria-pressed')).toBe('false')
  })

  it('removes one pick from the bar and clears all', () => {
    render(<ResultRow {...props(settledBlock(JSON.stringify({ title: 'Dash', html: DOC })))} />)
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
    render(<ResultRow {...props(settledBlock(JSON.stringify({ title: 'Dash', html: DOC })))} />)
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
    render(<ResultRow {...props(settledBlock(JSON.stringify({ title: 'Dash', html: DOC })))} />)
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
