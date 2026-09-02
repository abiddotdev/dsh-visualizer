/**
 * Host-side driver of one live streaming card's iframe. The shell `srcDoc`
 * loads once; this controller feeds the growing document prefix to the
 * frame's bridge as coalesced `render` messages — latest-wins on one
 * animation frame, with a minimum gap between flushes so a token burst
 * collapses into at most one markup replace per interval — and finishes with
 * a single authoritative `commit` that runs the document's scripts exactly
 * once. Messages posted before the shell's `load` event are buffered and
 * flushed in order, because a frame that has not loaded drops them.
 */

/** Minimum gap between streaming markup flushes, in milliseconds. */
const RENDER_INTERVAL_MS = 50

/** Frame-coupled scheduling seam; the browser default uses animation frames. */
export interface FrameScheduler {
  /** Schedule one callback with a monotonic timestamp.
   * @param callback - flush callback receiving the scheduler's timestamp.
   * @returns a cancellable handle.
   */
  raf(callback: (ts: number) => void): number
  /** Cancel a scheduled callback.
   * @param handle - handle returned by {@link FrameScheduler.raf}.
   */
  cancelRaf(handle: number): void
}

/** The frame surface the controller needs; satisfied by HTMLIFrameElement. */
export interface BridgeFrame {
  readonly contentWindow: {
    /** Deliver one message into the frame.
     * @param message - bridge protocol message.
     * @param targetOrigin - always `'*'`: the frame runs at a null origin.
     */
    postMessage(message: unknown, targetOrigin: string): void
  } | null
  /** Register a shell-load listener.
   * @param type - always `'load'`.
   * @param listener - event listener marking the bridge ready.
   */
  addEventListener(type: 'load', listener: () => void): void
  /** Drop the shell-load listener registered above.
   * @param type - always `'load'`.
   * @param listener - the listener addEventListener received.
   */
  removeEventListener(type: 'load', listener: () => void): void
}

const browserScheduler: FrameScheduler = {
  raf: callback => requestAnimationFrame(callback),
  cancelRaf: (handle) =>{  cancelAnimationFrame(handle) },
}

/** Drives one streaming card's shell frame. */
export class StreamFrameController {
  private readonly frame: BridgeFrame
  private readonly scheduler: FrameScheduler
  private readonly onLoad = (): void => {
    this.ready = true
    for (const message of this.queue) this.post(message)
    this.queue = []
  }
  private ready = false
  private queue: unknown[] = []
  private pending: string | null = null
  private handle: number | null = null
  private lastFlushTs = 0
  private done = false

  /**
   * @param frame - the shell iframe; its load event arms message delivery.
   * @param scheduler - flush scheduling seam; the default uses animation frames.
   */
  constructor(frame: BridgeFrame, scheduler: FrameScheduler = browserScheduler) {
    this.frame = frame
    this.scheduler = scheduler
    frame.addEventListener('load', this.onLoad)
  }

  /** Feed the latest document prefix; coalesced per {@link RENDER_INTERVAL_MS}.
   * @param html - Longest well-formed prefix of the streaming document. */
  update(html: string): void {
    if (this.done) return
    this.pending = html
    if (this.handle !== null) return
    this.handle = this.scheduler.raf((ts) => {
      this.handle = null
      if (this.done || this.pending === null) return
      // First flush bypasses the interval so the preview appears immediately.
      if (this.lastFlushTs !== 0 && ts - this.lastFlushTs < RENDER_INTERVAL_MS) {
        this.handle = this.scheduler.raf((later) => {
          this.handle = null
          this.flush(later)
        })
        return
      }
      this.flush(ts)
    })
  }

  /** Apply the final document and run its scripts once; terminal.
   * @param html - Complete document; supersedes any pending prefix. */
  commit(html: string): void {
    if (this.done) return
    this.done = true
    if (this.handle !== null) this.scheduler.cancelRaf(this.handle)
    this.handle = null
    this.pending = null
    this.post({ __dshGui: true, type: 'commit', html })
  }

  /** Stop driving the frame and drop the load listener. */
  destroy(): void {
    this.done = true
    if (this.handle !== null) this.scheduler.cancelRaf(this.handle)
    this.handle = null
    this.pending = null
    this.queue = []
    this.frame.removeEventListener('load', this.onLoad)
  }

  /** Toggle the frame's comment mode; ignored while the stream runs.
   * @param on - true to arm picking, false to disarm. */
  setAnnotate(on: boolean): void {
    if (!this.done) return
    this.post({ __dshGui: true, type: 'annotate', on })
  }

  /** Sync the frame's mark set to the card's live annotations.
   * @param ids - ids of picks that keep their overlay mark. */
  setAnnotationMarks(ids: readonly string[]): void {
    if (!this.done) return
    this.post({ __dshGui: true, type: 'annotate-marks', ids: [...ids] })
  }

  private flush(ts: number): void {
    if (this.done || this.pending === null) return
    const html = this.pending
    this.pending = null
    this.lastFlushTs = ts
    this.post({ __dshGui: true, type: 'render', html })
  }

  private post(message: unknown): void {
    if (this.ready) this.frame.contentWindow?.postMessage(message, '*')
    else this.queue.push(message)
  }
}
