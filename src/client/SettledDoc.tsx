// Shared settled-document body: the frame, its full chrome (fullscreen,
// comment mode, copy, download, share), and comment-bar state. Two owners
// render it — ResultRow, in place at the tool call for as long as the turn
// stays open, and TurnTailCard, once the turn closes and Compact transcript
// view would otherwise fold the in-place row away (see turn-tail.ts). Turn
// close is a hard mount boundary (`turn-tail` does not exist before
// `turn/end`), so that one handoff always remounts a fresh frame; keeping the
// in-place copy alive until then means it is the only transition that happens.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { DisclosureRow, IconCheckOutline16, IconCloseOutline16, IconCodeOutline16, IconCopyOutline16, IconDownloadOutline16, IconEnhanceOutline16, IconFullscreenOutline16, IconInspectOutline12, IconLinkOutline16, IconListPenOutline16, IconLoadingOutline16, IconRightUpOutline16, IconShareOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { AutoFrame } from './AutoFrame.tsx'
import { argsView, DEFAULT_FRAME_HEIGHT_PX } from './args-view.ts'
import { COPY_FEEDBACK_MS, copyDocument, downloadDocument } from './download.ts'
import { useFrameFullscreen } from './fullscreen.ts'
import { artifactPageUrlByName, copyArtifactLink, exportShareEnabled, openArtifactPage } from './share.ts'
import { UNSHARE_CONFIRM_MS, useExportControl } from './export-control.ts'
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
  /**
   * This call's identity, for the Export control. Omitted or null where the
   * owner cannot supply one — Export then stays inert (no call to name), not
   * absent, since there is otherwise no way to distinguish "cannot export
   * yet" from "will never be able to".
   */
  callId?: string | null
}

/** One document's frame, chrome, and comment-mode state. Null when its arguments carry nothing renderable. */
export function SettledDoc({ argsRaw, t, onPrompt, state = 'ok', inspect, callId = null }: SettledDocProps) {
  const view = useMemo(() => argsView(argsRaw), [argsRaw])
  const title = view?.title ?? t('row.title')
  const height = view?.height ?? DEFAULT_FRAME_HEIGHT_PX
  const settledOk = state === 'ok'
  const summary = view !== null
    ? settledOk ? t('row.chars', { chars: view.html.length }) : t('row.running')
    : t('row.missing')
  const [expanded, setExpanded] = useState(true)
  const [copied, setCopied] = useState(false)
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
  const exportControl = useExportControl(callId, view?.title ?? null, view?.html ?? '')
  // The rendered document's own read-only view of its share state (window.share
  // in shell.ts) — derived, not stored: exportControl is already the single
  // source of truth for whether and where this call is exported.
  const shareStatus = useMemo(() => {
    if (exportControl.status !== 'exported' || exportControl.name === null) return { exported: false, url: null }
    return { exported: true, url: artifactPageUrlByName(exportControl.name) }
  }, [exportControl.status, exportControl.name])
  const [linkCopied, setLinkCopied] = useState(false)
  const onCopyLink = useCallback((): void => {
    if (exportControl.name === null) return
    void copyArtifactLink(exportControl.name).then((ok) => {
      if (!ok) return
      setLinkCopied(true)
      window.setTimeout(() => { setLinkCopied(false) }, COPY_FEEDBACK_MS)
    })
  }, [exportControl.name])
  // Two clicks, not a native confirm() dialog — the same arm/confirm pattern
  // the gallery's own delete uses: first click arms (reverting on its own
  // after a few seconds), second click while armed actually unshares.
  const [unshareConfirming, setUnshareConfirming] = useState(false)
  const [unsharing, setUnsharing] = useState(false)
  const unshareTimer = useRef<number | undefined>(undefined)
  useEffect(() => () => { window.clearTimeout(unshareTimer.current) }, [])
  const onUnshareClick = useCallback((): void => {
    if (!unshareConfirming) {
      setUnshareConfirming(true)
      unshareTimer.current = window.setTimeout(() => { setUnshareConfirming(false) }, UNSHARE_CONFIRM_MS)
      return
    }
    window.clearTimeout(unshareTimer.current)
    setUnsharing(true)
    void exportControl.unshare().then(() => {
      setUnsharing(false)
      setUnshareConfirming(false)
    })
  }, [unshareConfirming, exportControl])
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
              // Clipped to keep the row's actions reachable; the tooltip
              // carries the message in full.
              <span className={css.scriptError} title={`${t('row.runtimeError')}${runtimeError.message}`}>
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
                  exportControl.status === 'exported' && exportControl.name !== null ? (
                    <>
                      <button
                        type="button"
                        className={css.download}
                        aria-label={t('row.share')}
                        title={t('row.share')}
                        onClick={(event) => {
                          event.stopPropagation()
                          openArtifactPage(exportControl.name!)
                        }}
                      >
                        <IconShareOutline16 size={14} />
                      </button>
                      {/* Only reachable once exported, so it never needs its
                        * own ensure() — by the time this renders, the export
                        * already exists. */}
                      <button
                        type="button"
                        className={css.download}
                        aria-label={linkCopied ? t('row.linkCopied') : t('row.copyLink')}
                        title={linkCopied ? t('row.linkCopied') : t('row.copyLink')}
                        onClick={(event) => {
                          event.stopPropagation()
                          onCopyLink()
                        }}
                      >
                        {linkCopied ? <IconCheckOutline16 size={14} /> : <IconLinkOutline16 size={14} />}
                      </button>
                      <button
                        type="button"
                        className={unshareConfirming ? css.downloadDanger : css.download}
                        disabled={unsharing}
                        aria-label={unshareConfirming ? t('row.unshareConfirm') : t('row.unshare')}
                        title={unshareConfirming ? t('row.unshareConfirm') : t('row.unshare')}
                        onClick={(event) => {
                          event.stopPropagation()
                          onUnshareClick()
                        }}
                      >
                        <IconCloseOutline16 size={14} />
                      </button>
                    </>
                  ) : (
                    // Export writes the host's mirror; only once that is
                    // confirmed does the slot above become Open, so the tab
                    // it opens is always synchronous with its own click — no
                    // popup blocker from opening a tab after an awaited write.
                    <button
                      type="button"
                      className={css.download}
                      disabled={exportControl.status === 'exporting'}
                      aria-label={
                        exportControl.status === 'exporting' ? t('row.exporting')
                          : exportControl.status === 'failed' ? t('row.exportFailed')
                            : t('row.export')
                      }
                      title={
                        exportControl.status === 'exporting' ? t('row.exporting')
                          : exportControl.status === 'failed' ? t('row.exportFailedTitle')
                            : t('row.exportTitle')
                      }
                      onClick={(event) => {
                        event.stopPropagation()
                        void exportControl.ensure()
                      }}
                    >
                      {exportControl.status === 'exporting'
                        ? <IconLoadingOutline16 size={14} />
                        : <IconRightUpOutline16 size={14} />}
                    </button>
                  )
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
            shareStatus={shareStatus}
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
