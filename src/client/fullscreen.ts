/** Frame-fullscreen plumbing shared by both visualizer rows. */

import { useCallback, useEffect, useRef, useState } from 'react'

/** Fullscreen state and toggle of one frame wrapper. */
export interface FrameFullscreen {
  /** Attach to the element to fullscreen — the frame's wrapper. */
  readonly ref: (element: HTMLDivElement | null) => void
  /** True while this wrapper is the document's fullscreen element. */
  readonly active: boolean
  /** Enter fullscreen, or leave when this wrapper already holds it. */
  readonly toggle: () => void
}

/**
 * One wrapper's document-fullscreen state and toggle. The wrapper, not the
 * frame element, is the fullscreen surface: the stylesheet then stretches the
 * measured frame to the viewport and grounds transparent-canvas documents.
 * The event — not the request's promise — is the state's source of truth, so
 * an exit from elsewhere (Escape, the browser's own UI) reverts the label.
 */
export function useFrameFullscreen(): FrameFullscreen {
  const elementRef = useRef<HTMLDivElement | null>(null)
  const [active, setActive] = useState(false)
  useEffect(() => {
    const sync = (): void => { setActive(document.fullscreenElement === elementRef.current) }
    document.addEventListener('fullscreenchange', sync)
    return () => { document.removeEventListener('fullscreenchange', sync) }
  }, [])
  const ref = useCallback((element: HTMLDivElement | null): void => {
    elementRef.current = element
    // A wrapper unmounted while fullscreen (row hidden, key taken over) ends
    // the session in the browser; keep the label from sticking at exit.
    if (element === null) setActive(false)
  }, [])
  const toggle = useCallback((): void => {
    const element = elementRef.current
    if (element === null) return
    if (document.fullscreenElement === element) {
      void document.exitFullscreen().catch(() => {})
      return
    }
    // Absent on engines without element fullscreen (iPhone Safari): the
    // control stays but cannot enter, matching the frame's own capability.
    if (typeof element.requestFullscreen !== 'function') return
    void element.requestFullscreen().catch(() => {})
  }, [])
  return { ref, active, toggle }
}
