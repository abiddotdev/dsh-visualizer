/**
 * One settled visualizer document's interaction state, shared by the two
 * surfaces that render one: the keyed tool row and the settled-preview chat
 * node. Both need the identical machinery — copy feedback, script/runtime
 * error notices, the title-scoped widget storage, the share gate, frame
 * fullscreen, and the comment-mode pick list — so it lives here once and the
 * surfaces differ only in chrome, never in behavior.
 *
 * @module dsh-visualizer/settled-document
 */

import { useCallback, useMemo, useState } from 'react'
import type { FrameFullscreen } from './fullscreen.ts'
import { useFrameFullscreen } from './fullscreen.ts'
import { COPY_FEEDBACK_MS, copyDocument } from './download.ts'
import { exportShareEnabled, openExportPage } from './share.ts'
import { submitWidgetPrompt, type WidgetInputActions } from './bridge-actions.ts'
import { createWidgetStorage, widgetStorageScope, type WidgetStorage } from './widget-storage.ts'
import { composeAnnotationPrompt, type AnnotationPick } from './annotate.ts'

/**
 * Frame height bounds and default mirrored from the tool's execute-time
 * validation in src/index.ts — the client bundle cannot import the node
 * half, so the copy is the price of the two-plane split; change both.
 */
export const MIN_FRAME_HEIGHT_PX = 50
export const MAX_FRAME_HEIGHT_PX = 2_000
export const DEFAULT_FRAME_HEIGHT_PX = 480

/** Decoded view of one complete visualizer call's arguments. */
export interface ArgsView {
  title: string | null
  height: number | null
  html: string
}

/**
 * Decode the complete arguments of one visualizer call.
 * @param argsRaw - the frozen raw arguments string of the call.
 * @returns the view when the JSON parses and carries a non-empty document,
 * else null.
 */
export function argsView(argsRaw: string): ArgsView | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(argsRaw)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null
  const { title, height, html } = parsed as Record<string, unknown>
  if (typeof html !== 'string' || html.length === 0) return null
  const safeHeight = typeof height === 'number' && Number.isInteger(height)
    && height >= MIN_FRAME_HEIGHT_PX && height <= MAX_FRAME_HEIGHT_PX
  return {
    title: typeof title === 'string' && title.trim().length > 0 ? title : null,
    height: safeHeight ? height : null,
    html,
  }
}

/** Inputs one settled document's controls derive from. */
export interface SettledDocumentInput {
  /** The call's explicit `title` argument, or null when absent. */
  readonly title: string | null
  /** The complete document bytes. */
  readonly html: string
  /** The session input action face, for widget prompts and annotation sends. */
  readonly inputActions: WidgetInputActions
}

/** Everything one settled document's chrome needs to render and act. */
export interface SettledDocumentControls {
  /** Whether the copy control shows its copied confirmation. */
  readonly copied: boolean
  /** Copy the document bytes; flips {@link copied} on success. */
  readonly onCopy: () => void
  /** First failed external script's source; null until one fails. */
  readonly failedSrc: string | null
  /** AutoFrame script-error callback; the first failure wins. */
  readonly onScriptError: (src: string) => void
  /** First in-frame runtime error message; null until one fires. */
  readonly runtimeError: string | null
  /** AutoFrame runtime-error callback; the first message wins. */
  readonly onRuntimeError: (message: string) => void
  /** Widget storage scoped to the document's title. */
  readonly storage: WidgetStorage
  /** Whether the host announced the share route. */
  readonly shareable: boolean
  /** Open the document's export page; a no-op outside the web UI. */
  readonly onShare: () => void
  /** Frame fullscreen state and toggle, riding the frame wrapper. */
  readonly fullscreen: FrameFullscreen
  /** Submit one widget-initiated prompt. */
  readonly onPrompt: (text: string) => void
  /** Whether comment mode is armed. */
  readonly annotate: boolean
  /** Ids of the current picks, for the frame's mark overlay. */
  readonly annotateMarks: readonly string[]
  /** The comment-mode picks, in pick order. */
  readonly picks: readonly AnnotationPick[]
  /** AutoFrame annotation callback; every pick is parse-validated upstream. */
  readonly onAnnotation: (pick: unknown) => void
  /** AutoFrame callback for the bridge's comment-mode exit. */
  readonly onAnnotateExited: () => void
  /** Set one pick's note. */
  readonly onComment: (id: string, comment: string) => void
  /** Drop one pick. */
  readonly onRemovePick: (id: string) => void
  /** Drop every pick. */
  readonly onClearPicks: () => void
  /** Arm or disarm comment mode. */
  readonly toggleAnnotate: () => void
  /** Send every pick as one widget prompt; ends the session on success. */
  readonly sendAnnotations: () => void
}

