// @vitest-environment jsdom
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { STREAM_SHELL } from '../src/client/shell.ts'

/** The bridge body between the shell's script tags. */
function bridgeBody(): string {
  const match = STREAM_SHELL.match(/<script>([\s\S]*)<\/script>/)
  if (!match) throw new Error('shell carries no bridge script')
  return match[1]!
}

describe('frame navigation guard', () => {
  const scrollSpy = vi.fn()
  let postSpy: ReturnType<typeof vi.spyOn>

  beforeAll(() => {
    Element.prototype.scrollIntoView = scrollSpy as unknown as typeof Element.prototype.scrollIntoView
    postSpy = vi.spyOn(window, 'postMessage')
    // jsdom never runs srcDoc scripts, so the bridge is evaluated directly:
    // its bare `document`/`window` resolve to this test realm's copies.
    ;(window as unknown as { eval: (source: string) => unknown }).eval(bridgeBody())
  })

  beforeEach(() => {
    scrollSpy.mockClear()
    postSpy.mockClear()
  })

  /** Click one element; returns whether the default action was prevented. */
  function click(el: Element): boolean {
    const event = new MouseEvent('click', { bubbles: true, cancelable: true })
    el.dispatchEvent(event)
    return event.defaultPrevented
  }

  /** An anchor appended to the body with the given raw href. */
  function anchor(href: string): HTMLAnchorElement {
    const a = document.createElement('a')
    a.setAttribute('href', href)
    document.body.appendChild(a)
    return a
  }

  /** Bridge posts of one type seen through the window.postMessage spy. */
  function postsOfType(type: string): Array<Record<string, unknown>> {
    return postSpy.mock.calls
      .map(([message]) => message as Record<string, unknown>)
      .filter(message => message.__dshGui === true && message.type === type)
  }

  it('converts a fragment anchor into an in-place scroll', () => {
    const target = document.createElement('div')
    target.id = 's1'
    document.body.appendChild(target)
    const link = anchor('#s1')

    expect(click(link)).toBe(true)
    expect(scrollSpy).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' })
    expect(postsOfType('openLink')).toHaveLength(0)
  })

  it('forwards absolute http(s) anchors through the host link gate', () => {
    const link = anchor('https://example.com/report')

    expect(click(link)).toBe(true)
    expect(postsOfType('openLink')).toEqual([
      { __dshGui: true, type: 'openLink', url: 'https://example.com/report' },
    ])
    expect(scrollSpy).not.toHaveBeenCalled()
  })

  it('drops relative and non-http anchors without navigating or posting', () => {
    expect(click(anchor('page.html'))).toBe(true)
    expect(click(anchor('javascript:void(0)'))).toBe(true)
    expect(click(anchor('#'))).toBe(true)

    expect(postsOfType('openLink').some(post => post.url === 'page.html')).toBe(false)
    expect(postsOfType('openLink').some(post => post.url === 'javascript:void(0)')).toBe(false)
    expect(scrollSpy).not.toHaveBeenCalled()
  })

  it('prevents but ignores a fragment anchor whose target is missing', () => {
    expect(click(anchor('#nope'))).toBe(true)
    expect(scrollSpy).not.toHaveBeenCalled()
  })

  it('leaves non-anchor clicks untouched', () => {
    const button = document.createElement('button')
    button.textContent = 'filter'
    document.body.appendChild(button)

    expect(click(button)).toBe(false)
    expect(postsOfType('openLink')).toHaveLength(0)
  })
})
