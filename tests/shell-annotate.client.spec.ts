// @vitest-environment jsdom
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { STREAM_SHELL } from '../src/client/shell.ts'

/** The bridge body between the shell's script tags. */
function bridgeBody(): string {
  const match = STREAM_SHELL.match(/<script>([\s\S]*)<\/script>/)
  if (!match) throw new Error('shell carries no bridge script')
  return match[1]!
}

/** Deliver one bridge-protocol message to the bridge under test. */
function postToBridge(message: Record<string, unknown>): void {
  window.dispatchEvent(new MessageEvent('message', { data: message }))
}

/** Bridge posts of one type seen through the window.postMessage spy. */
function postsOfType(type: string): Array<Record<string, unknown>> {
  return postSpy.mock.calls
    .map(([message]) => message as Record<string, unknown>)
    .filter(message => message.__dshGui === true && message.type === type)
}

let postSpy: ReturnType<typeof vi.spyOn>

beforeAll(() => {
  postSpy = vi.spyOn(window, 'postMessage')
  // jsdom never runs srcDoc scripts, so the bridge is evaluated directly:
  // its bare `document`/`window` resolve to this test realm's copies.
  ;(window as unknown as { eval: (source: string) => unknown }).eval(bridgeBody())
})

beforeEach(() => {
  postSpy.mockClear()
  document.body.innerHTML = ''
  // One module registry serves the file: the bridge keeps annotating state
  // across specs, and a wiped body would strand its overlay detached. Exit
  // mode first so every spec enters from a clean, re-attached overlay.
  window.dispatchEvent(new MessageEvent('message', { data: { __dshGui: true, type: 'annotate', on: false } }))
})

