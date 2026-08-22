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
import type { WidgetStorage } from './widget-storage.ts'

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
/** Longest script source URL accepted from a load-failure report. */
export const SCRIPT_ERROR_SRC_MAX_CHARS = 512
/** Longest runtime-error message accepted from a report. */
export const RUNTIME_ERROR_MAX_CHARS = 300
/** Most runtime-error reports a card keeps; bursts beyond it add nothing. */
export const RUNTIME_ERROR_MAX_REPORTS = 3

/** Prefix of the host design tokens forwarded into the frame. */
const THEME_TOKEN_PREFIX = '--dsw-'

/**
 * Collect the host's current design tokens from the document root's
 * computed style; the indexed walk yields custom properties in every
 * engine that supports them and an empty set where none exist.
 * @returns token name to current value.
 */
function collectThemeTokens(): Record<string, string> {
  const vars: Record<string, string> = {}
  const computed = window.getComputedStyle(document.documentElement)
  for (let index = 0; index < computed.length; index++) {
    const name = computed[index]
    if (!name.startsWith(THEME_TOKEN_PREFIX)) continue
    const value = computed.getPropertyValue(name).trim()
    if (value.length > 0) vars[name] = value
  }
  return vars
}

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
  /** First external script whose load failed inside the frame. */
  readonly onScriptError?: ((src: string) => void) | undefined
  /** A runtime error raised inside the frame; message already capped. */
  readonly onRuntimeError?: ((message: string, line: number | null) => void) | undefined
  /** Session-scoped store answering `window.storage`; absent disables it. */
  readonly storage?: WidgetStorage | undefined
}

/**
 * One content-sized sandboxed frame over the streaming shell.
 * @param props - document, phase, initial height, and frame chrome.
 */
export function AutoFrame({ title, html, phase, initialHeight, className, onPrompt, onOpenLink, onScriptError, onRuntimeError, storage }: AutoFrameProps) {
  const controller = useRef<StreamFrameController | null>(null)
  const frameEl = useRef<HTMLIFrameElement | null>(null)
  const [heightPx, setHeightPx] = useState(initialHeight)
  // Latest-callback refs keep one stable message listener across renders.
  const onPromptRef = useRef(onPrompt)
  const onOpenLinkRef = useRef(onOpenLink)
  const onScriptErrorRef = useRef(onScriptError)
  const onRuntimeErrorRef = useRef(onRuntimeError)
  const storageRef = useRef(storage)
  const lastPromptAtRef = useRef(0)
  const runtimeErrorCountRef = useRef(0)

  useEffect(() => { onPromptRef.current = onPrompt }, [onPrompt])
  useEffect(() => { onOpenLinkRef.current = onOpenLink }, [onOpenLink])
  useEffect(() => { onScriptErrorRef.current = onScriptError }, [onScriptError])
  useEffect(() => { onRuntimeErrorRef.current = onRuntimeError }, [onRuntimeError])
  useEffect(() => { storageRef.current = storage }, [storage])

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
      const data = event.data as
        | {
          __dshGui?: boolean
          type?: string
          height?: unknown
          text?: unknown
          url?: unknown
          src?: unknown
          message?: unknown
          line?: unknown
          op?: unknown
          id?: unknown
          key?: unknown
          value?: unknown
        }
        | null
      if (data === null || typeof data !== 'object' || data.__dshGui !== true) return
      if (data.type === 'size') {
        if (typeof data.height !== 'number' || !Number.isFinite(data.height)) return
        setHeightPx(Math.max(MIN_FRAME_HEIGHT_PX, Math.min(MAX_FRAME_HEIGHT_PX, Math.ceil(data.height))))
        return
      }
      if (data.type === 'theme-request') {
        // The shell asks at boot because a push could race its load queue.
        frameEl.current?.contentWindow?.postMessage(
          { __dshGui: true, type: 'theme', vars: collectThemeTokens() },
          '*',
        )
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
        return
      }
      if (data.type === 'scriptError') {
        if (typeof data.src !== 'string' || data.src.length === 0 || data.src.length > SCRIPT_ERROR_SRC_MAX_CHARS) return
        onScriptErrorRef.current?.(data.src)
        return
      }
      if (data.type === 'runtimeError') {
        // A broken script can raise repeatedly (resize loops, intervals);
        // the first reports name the defect, the rest add nothing.
        if (typeof data.message !== 'string' || data.message.length === 0
          || data.message.length > RUNTIME_ERROR_MAX_CHARS) return
        runtimeErrorCountRef.current += 1
        if (runtimeErrorCountRef.current > RUNTIME_ERROR_MAX_REPORTS) return
        const line = typeof data.line === 'number' && Number.isFinite(data.line) && data.line > 0 ? data.line : null
        onRuntimeErrorRef.current?.(data.message, line)
        return
      }
      if (data.type === 'storage-request') {
        // The request came from the frame's script, so the frame is loaded
        // and a direct post back cannot race the shell's load queue.
        const respond = (ok: boolean, payload: { value?: string; error?: string }): void => {
          frameEl.current?.contentWindow?.postMessage(
            { __dshGui: true, type: 'storage-response', id: data.id, ok, ...payload },
            '*',
          )
        }
        const op = data.op
        if (typeof data.id !== 'string' || data.id.length === 0
          || typeof data.key !== 'string'
          || (op !== 'get' && op !== 'set' && op !== 'delete')
          || (op === 'set' && typeof data.value !== 'string')) {
          respond(false, { error: 'malformed storage request' })
          return
        }
        const store = storageRef.current
        if (store === undefined) {
          respond(false, { error: 'storage is unavailable on this card' })
          return
        }
        try {
          if (op === 'get') respond(true, { value: store.get(data.key) })
          else if (op === 'set') { store.set(data.key, data.value as string); respond(true, {}) }
          else { store.delete(data.key); respond(true, {}) }
        } catch (err) {
          respond(false, { error: err instanceof Error ? err.message : 'storage operation failed' })
        }
      }
    }
    window.addEventListener('message', onMessage)
    // Themes usually flip a class or data attribute on the root elements;
    // attribute-only observation re-pushes the tokens when that happens.
    const pushTheme = (): void => {
      frameEl.current?.contentWindow?.postMessage(
        { __dshGui: true, type: 'theme', vars: collectThemeTokens() },
        '*',
      )
    }
    const themeObserver = new MutationObserver(pushTheme)
    for (const target of [document.documentElement, document.body]) {
      themeObserver.observe(target, { attributes: true, attributeFilter: ['class', 'style', 'data-theme'] })
    }
    return () => {
      window.removeEventListener('message', onMessage)
      themeObserver.disconnect()
    }
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
