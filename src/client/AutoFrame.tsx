// Content-sized shell frame: the shared rendering surface of both visualizer
// cards. One shell `srcDoc` loads per mount; the StreamFrameController feeds
// it the document (live prefixes while streaming, one terminal commit when
// complete), and the bridge inside reports measured content height back, so
// the frame grows with the document instead of trimming it at a fixed
// viewport. The card opens at chat-line height and grows with the content;
// scroll appears only past the height cap.

import { useCallback, useEffect, useRef, useState } from 'react'
import { StreamFrameController } from './stream-bridge.ts'
import { STREAM_SHELL } from './shell.ts'

/** Live phase of the document this frame renders. */
export type AutoFramePhase = 'streaming' | 'complete'

/** Height bounds of the auto-sized frame; the cap mirrors the tool's maximum. */
export const MIN_FRAME_HEIGHT_PX = 24
export const MAX_FRAME_HEIGHT_PX = 4_000
/** Height while the document is still empty — the card starts as a chat line and grows. */
export const START_FRAME_HEIGHT_PX = 32

/** Props of the content-sized shell frame. */
export interface AutoFrameProps {
  /** Accessible frame title. */
  readonly title: string
  /** Live prefix while streaming; complete document once complete. */
  readonly html: string
  /** `streaming` keeps feeding prefixes; `complete` commits once and runs scripts. */
  readonly phase: AutoFramePhase
  /** Pixel height until the first content measurement arrives. */
  readonly initialHeight: number
  /** Class name of the frame element; always provided by both cards. */
  readonly className: string | undefined
}

/**
 * One content-sized sandboxed frame over the streaming shell.
 * @param props - document, phase, initial height, and frame chrome.
 */
export function AutoFrame({ title, html, phase, initialHeight, className }: AutoFrameProps) {
  const controller = useRef<StreamFrameController | null>(null)
  const frameEl = useRef<HTMLIFrameElement | null>(null)
  const [heightPx, setHeightPx] = useState(initialHeight)

  const attach = useCallback((frame: HTMLIFrameElement | null): void => {
    controller.current?.destroy()
    controller.current = frame === null ? null : new StreamFrameController(frame)
    frameEl.current = frame
  }, [])
  useEffect(() => (): void => { controller.current?.destroy() }, [])
  useEffect(() => {
    const bridge = controller.current
    if (bridge === null) return
    if (phase === 'complete') bridge.commit(html)
    else bridge.update(html)
  }, [html, phase])
  // A late-decoded explicit height argument supersedes the default until the
  // first measurement arrives; measurements then own the height.
  useEffect(() => { setHeightPx(initialHeight) }, [initialHeight])
  useEffect(() => {
    const onMessage = (event: MessageEvent): void => {
      if (event.source !== frameEl.current?.contentWindow) return
      const data = event.data as { __dshGui?: boolean; type?: string; height?: unknown } | null
      if (data === null || typeof data !== 'object' || data.__dshGui !== true || data.type !== 'size') return
      if (typeof data.height !== 'number' || !Number.isFinite(data.height)) return
      setHeightPx(Math.max(MIN_FRAME_HEIGHT_PX, Math.min(MAX_FRAME_HEIGHT_PX, Math.ceil(data.height))))
    }
    window.addEventListener('message', onMessage)
    return () => { window.removeEventListener('message', onMessage) }
  }, [])

  return (
    <iframe
      ref={attach}
      className={className}
      srcDoc={STREAM_SHELL}
      title={title}
      sandbox="allow-scripts"
      style={{ height: `${heightPx}px` }}
    />
  )
}
