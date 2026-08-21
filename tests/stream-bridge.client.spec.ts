import { describe, expect, it } from 'vitest'
import type { BridgeFrame } from '../src/client/stream-bridge.ts'
import { StreamFrameController, type FrameScheduler } from '../src/client/stream-bridge.ts'

interface Posted {
  message: unknown
  targetOrigin: string
}

/** Manual animation-frame clock driving the controller's scheduler seam. */
class ManualClock {
  private nextHandle = 1
  private queue: { handle: number; callback: (ts: number) => void }[] = []
  private now = 1_000
  readonly scheduler: FrameScheduler = {
    raf: (callback) => {
      const handle = this.nextHandle++
      this.queue.push({ handle, callback })
      return handle
    },
    cancelRaf: (handle) => {
      this.queue = this.queue.filter(entry => entry.handle !== handle)
    },
  }

  fire(): void {
    this.now += 16
    const entries = this.queue
    this.queue = []
    for (const entry of entries) entry.callback(this.now)
  }

  /** Advance past the render interval so the next flush is not deferred. */
  advancePastInterval(): void {
    this.now += 100
  }

  get current(): number {
    return this.now
  }
}

function fakeFrame() {
  const posted: Posted[] = []
  const listeners: (() => void)[] = []
  const frame: BridgeFrame = {
    contentWindow: {
      postMessage: (message: unknown, targetOrigin: string) => {
        posted.push({ message, targetOrigin })
      },
    },
    addEventListener: (_type, listener) => {
      listeners.push(listener)
    },
    removeEventListener: (_type, listener) => {
      const index = listeners.indexOf(listener)
      if (index >= 0) listeners.splice(index, 1)
    },
  }
  return {
    frame,
    posted,
    load: (): void => {
      for (const listener of listeners) listener()
    },
  }
}

describe('StreamFrameController', () => {
  it('coalesces a burst of updates into one render per interval, first flush immediate', () => {
    const clock = new ManualClock()
    const { frame, posted, load } = fakeFrame()
    const controller = new StreamFrameController(frame, clock.scheduler)
    load()
    controller.update('<p>a')
    controller.update('<p>ab')
    controller.update('<p>abc')
    clock.fire()
    expect(posted.map(entry => entry.message)).toEqual([{ __dshGui: true, type: 'render', html: '<p>abc' }])

    // Within the interval the next burst waits; the newest partial wins.
    controller.update('<p>abcd')
    clock.fire()
    expect(posted).toHaveLength(1)
    clock.advancePastInterval()
    clock.fire()
    expect(posted.map(entry => entry.message)).toEqual([
      { __dshGui: true, type: 'render', html: '<p>abc' },
      { __dshGui: true, type: 'render', html: '<p>abcd' },
    ])
    controller.destroy()
  })

  it('buffers messages until the shell load fires, preserving order', () => {
    const clock = new ManualClock()
    const { frame, posted, load } = fakeFrame()
    const controller = new StreamFrameController(frame, clock.scheduler)
    controller.update('<p>a')
    clock.fire()
    controller.commit('<p>done')
    expect(posted).toEqual([])

    load()
    expect(posted.map(entry => entry.message)).toEqual([
      { __dshGui: true, type: 'render', html: '<p>a' },
      { __dshGui: true, type: 'commit', html: '<p>done' },
    ])
    controller.destroy()
  })

  it('commit is authoritative and terminal: pending renders are cancelled, later updates ignored', () => {
    const clock = new ManualClock()
    const { frame, posted, load } = fakeFrame()
    const controller = new StreamFrameController(frame, clock.scheduler)
    load()
    controller.update('<p>partial')
    controller.commit('<p>final')
    controller.update('<p>late')
    clock.fire()
    clock.advancePastInterval()
    clock.fire()
    expect(posted.map(entry => entry.message)).toEqual([{ __dshGui: true, type: 'commit', html: '<p>final' }])
    controller.destroy()
  })

  it('destroy cancels scheduled work, drops buffered messages, and detaches the load listener', () => {
    const clock = new ManualClock()
    const { frame, posted, load } = fakeFrame()
    const controller = new StreamFrameController(frame, clock.scheduler)
    controller.update('<p>a')
    controller.destroy()
    clock.fire()
    load()
    expect(posted).toEqual([])
  })
})
