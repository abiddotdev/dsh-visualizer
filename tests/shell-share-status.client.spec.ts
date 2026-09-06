// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { STREAM_SHELL } from '../src/client/shell.ts'

/** The bridge body between the shell's script tags. */
function bridgeBody(): string {
  const match = STREAM_SHELL.match(/<script>([\s\S]*)<\/script>/)
  if (!match) throw new Error('shell carries no bridge script')
  return match[1]!
}

/** Bridge posts of one type seen through the window.postMessage spy. */
function postsOfType(spy: ReturnType<typeof vi.fn>, type: string): Array<Record<string, unknown>> {
  return spy.mock.calls
    .map(([message]) => message as Record<string, unknown>)
    .filter(message => message.__dshGui === true && message.type === type)
}

function receiveShareStatus(exported: boolean, url: string | null): void {
  window.dispatchEvent(new MessageEvent('message', {
    data: { __dshGui: true, type: 'share-status', exported, url },
  }))
}

describe('window.share bridge', () => {
  let postSpy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    postSpy = vi.spyOn(window, 'postMessage') as unknown as ReturnType<typeof vi.fn>
    // jsdom never runs srcDoc scripts, so the bridge is evaluated directly:
    // its bare `document`/`window`/`parent` resolve to this test realm's copies.
    ;(window as unknown as { eval: (source: string) => unknown }).eval(bridgeBody())
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('starts unshared and requests status once at boot', () => {
    expect((window as unknown as { share: unknown }).share).toEqual({ exported: false, url: null })
    expect(postsOfType(postSpy, 'share-status-request')).toEqual([{ __dshGui: true, type: 'share-status-request' }])
  })

  it('applies a pushed status onto window.share', () => {
    receiveShareStatus(true, 'https://host.example/artifacts/visualizer/dash-abc.html?k=t')
    expect((window as unknown as { share: unknown }).share).toEqual({
      exported: true,
      url: 'https://host.example/artifacts/visualizer/dash-abc.html?k=t',
    })
  })

  it('dispatches a dsh-share-status event carrying the same snapshot', () => {
    // Each test's beforeEach evaluates a fresh bridge instance onto the one
    // shared jsdom window without tearing down the previous instance's
    // listener (there is no handle to remove it by), so a later test's
    // dispatch can also reach an earlier instance's still-attached listener.
    // The count is therefore incidental; the payload on every firing is not.
    const handler = vi.fn()
    window.addEventListener('dsh-share-status', handler)
    receiveShareStatus(true, 'https://host.example/x.html')
    expect(handler.mock.calls.length).toBeGreaterThan(0)
    for (const [event] of handler.mock.calls) {
      expect((event as CustomEvent).detail).toEqual({ exported: true, url: 'https://host.example/x.html' })
    }
    window.removeEventListener('dsh-share-status', handler)
  })

  it('normalizes a malformed push rather than trusting it', () => {
    window.dispatchEvent(new MessageEvent('message', {
      data: { __dshGui: true, type: 'share-status', exported: 'yes', url: 42 },
    }))
    expect((window as unknown as { share: unknown }).share).toEqual({ exported: true, url: null })
  })

  it('reverts to unshared when the host reports so, e.g. after a delete', () => {
    receiveShareStatus(true, 'https://host.example/x.html')
    receiveShareStatus(false, null)
    expect((window as unknown as { share: unknown }).share).toEqual({ exported: false, url: null })
  })

  it('ignores messages missing the bridge marker', () => {
    window.dispatchEvent(new MessageEvent('message', { data: { type: 'share-status', exported: true, url: 'x' } }))
    expect((window as unknown as { share: unknown }).share).toEqual({ exported: false, url: null })
  })
})
