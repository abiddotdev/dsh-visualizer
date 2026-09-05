// Shared settled-document body: the frame, its full chrome (fullscreen,
// comment mode, copy, download, share), and comment-bar state. Two owners
// render it — ResultRow, in place at the tool call for as long as the turn
// stays open, and TurnTailCard, once the turn closes and Compact transcript
// view would otherwise fold the in-place row away (see turn-tail.ts). Turn
// close is a hard mount boundary (`turn-tail` does not exist before
// `turn/end`), so that one handoff always remounts a fresh frame; keeping the
// in-place copy alive until then means it is the only transition that happens.

import { useCallback, useMemo, useState } from 'react'
import { DisclosureRow, IconCheckOutline16, IconCodeOutline16, IconCopyOutline16, IconDownloadOutline16, IconEnhanceOutline16, IconFullscreenOutline16, IconInspectOutline12, IconLinkOutline16, IconListPenOutline16, IconShareOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { AutoFrame } from './AutoFrame.tsx'
import { argsView, DEFAULT_FRAME_HEIGHT_PX } from './args-view.ts'
import { COPY_FEEDBACK_MS, copyDocument, downloadDocument } from './download.ts'
import { useFrameFullscreen } from './fullscreen.ts'
import { copyExportLink, exportShareEnabled, openExportPage } from './share.ts'
import { openWidgetLink } from './bridge-actions.ts'
import { createWidgetStorage, widgetStorageScope } from './widget-storage.ts'
import { composeAnnotationPrompt, type AnnotationPick } from './annotate.ts'
import { composeFixPrompt } from './fix-prompt.ts'
import { CommentBar } from './CommentBar.tsx'
import css from './Card.module.css'

type Translate = PropsLocale<'visualizer'>['t']

export interface SettledDocProps {
  /** The call's frozen complete arguments; args are final once dispatched. */
  argsRaw: string
  t: Translate
  onPrompt: (text: string) => void
  /** 'running' shows the sweep sheen and no chrome; 'ok' is the full settled experience. */
  state?: 'running' | 'ok'
  /**
   * Jump to this call in the trajectory view. Only `ResultRow` can supply
   * this — the turn-tail chain's owner currency carries no per-call inspect
   * capability, so a card rendered there shows no such control.
   */
  inspect?: () => void
}

/** One document's frame, chrome, and comment-mode state. Null when its arguments carry nothing renderable. */
export function SettledDoc({ argsRaw, t, onPrompt, state = 'ok', inspect }: SettledDocProps) {
  const view = useMemo(() => argsView(argsRaw), [argsRaw])
  const title = view?.title ?? t('row.title')
  const height = view?.height ?? DEFAULT_FRAME_HEIGHT_PX
  const settledOk = state === 'ok'
  const summary = view !== null
    ? settledOk ? t('row.chars', { chars: view.html.length }) : t('row.running')
    : t('row.missing')
  const [expanded, setExpanded] = useState(true)
  const [copied, setCopied] = useState(false)
  const [linkCopied, setLinkCopied] = useState(false)
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  // The line rides along for the fix prompt; only the message is displayed.
  const [runtimeError, setRuntimeError] = useState<{ message: string; line: number | null } | null>(null)
  const onRuntimeError = useCallback((message: string, line: number | null): void => {
    setRuntimeError(current => current ?? { message, line })
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
  // The frame's failures never reached the model — the settle-time check
  // compiles scripts without running them — so a broken render otherwise
  // needs the user to retype what the card is already showing.
  const [fixSent, setFixSent] = useState(false)
  const fixText = useMemo(() => composeFixPrompt({
    title: view?.title ?? null,
    scriptSrc: failedSrc,
    runtimeMessage: runtimeError?.message ?? null,
    runtimeLine: runtimeError?.line ?? null,
  }), [view?.title, failedSrc, runtimeError])
  const sendFix = useCallback((): void => {
    if (fixText === null) return
    onPrompt(fixText)
    // One request per broken render: the fix arrives as a fresh call with a
    // card of its own, so this one stays failed and asking twice only
    // duplicates the turn.
    setFixSent(true)
  }, [fixText, onPrompt])

  if (view === null) return null

  return (
    <div className={css.card} data-tool="visualizer" data-state={state}>
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
                {runtimeError.message}
              </span>
            )}
            {/* Rides beside the notice it acts on, and acts on card state
              * rather than the frame, so it survives a collapse like the
              * other byte-level actions do. */}
            {settledOk && fixText !== null && (
              <button
                type="button"
                className={css.download}
                disabled={fixSent}
                aria-label={fixSent ? t('row.fixErrorSent') : t('row.fixError')}
                title={fixSent ? t('row.fixErrorSent') : t('row.fixErrorTitle')}
                onClick={(event) => {
                  event.stopPropagation()
                  sendFix()
                }}
              >
                <IconEnhanceOutline16 size={14} />
              </button>
            )}
            {inspect !== undefined && (
              <button
                type="button"
                className={css.download}
                aria-label={t('row.inspect')}
                title={t('row.inspect')}
                onClick={(event) => {
                  event.stopPropagation()
                  inspect()
                }}
              >
                <IconInspectOutline12 />
              </button>
            )}
            {settledOk && (
              <>
                {/* The frame must be mounted to hold fullscreen, so this
                 * control rides the expanded row alone; copy, download, and
                 * share act on the document bytes and need no frame. */}
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
                  <>
                    {/* Handing the address to someone else is the other half
                      * of sharing; opening the page was previously the only
                      * way to reach the URL at all. */}
                    <button
                      type="button"
                      className={css.download}
                      aria-label={linkCopied ? t('row.linkCopied') : t('row.copyLink')}
                      title={linkCopied ? t('row.linkCopied') : t('row.copyLink')}
                      onClick={(event) => {
                        event.stopPropagation()
                        void copyExportLink(view.title, view.html).then((ok) => {
                          if (!ok) return
                          setLinkCopied(true)
                          window.setTimeout(() => { setLinkCopied(false) }, COPY_FEEDBACK_MS)
                        })
                      }}
                    >
                      {linkCopied ? <IconCheckOutline16 size={14} /> : <IconLinkOutline16 size={14} />}
                    </button>
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
                  </>
                )}
              </>
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
          {/* Same live-phase sheen as the streaming card, over the running
           * row's already-visible document. */}
          {!settledOk && <div className={css.streamSweep} aria-hidden />}
        </div>
        {settledOk && (
          <CommentBar
            picks={picks}
            onComment={onComment}
            onRemove={onRemovePick}
            onSend={sendAnnotations}
            onClear={onClearPicks}
            t={t}
          />
        )}
      </DisclosureRow>
    </div>
  )
}
