// @vitest-environment jsdom
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { STREAM_SHELL } from '../src/client/shell.ts'

/** The bridge body between the shell's script tags. */
function bridgeBody(): string {
  const match = STREAM_SHELL.match(/<script>([\s\S]*)<\/script>/)
  if (!match) throw new Error('shell carries no bridge script')
  return match[1]!
}

describe('streaming height heartbeat', () => {
  beforeAll(() => {
    vi.useFakeTimers()
    vi.spyOn(window, 'postMessage')
    ;(window as unknown as { eval: (source: string) => unknown }).eval(bridgeBody())
  })

  /** Bridge `size` posts seen through the window.postMessage spy. */
  function sizePosts(): Array<Record<string, unknown>> {
    const spy = window.postMessage as unknown as { mock: { calls: Array<[unknown]> } }
    return spy.mock.calls
      .map(([message]) => message as Record<string, unknown>)
      .filter(message => message.__dshGui === true && message.type === 'size')
  }

  it('re-reports the measured height every 500ms while frozen', () => {
    expect(sizePosts()).toHaveLength(0)

    vi.advanceTimersByTime(500)
    const afterOneTick = sizePosts().length
    expect(afterOneTick).toBeGreaterThan(0)

    vi.advanceTimersByTime(500)
    expect(sizePosts().length).toBeGreaterThan(afterOneTick)
  })

  it('stops reporting after the document commits', () => {
    window.dispatchEvent(new MessageEvent('message', {
      data: { __dshGui: true, type: 'commit', html: '<p>done</p>' },
      source: window,
    }))
    // The commit path itself reports exactly once.
    const atCommit = sizePosts().length
    expect(atCommit).toBeGreaterThan(0)

    vi.advanceTimersByTime(2000)
    expect(sizePosts()).toHaveLength(atCommit)
  })
})
