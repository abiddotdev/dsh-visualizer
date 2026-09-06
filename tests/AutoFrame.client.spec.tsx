// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AutoFrame } from '../src/client/AutoFrame.tsx'

// Without this, an earlier test's mounted iframe stays in the document and
// frameOf() below can silently grab it instead of the current test's own.
afterEach(() => {
  cleanup()
})

/** The rendered iframe element of one mounted AutoFrame. */
function frameOf(): HTMLIFrameElement {
  const frame = document.querySelector('iframe')
  if (frame === null) throw new Error('frame not rendered')
  return frame
}

describe('AutoFrame height ownership', () => {
  it('applies the argument height until the first measurement, never after', () => {
    const view = render(
      <AutoFrame
        title="Dash"
        html="<p>x</p>"
        phase="streaming"
        initialHeight={100}
        className=""
      />,
    )
    expect(frameOf().style.height).toBe('100px')

    // A late-decoded height argument still applies before any measurement.
    view.rerender(
      <AutoFrame
        title="Dash"
        html="<p>x</p>"
        phase="streaming"
        initialHeight={150}
        className=""
      />,
    )
    expect(frameOf().style.height).toBe('150px')

    // A measurement arrives; it owns the height from here on.
    act(() => {
      window.dispatchEvent(new MessageEvent('message', {
        data: { __dshGui: true, type: 'size', height: 222 },
        source: frameOf().contentWindow,
      }))
    })
    expect(frameOf().style.height).toBe('222px')

    // The schema serializes height before html, so the argument pops to its
    // decoded value hundreds of milliseconds into the stream; applying it
    // then would yank the growing frame back mid-stream.
    view.rerender(
      <AutoFrame
        title="Dash"
        html="<p>x</p>"
        phase="streaming"
        initialHeight={480}
        className=""
      />,
    )
    expect(frameOf().style.height).toBe('222px')
  })
})

describe('AutoFrame share-status bridge', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  /** Posts of one type sent into the frame's own window, in call order. */
  function postsOfType(spy: ReturnType<typeof vi.fn>, type: string): Array<Record<string, unknown>> {
    return spy.mock.calls
      .map(([message]) => message as Record<string, unknown>)
      .filter(message => message.__dshGui === true && message.type === type)
  }

  it('answers the widget\'s boot-time request with the current prop', () => {
    render(
      <AutoFrame
        title="Dash"
        html="<p>x</p>"
        phase="complete"
        initialHeight={100}
        className=""
        shareStatus={{ exported: true, url: 'https://host.example/x.html' }}
      />,
    )
    const post = vi.spyOn(frameOf().contentWindow!, 'postMessage')
    act(() => {
      window.dispatchEvent(new MessageEvent('message', {
        data: { __dshGui: true, type: 'share-status-request' },
        source: frameOf().contentWindow,
      }))
    })
    expect(postsOfType(post as unknown as ReturnType<typeof vi.fn>, 'share-status')).toEqual([
      { __dshGui: true, type: 'share-status', exported: true, url: 'https://host.example/x.html' },
    ])
  })

  it('answers not-exported by default, without a shareStatus prop', () => {
    render(<AutoFrame title="Dash" html="<p>x</p>" phase="complete" initialHeight={100} className="" />)
    const post = vi.spyOn(frameOf().contentWindow!, 'postMessage')
    act(() => {
      window.dispatchEvent(new MessageEvent('message', {
        data: { __dshGui: true, type: 'share-status-request' },
        source: frameOf().contentWindow,
      }))
    })
    expect(postsOfType(post as unknown as ReturnType<typeof vi.fn>, 'share-status')).toEqual([
      { __dshGui: true, type: 'share-status', exported: false, url: null },
    ])
  })

  it('pushes an update into the frame when the prop changes, without waiting for a request', () => {
    const view = render(
      <AutoFrame title="Dash" html="<p>x</p>" phase="complete" initialHeight={100} className="" shareStatus={{ exported: false, url: null }} />,
    )
    const post = vi.spyOn(frameOf().contentWindow!, 'postMessage')
    view.rerender(
      <AutoFrame title="Dash" html="<p>x</p>" phase="complete" initialHeight={100} className="" shareStatus={{ exported: true, url: 'https://host.example/y.html' }} />,
    )
    expect(postsOfType(post as unknown as ReturnType<typeof vi.fn>, 'share-status')).toEqual([
      { __dshGui: true, type: 'share-status', exported: true, url: 'https://host.example/y.html' },
    ])
  })
})
