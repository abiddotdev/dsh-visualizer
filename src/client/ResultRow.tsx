// visualizer toolview row: the settled half of the presentation. The call's
// complete arguments — logged by tool/call and backfilled onto the result —
// are the document's authoritative home, so this row JSON-parses argsRaw and
// renders the document directly in a null-origin srcDoc frame (no bridge, no
// shell: a complete document needs no streaming machinery). The download
// control materializes the same bytes client-side as a Blob; it appears only
// on a settled successful call, because a partial download is corrupt by
// definition. When the streaming chat node covers the call — from dispatch
// through settlement — the row drops to a bare summary line and hands it
// back the moment that card stops covering it.

import { useState } from 'react'
import { DisclosureRow, IconCheckOutline16, IconCodeOutline16, IconCopyOutline16, IconDownloadOutline16, IconFullscreenOutline16, IconListPenOutline16, IconShareOutline16, IconWarningOutline16, StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import { AutoFrame } from './AutoFrame.tsx'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import { downloadDocument } from './download.ts'
import { openWidgetLink } from './bridge-actions.ts'
import { DEFAULT_FRAME_HEIGHT_PX, argsView, useSettledDocument } from './settled-document.ts'
import { usePreviewCovered } from './preview-coverage.ts'
import { CommentBar } from './CommentBar.tsx'
import css from './Card.module.css'

/** Full card props composed by the keyed Tool slot. */
export type ResultRowProps = ToolCallViewProps & PropsLocale<'visualizer'>

/** The argsRaw of either block form: direct on a running head, backfilled on a settled result. */
function argsRawOf(block: ToolCallViewProps['block']): string {
  return 'kind' in block ? (block.call?.argsRaw ?? '') : block.argsRaw
}

/** Render one settled or running `visualizer` call. */
export function ResultRow({ callId, block, t, inputActions }: ResultRowProps) {
  const settled = 'kind' in block
  const view = !settled || !block.isError ? argsView(argsRawOf(block)) : null
  const title = view?.title ?? t('row.title')
  const height = view?.height ?? DEFAULT_FRAME_HEIGHT_PX
  // The failure rides the alert icon in the row chrome; its native tooltip
  // carries the full error the result logged.
  const errorInfo = settled && block.isError && block.error !== undefined ? block.error : null
  const summary = view !== null
    ? settled && !block.isError
      ? t('row.chars', { chars: view.html.length })
      : t('row.running')
    : errorInfo !== null
      ? ''
      : t('row.missing')
  const [expanded, setExpanded] = useState(true)
  // A mounted settled-preview chat node is the frame's primary home once the
  // call settles; the covered row keeps only its summary so one document
  // never renders twice, and the unmount hands the frame back automatically.
  const covered = usePreviewCovered(callId)
  const settledOk = settled && !block.isError && view !== null
  // The row's full settled surface — frame, controls, comment bar — shows
  // exactly while the row owns the document: settled, clean, and uncovered.
  const ownsSurface = settledOk && !covered
  // A running row owns its frame only while nothing else is covering the
  // call; once the streaming card retains coverage, right from dispatch,
  // the row goes quiet until that card releases it.
  const runningOwnsSurface = !settled && !covered
  const controls = useSettledDocument({ title: view?.title ?? null, html: view?.html ?? '', inputActions })

  /** Collapsed-row trailing content: char count, then the document controls on an owned success. */
  const rowChrome = () => (
    <>
      <span className={css.separator} aria-hidden />
      <span className={css.summary}>{summary}</span>
      {controls.failedSrc !== null && <span className={css.scriptError}>{t('row.scriptError')}</span>}
      {controls.runtimeError !== null && (
        <span className={css.scriptError}>
          {t('row.runtimeError')}
          {controls.runtimeError}
        </span>
      )}
      {errorInfo !== null && (
        <span
          className={css.alertIcon}
          title={`${errorInfo.name}: ${errorInfo.code}`}
          aria-label={`${errorInfo.name}: ${errorInfo.code}`}
        >
          <IconWarningOutline16 size={14} />
        </span>
      )}
      {ownsSurface && (
        <>
          {/* The frame must be mounted to hold fullscreen, so this control
           * rides the expanded row alone; copy, download, and share act on
           * the document bytes and need no frame. */}
          {expanded && (
            <button
              type="button"
              className={css.download}
              aria-label={controls.fullscreen.active ? t('row.exitFullscreen') : t('row.fullscreen')}
              title={controls.fullscreen.active ? t('row.exitFullscreen') : t('row.fullscreen')}
              onClick={(event) => {
                event.stopPropagation()
                controls.fullscreen.toggle()
              }}
            >
              <IconFullscreenOutline16 size={14} />
            </button>
          )}
          {expanded && (
            <button
              type="button"
              className={controls.annotate ? css.downloadActive : css.download}
              aria-pressed={controls.annotate}
              aria-label={t('row.commentMode')}
              title={t('row.commentModeTitle')}
              onClick={(event) => {
                event.stopPropagation()
                controls.toggleAnnotate()
              }}
            >
              <IconListPenOutline16 size={14} />
            </button>
          )}
          <button
            type="button"
            className={css.download}
            aria-label={controls.copied ? t('row.copied') : t('row.copy')}
            title={controls.copied ? t('row.copied') : t('row.copy')}
            onClick={(event) => {
              event.stopPropagation()
              controls.onCopy()
            }}
          >
            {/* The check mark is the copied confirmation; the accessible name
             * carries the state change. */}
            {controls.copied ? <IconCheckOutline16 size={14} /> : <IconCopyOutline16 size={14} />}
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
          {controls.shareable && (
            <button
              type="button"
              className={css.download}
              aria-label={t('row.share')}
              title={t('row.share')}
              onClick={(event) => {
                event.stopPropagation()
                controls.onShare()
              }}
            >
              <IconShareOutline16 size={14} />
            </button>
          )}
        </>
      )}
    </>
  )

  // Same DisclosureRow chrome as the streaming card above it: one expandable
  // frame per visualizer call, differing only in document phase.
  /* jscpd:ignore-start — the DisclosureRow chrome is shared with the
     streaming card; the two rows differ in document phase, not chrome. */
  return rowJsx()

  /** The outer card DOM; separated so the shared chrome stays one unit. */
  function rowJsx() {
    const frameVisible = view !== null && (runningOwnsSurface || ownsSurface)
    return (
      <div
        className={css.card}
        data-tool="visualizer"
        data-state={settled ? (block.isError ? 'error' : 'ok') : 'running'}
      >
        <DisclosureRow
          rowClassName={css.row}
          titleClassName={css.title}
          chevronClassName={css.chevron}
          icon={settled && block.isError ? <StateDot state="error" /> : <IconCodeOutline16 size={14} />}
          title={title}
          open={expanded}
          expandable={frameVisible}
          expandOnRowClick
          keepContentWhenOpen
          onToggle={() => { setExpanded(value => !value) }}
          collapsedContent={rowChrome()}
        >
          {frameVisible && (
            <div className={css.frameWrap} ref={controls.fullscreen.ref}>
              <AutoFrame
                title={title}
                html={view.html}
                phase="complete"
                initialHeight={height}
                className={css.frame}
                onPrompt={controls.onPrompt}
                onOpenLink={openWidgetLink}
                onScriptError={controls.onScriptError}
                onRuntimeError={controls.onRuntimeError}
                storage={controls.storage}
                annotate={controls.annotate}
                onAnnotation={controls.onAnnotation}
                onAnnotateExited={controls.onAnnotateExited}
                annotateMarks={controls.annotateMarks}
              />
              {/* Same live-phase sheen as the streaming card, over the
               * running row's already-visible document. */}
              {!settled && <div className={css.streamSweep} aria-hidden />}
            </div>
          )}
          {ownsSurface && (
            <CommentBar
              picks={controls.picks}
              onComment={controls.onComment}
              onRemove={controls.onRemovePick}
              onSend={controls.sendAnnotations}
              onClear={controls.onClearPicks}
              t={t}
            />
          )}
        </DisclosureRow>
      </div>
    )
  }
  /* jscpd:ignore-end */
}
