// @vitest-environment jsdom
import { act, render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AutoFrame } from '../src/client/AutoFrame.tsx'

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
