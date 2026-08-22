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

/**
 * Height bounds of the measured frame. Deliberately wider than the tool's
 * 50–2000 argument validation: measurements own the height after the first
 * report, and settled content may legitimately outgrow the opening viewport
 * the call requested, so this cap bounds page layout, not the argument.
 */
export const MIN_FRAME_HEIGHT_PX = 24
export const MAX_FRAME_HEIGHT_PX = 4_000
/** Height while the document is still empty — the card starts as a chat line and grows. */
export const START_FRAME_HEIGHT_PX = 32

/** Minimum gap between accepted widget prompts; bounds agent self-looping. */
export const WIDGET_PROMPT_MIN_INTERVAL_MS = 3_000
/** Longest prompt text accepted from a widget. */
export const WIDGET_PROMPT_MAX_CHARS = 4_000
/** Longest link URL accepted from a widget. */
export const WIDGET_URL_MAX_CHARS = 2_048

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
  /** Widget-initiated prompt, already validated and rate-limited. */
  readonly onPrompt?: ((text: string) => void) | undefined
  /** Widget-initiated link target, already validated. */
  readonly onOpenLink?: ((url: string) => void) | undefined
}

/**
 * One content-sized sandboxed frame over the streaming shell.
 * @param props - document, phase, initial height, and frame chrome.
 */
export function AutoFrame({ title, html, phase, initialHeight, className, onPrompt, onOpenLink }: AutoFrameProps) {
  const controller = useRef<StreamFrameController | null>(null)
  const frameEl = useRef<HTMLIFrameElement | null>(null)
  const [heightPx, setHeightPx] = useState(initialHeight)
  // Latest-callback refs keep one stable message listener across renders.
  const onPromptRef = useRef(onPrompt)
  const onOpenLinkRef = useRef(onOpenLink)
  const lastPromptAtRef = useRef(0)

  useEffect(() => { onPromptRef.current = onPrompt }, [onPrompt])
  useEffect(() => { onOpenLinkRef.current = onOpenLink }, [onOpenLink])

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
      const data = event.data as { __dshGui?: boolean; type?: string; height?: unknown; text?: unknown; url?: unknown } | null
      if (data === null || typeof data !== 'object' || data.__dshGui !== true) return
      if (data.type === 'size') {
        if (typeof data.height !== 'number' || !Number.isFinite(data.height)) return
        setHeightPx(Math.max(MIN_FRAME_HEIGHT_PX, Math.min(MAX_FRAME_HEIGHT_PX, Math.ceil(data.height))))
        return
      }
      if (data.type === 'sendPrompt') {
        if (typeof data.text !== 'string') return
        const text = data.text.trim()
        if (text.length === 0 || text.length > WIDGET_PROMPT_MAX_CHARS) return
        const now = Date.now()
        if (now - lastPromptAtRef.current < WIDGET_PROMPT_MIN_INTERVAL_MS) return
        lastPromptAtRef.current = now
        onPromptRef.current?.(text)
        return
      }
      if (data.type === 'openLink') {
        if (typeof data.url !== 'string' || data.url.length === 0 || data.url.length > WIDGET_URL_MAX_CHARS) return
        onOpenLinkRef.current?.(data.url)
      }
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
      // Fullscreen is the one delegated permission: chart and dashboard
      // documents may expand, Escape always reverses it. No other capability
      // is granted to the frame.
      allow="fullscreen *"
      style={{ height: `${heightPx}px` }}
    />
  )
}
