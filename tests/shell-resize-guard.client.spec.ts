// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { STREAM_SHELL } from '../src/client/shell.ts'

/** The bridge body between the shell's script tags. */
function bridgeBody(): string {
  const match = STREAM_SHELL.match(/<script>([\s\S]*)<\/script>/)
  if (!match) throw new Error('shell carries no bridge script')
  return match[1]!
}

/**
 * Minimal ResizeObserver stand-in: jsdom ships none, so the shell's guard
 * would otherwise never register at all in tests. Captures the callback so
 * a test can fire simulated resize ticks synchronously and deterministically.
 */
class FakeResizeObserver {
  static callback: (() => void) | null = null
  constructor(callback: () => void) { FakeResizeObserver.callback = callback }
  observe(): void {}
  disconnect(): void {}
}

function setScrollHeight(px: number): void {
  Object.defineProperty(document.documentElement, 'scrollHeight', { configurable: true, value: px })
}

function fireResize(): void {
  FakeResizeObserver.callback?.()
}

/** `size` posts seen through the window.postMessage spy, in call order. */
function reportedHeights(): number[] {
  const spy = window.postMessage as unknown as { mock: { calls: Array<[unknown]> } }
  return spy.mock.calls
    .map(([message]) => message as Record<string, unknown>)
    .filter(message => message.__dshGui === true && message.type === 'size')
    .map(message => message.height as number)
}

describe('resize-triggered height guard', () => {
  beforeEach(() => {
    FakeResizeObserver.callback = null
    vi.spyOn(window, 'postMessage')
    ;(window as unknown as { ResizeObserver: unknown }).ResizeObserver = FakeResizeObserver
    setScrollHeight(100)
    ;(window as unknown as { eval: (source: string) => unknown }).eval(bridgeBody())
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('reports every resize tick while growth stays within the streak limit', () => {
    for (let px = 101; px <= 107; px++) {
      setScrollHeight(px)
      fireResize()
    }
    expect(reportedHeights()).toEqual([101, 102, 103, 104, 105, 106, 107])
  })

  it('stops trusting the observer once consecutive growth exceeds the limit — the feedback-loop signature', () => {
    for (let px = 101; px <= 200; px++) {
      setScrollHeight(px)
      fireResize()
    }
    const heights = reportedHeights()
    // The streak limit (6) trips after the 7th consecutive growth tick;
    // nothing past that point is trusted, no matter how far the underlying
    // (untrustworthy) measurement keeps climbing toward 200.
    expect(heights).toEqual([101, 102, 103, 104, 105, 106, 107])
    expect(Math.max(...heights)).toBeLessThan(200)
  })

  it('never resumes reporting after the breaker trips, even if growth later stops', () => {
    for (let px = 101; px <= 110; px++) {
      setScrollHeight(px)
      fireResize()
    }
    const beforeSettle = reportedHeights().length
    // The runaway source plateaus; a naive guard might resume and report
    // this single inflated value once stable. It must not.
    setScrollHeight(110)
    fireResize()
    setScrollHeight(110)
    fireResize()
    expect(reportedHeights()).toHaveLength(beforeSettle)
  })

  it('resets the streak — and keeps reporting — on a non-growth tick before the limit trips', () => {
    setScrollHeight(101)
    fireResize()
    setScrollHeight(102)
    fireResize()
    setScrollHeight(90)
    fireResize()
    for (let px = 91; px <= 96; px++) {
      setScrollHeight(px)
      fireResize()
    }
    // The shrink reset the streak, so this run of 6 more consecutive growths
    // (right at the limit) all still report.
    expect(reportedHeights()).toEqual([101, 102, 90, 91, 92, 93, 94, 95, 96])
  })
})