/**
 * Derive one settled document's interaction state.
 * @param input - the document's title, bytes, and input actions.
 * @returns the shared controls both rendering surfaces consume.
 */
export function useSettledDocument(input: SettledDocumentInput): SettledDocumentControls {
  const { title, html, inputActions } = input
  const [copied, setCopied] = useState(false)
  const onCopy = useCallback((): void => {
    void copyDocument(html).then((ok) => {
      if (!ok) return
      setCopied(true)
      window.setTimeout(() => { setCopied(false) }, COPY_FEEDBACK_MS)
    })
  }, [html])
  // First failed external script wins: one notice per document, later
  // failures add nothing.
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  // First runtime error message wins; the first is the defect, the rest
  // repeat it.
  const [runtimeError, setRuntimeError] = useState<string | null>(null)
  const onRuntimeError = useCallback((message: string): void => {
    setRuntimeError(current => current ?? message)
  }, [])
  // State follows the document's title: the same title regenerates into the
  // same scope, and every surface deriving it lands on the identical one.
  const storage = useMemo(() => createWidgetStorage(widgetStorageScope(title)), [title])
  // The share control exists only where the host announced its route.
  const shareable = exportShareEnabled()
  const onShare = useCallback((): void => { openExportPage(title, html) }, [title, html])
  // Fullscreen rides the frame wrapper; the label follows the document API,
  // so an Escape pressed inside the frame reverts it without a click.
  const fullscreen = useFrameFullscreen()
  const onPrompt = useCallback((text: string): void => { submitWidgetPrompt(inputActions, text) }, [inputActions])
  // Comment mode: picks are card state, marks sync to the frame, and Send
  // composes one widget prompt from every pick's note and locator.
  const [annotate, setAnnotate] = useState(false)
  const [picks, setPicks] = useState<AnnotationPick[]>([])
  const onAnnotation = useCallback((pick: unknown): void => {
    setPicks(current => [...current, pick as AnnotationPick])
  }, [])
  const onAnnotateExited = useCallback((): void => { setAnnotate(false) }, [])
  const onComment = useCallback((id: string, comment: string): void => {
    setPicks(current => current.map(pick => pick.id === id ? { ...pick, comment } : pick))
  }, [])
  const onRemovePick = useCallback((id: string): void => {
    setPicks(current => current.filter(pick => pick.id !== id))
  }, [])
  const onClearPicks = useCallback((): void => { setPicks([]) }, [])
  const sendAnnotations = useCallback((): void => {
    const text = composeAnnotationPrompt(picks)
    if (text === null) return
    submitWidgetPrompt(inputActions, text)
    setPicks([])
    // Sending ends the commenting session: the frame disarms and the marks
    // are gone with the picks.
    setAnnotate(false)
  }, [picks, inputActions])
  const toggleAnnotate = useCallback((): void => {
    setAnnotate(current => !current)
  }, [])
  const annotateMarks = useMemo(() => picks.map(pick => pick.id), [picks])
  return {
    copied,
    onCopy,
    failedSrc,
    onScriptError: setFailedSrc,
    runtimeError,
    onRuntimeError,
    storage,
    shareable,
    onShare,
    fullscreen,
    onPrompt,
    annotate,
    annotateMarks,
    picks,
    onAnnotation,
    onAnnotateExited,
    onComment,
    onRemovePick,
    onClearPicks,
    toggleAnnotate,
    sendAnnotations,
  }
}