describe('frame annotation mode', () => {
  /** The viewport div the shell renders into; the bridge requires it. */
  function viewport(): HTMLElement {
    let vp = document.getElementById('dsh-gui-viewport')
    if (vp === null) {
      vp = document.createElement('div')
      vp.id = 'dsh-gui-viewport'
      document.body.appendChild(vp)
    }
    return vp
  }

  /** A div inside the viewport with tag/text/position configured. */
  function target(text: string): HTMLDivElement {
    const el = document.createElement('div')
    el.textContent = text
    viewport().appendChild(el)
    return el
  }

  it('stays dormant until the host arms the mode', () => {
    const el = target('revenue')
    const event = new MouseEvent('click', { bubbles: true, cancelable: true })
    el.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(false)
    expect(postsOfType('annotation')).toHaveLength(0)
  })

  it('picks the clicked element and posts a bounded bundle', () => {
    const el = target('revenue by region')
    postToBridge({ __dshGui: true, type: 'annotate', on: true })

    const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true })
    el.dispatchEvent(event)
    expect(event.defaultPrevented).toBe(true)

    // jsdom's elementFromPoint returns null; stub it to the clicked node.
    vi.stubGlobal('elementFromPoint', undefined)
    document.elementFromPoint = (): Element => el
    const up = new MouseEvent('mouseup', { bubbles: true, cancelable: true, clientX: 3, clientY: 3 })
    el.dispatchEvent(up)
    delete document.elementFromPoint

    const picks = postsOfType('annotation')
    expect(picks).toHaveLength(1)
    const pick = picks[0]!.pick as Record<string, unknown>
    expect(pick.kind).toBe('element')
    expect(pick.tag).toBe('div')
    // The selector anchors at the shell viewport's id, picked element at
    // the chain's right end (ancestor-left, descendant-right).
    expect(pick.selector).toBe('div[id="dsh-gui-viewport"] > div')
    expect(pick.text).toBe('revenue by region')
    expect(String(pick.snippet)).toContain('revenue by region')

    // The mark box landed in the overlay, inside the body.
    expect(document.querySelector('[data-dsh-annotate-box="mark"]')).not.toBeNull()
  })

  it('arm is idempotent and exit removes every mark and listener', () => {
    const el = target('chart')
    document.elementFromPoint = (): Element => el
    postToBridge({ __dshGui: true, type: 'annotate', on: true })
    postToBridge({ __dshGui: true, type: 'annotate', on: true })

    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, clientX: 1, clientY: 1 }))
    expect(postsOfType('annotation')).toHaveLength(1)

    postToBridge({ __dshGui: true, type: 'annotate', on: false })
    expect(document.querySelector('[data-dsh-annotate-overlay]')).toBeNull()

    // After exit the document is pristine again.
    const click = new MouseEvent('click', { bubbles: true, cancelable: true })
    el.dispatchEvent(click)
    expect(click.defaultPrevented).toBe(false)
  })

  it('reports its own Escape exit to the host', () => {
    postToBridge({ __dshGui: true, type: 'annotate', on: true })
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    const exits = postsOfType('annotateExited')
    expect(exits).toHaveLength(1)
    // The overlay detaches on exit; mark boxes wait inside it for a re-enter.
    expect(document.querySelector('[data-dsh-annotate-overlay]')).toBeNull()
  })

  it('re-attaches kept marks when the mode re-enters', () => {
    const el = target('kpi')
    document.elementFromPoint = (): Element => el
    postToBridge({ __dshGui: true, type: 'annotate', on: true })
    // Prune residue from earlier specs; one module registry serves the file.
    postToBridge({ __dshGui: true, type: 'annotate-marks', ids: [] })
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, clientX: 2, clientY: 2 }))
    expect(document.querySelectorAll('[data-dsh-annotate-box="mark"]')).toHaveLength(1)
    postToBridge({ __dshGui: true, type: 'annotate', on: false })
    expect(document.querySelector('[data-dsh-annotate-overlay]')).toBeNull()
    expect(document.querySelectorAll('[data-dsh-annotate-box="mark"]')).toHaveLength(0)

    postToBridge({ __dshGui: true, type: 'annotate', on: true })
    expect(document.querySelector('[data-dsh-annotate-overlay]')).not.toBeNull()
    expect(document.querySelectorAll('[data-dsh-annotate-box="mark"]')).toHaveLength(1)

    // The host prunes removed picks; the mark follows.
    postToBridge({ __dshGui: true, type: 'annotate-marks', ids: [] })
    expect(document.querySelectorAll('[data-dsh-annotate-box="mark"]')).toHaveLength(0)
  })

  it('syncs marks to the host list, dropping removed ids', () => {
    const el = target('kpi')
    document.elementFromPoint = (): Element => el
    postToBridge({ __dshGui: true, type: 'annotate', on: true })
    postToBridge({ __dshGui: true, type: 'annotate-marks', ids: [] })
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, clientX: 2, clientY: 2 }))
    const id = (postsOfType('annotation')[0]!.pick as Record<string, unknown>).id as string
    expect(document.querySelectorAll('[data-dsh-annotate-box="mark"]')).toHaveLength(1)

    postToBridge({ __dshGui: true, type: 'annotate-marks', ids: [id] })
    expect(document.querySelectorAll('[data-dsh-annotate-box="mark"]')).toHaveLength(1)
    postToBridge({ __dshGui: true, type: 'annotate-marks', ids: [] })
    expect(document.querySelectorAll('[data-dsh-annotate-box="mark"]')).toHaveLength(0)
  })

  it('derives a stable selector with nth-of-type among siblings', () => {
    const vp = viewport()
    const first = document.createElement('section')
    first.textContent = 'one'
    const second = document.createElement('section')
    second.textContent = 'two'
    vp.append(first, second)

    postToBridge({ __dshGui: true, type: 'annotate', on: true })
    document.elementFromPoint = (): Element => second
    second.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    second.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, clientX: 2, clientY: 2 }))

    const pick = postsOfType('annotation')[0]!.pick as Record<string, unknown>
    // nth-of-type among same-tag siblings, anchored by the viewport id.
    expect(pick.selector).toBe('div[id="dsh-gui-viewport"] > section:nth-of-type(2)')
  })
  it('ignores picks outside the rendered viewport', () => {
    const outside = document.createElement('div')
    outside.textContent = 'chrome'
    document.body.appendChild(outside)

    postToBridge({ __dshGui: true, type: 'annotate', on: true })
    outside.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
    outside.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, clientX: 1, clientY: 1 }))
    expect(postsOfType('annotation')).toHaveLength(0)
  })

  it('marks a dragged area named by the element at its center', () => {
    const el = target('wide banner')
    document.elementFromPoint = (): Element => el
    postToBridge({ __dshGui: true, type: 'annotate', on: true })
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }))
    el.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true, clientX: 60, clientY: 40 }))
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, clientX: 60, clientY: 40 }))

    const picks = postsOfType('annotation')
    expect(picks).toHaveLength(1)
    const pick = picks[0]!.pick as Record<string, unknown>
    expect(pick.kind).toBe('area')
    expect(pick.tag).toBe('div')
  })

  it('skips a dragged area whose center resolves to nothing', () => {
    const el = target('edge case')
    postToBridge({ __dshGui: true, type: 'annotate', on: true })
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX: 10, clientY: 10 }))
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, clientX: 60, clientY: 40 }))
    expect(postsOfType('annotation')).toHaveLength(0)
  })
})
