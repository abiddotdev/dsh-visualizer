// visualizer turn-tail row: the relocated settled half of the presentation.
// `turn-tail` sits outside the Compact-transcript fold (see turn-tail.ts), so
// every successful document of the turn renders here, once, after the
// closing message — the in-place `tool.call.toolview` row (ResultRow) keeps
// only the running/error states and drops its own frame once a call settles
// successfully. Each card owns its own AutoFrame, chrome, and comment-mode
// state, mirroring ResultRow's former settled body exactly.

import { useCallback, useMemo, useState } from 'react'
import { DisclosureRow, IconCheckOutline16, IconCodeOutline16, IconCopyOutline16, IconDownloadOutline16, IconFullscreenOutline16, IconListPenOutline16, IconShareOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { AutoFrame } from './AutoFrame.tsx'
import { argsView, DEFAULT_FRAME_HEIGHT_PX } from './args-view.ts'
import { COPY_FEEDBACK_MS, copyDocument, downloadDocument } from './download.ts'
import { useFrameFullscreen } from './fullscreen.ts'
import { exportShareEnabled, openExportPage } from './share.ts'
import { openWidgetLink, submitWidgetPrompt, type WidgetInputActions } from './bridge-actions.ts'
import { createWidgetStorage, widgetStorageScope } from './widget-storage.ts'
import { composeAnnotationPrompt, type AnnotationPick } from './annotate.ts'
import { CommentBar } from './CommentBar.tsx'
import type { VisualizerTurnCard } from './turn-tail.ts'
import css from './Card.module.css'

type Translate = PropsLocale<'visualizer'>['t']

/** One settled document and its own interaction state. */
function TurnTailDoc({ card, t, onPrompt }: { card: VisualizerTurnCard; t: Translate; onPrompt: (text: string) => void }) {
  const view = useMemo(() => argsView(card.argsRaw), [card.argsRaw])
  const title = view?.title ?? t('row.title')
  const height = view?.height ?? DEFAULT_FRAME_HEIGHT_PX
  const summary = view !== null ? t('row.chars', { chars: view.html.length }) : t('row.missing')
  const [expanded, setExpanded] = useState(true)
  const [copied, setCopied] = useState(false)
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  const [runtimeError, setRuntimeError] = useState<string | null>(null)
  const onRuntimeError = useCallback((message: string): void => {
    setRuntimeError(current => current ?? message)
  }, [])
  const storage = useMemo(() => createWidgetStorage(widgetStorageScope(view?.title ?? null)), [view?.title])
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
    onPrompt(text)
    setPicks([])
    setAnnotate(false)
  }, [picks, onPrompt])
  const toggleAnnotate = useCallback((): void => {
    setAnnotate(current => !current)
  }, [])
  const annotateMarks = useMemo(() => picks.map(pick => pick.id), [picks])
  const shareable = exportShareEnabled()
  const fullscreen = useFrameFullscreen()

  if (view === null) return null

  return (
    <div className={css.card} data-tool="visualizer" data-state="ok">
      <DisclosureRow
        rowClassName={css.row}
        titleClassName={css.title}
        chevronClassName={css.chevron}
        icon={<IconCodeOutline16 size={14} />}
        title={title}
        open={expanded}
        expandable
        expandOnRowClick
        keepContentWhenOpen
        onToggle={() => { setExpanded(value => !value) }}
        collapsedContent={(
          <>
            <span className={css.separator} aria-hidden />
            <span className={css.summary}>{summary}</span>
            {failedSrc !== null && <span className={css.scriptError}>{t('row.scriptError')}</span>}
            {runtimeError !== null && (
              <span className={css.scriptError}>
                {t('row.runtimeError')}
                {runtimeError}
              </span>
            )}
            {expanded && (
              <button
                type="button"
                className={css.download}
                aria-label={fullscreen.active ? t('row.exitFullscreen') : t('row.fullscreen')}
                title={fullscreen.active ? t('row.exitFullscreen') : t('row.fullscreen')}
                onClick={(event) => {
                  event.stopPropagation()
                  fullscreen.toggle()
                }}
              >
                <IconFullscreenOutline16 size={14} />
              </button>
            )}
            {expanded && (
              <button
                type="button"
                className={annotate ? css.downloadActive : css.download}
                aria-pressed={annotate}
                aria-label={t('row.commentMode')}
                title={t('row.commentModeTitle')}
                onClick={(event) => {
                  event.stopPropagation()
                  toggleAnnotate()
                }}
              >
                <IconListPenOutline16 size={14} />
              </button>
            )}
            <button
              type="button"
              className={css.download}
              aria-label={copied ? t('row.copied') : t('row.copy')}
              title={copied ? t('row.copied') : t('row.copy')}
              onClick={(event) => {
                event.stopPropagation()
                void copyDocument(view.html).then((ok) => {
                  if (!ok) return
                  setCopied(true)
                  window.setTimeout(() => { setCopied(false) }, COPY_FEEDBACK_MS)
                })
              }}
            >
              {copied ? <IconCheckOutline16 size={14} /> : <IconCopyOutline16 size={14} />}
            </button>
            <button
              type="button"
              className={css.download}
              aria-label={t('row.download')}
              title={t('row.download')}
              onClick={(event) => {
                event.stopPropagation()
                downloadDocument(title, view.html)
              }}
            >
              <IconDownloadOutline16 size={14} />
            </button>
            {shareable && (
              <button
                type="button"
                className={css.download}
                aria-label={t('row.share')}
                title={t('row.share')}
                onClick={(event) => {
                  event.stopPropagation()
                  openExportPage(view.title, view.html)
                }}
              >
                <IconShareOutline16 size={14} />
              </button>
            )}
          </>
        )}
      >
        <div className={css.frameWrap} ref={fullscreen.ref}>
          <AutoFrame
            title={title}
            html={view.html}
            phase="complete"
            initialHeight={height}
            className={css.frame}
            onPrompt={onPrompt}
            onOpenLink={openWidgetLink}
            onScriptError={setFailedSrc}
            onRuntimeError={onRuntimeError}
            storage={storage}
            annotate={annotate}
            onAnnotation={onAnnotation}
            onAnnotateExited={onAnnotateExited}
            annotateMarks={annotateMarks}
          />
        </div>
        <CommentBar
          picks={picks}
          onComment={onComment}
          onRemove={onRemovePick}
          onSend={sendAnnotations}
          onClear={onClearPicks}
          t={t}
        />
      </DisclosureRow>
    </div>
  )
}

/** Full card props composed by the `conversation.chat.turnTail` chain slot. */
export type TurnTailCardProps = {
  matched: readonly VisualizerTurnCard[]
  inputActions: WidgetInputActions
} & PropsLocale<'visualizer'>

/** Render every settled visualizer document produced by one closed turn. */
export function TurnTailCard({ matched, t, inputActions }: TurnTailCardProps) {
  const onPrompt = useCallback((text: string): void => { submitWidgetPrompt(inputActions, text) }, [inputActions])
  return (
    <div className={css.stack}>
      {matched.map(card => <TurnTailDoc key={card.callId} card={card} t={t} onPrompt={onPrompt} />)}
    </div>
  )
}
