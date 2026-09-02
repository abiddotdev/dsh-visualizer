// visualizer-preview chat node: the settled half of the presentation, lifted
// into the chat flow. Each clean `tool/result` becomes one card here —
// header chrome, complete-document frame (AutoFrame phase complete), and the
// comment bar — so the artifact stays visible even where the turn's process
// folds, including compact transcript mode. While this card is mounted it
// holds the call's coverage, which is the keyed tool row's cue to keep only
// its summary line; the unmount hands the frame back. Hidden nodes never
// mount (the assembler drops them from contributions), so coverage tracks
// exactly the visible previews.

import { useEffect } from 'react'
import { IconCheckOutline16, IconCodeOutline16, IconCopyOutline16, IconDownloadOutline16, IconFullscreenOutline16, IconListPenOutline16, IconShareOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { AutoFrame } from './AutoFrame.tsx'
import { downloadDocument } from './download.ts'
import { openWidgetLink } from './bridge-actions.ts'
import { DEFAULT_FRAME_HEIGHT_PX, useSettledDocument } from './settled-document.ts'
import { releaseCoverage, retainCoverage } from './preview-coverage.ts'
import type { GenerativePreviewData } from './settled-preview-node.ts'
import { CommentBar } from './CommentBar.tsx'
import css from './Card.module.css'

/** Full card props composed by the keyed Chat Node slot. */
export type SettledPreviewNodeViewProps = PropsRuntime<'conversation.chat.node', 'visualizer-preview'>
  & PropsLocale<'visualizer'>

type Translate = SettledPreviewNodeViewProps['t']

/** One settled document card and its shell frame. */
function PreviewDoc({ preview, t, inputActions }: {
  preview: GenerativePreviewData
  t: Translate
  inputActions: SettledPreviewNodeViewProps['inputActions']
}) {
  const title = preview.title ?? t('row.title')
  const height = preview.height ?? DEFAULT_FRAME_HEIGHT_PX
  const controls = useSettledDocument({ title: preview.title, html: preview.html, inputActions })
  // The mounted card is the frame's primary home for this call: hold the
  // coverage while mounted, release it on unmount, and the keyed tool row
  // collapses to its summary for exactly that window.
  useEffect(() => {
    retainCoverage(preview.callId)
    return () => { releaseCoverage(preview.callId) }
  }, [preview.callId])
  return (
    <div className={css.card} data-tool="visualizer" data-phase="settled">
      <div className={css.previewHeader}>
        <IconCodeOutline16 size={14} />
        <span className={css.title}>{title}</span>
        <span className={css.separator} aria-hidden />
        <span className={css.summary}>{t('row.chars', { chars: preview.html.length })}</span>
        {controls.failedSrc !== null && <span className={css.scriptError}>{t('row.scriptError')}</span>}
        {controls.runtimeError !== null && (
          <span className={css.scriptError}>
            {t('row.runtimeError')}
            {controls.runtimeError}
          </span>
        )}
        {/* Same controls as the keyed row's settled chrome, in the same
         * order; no disclosure wrapper, so no click suppression. */}
        <button
          type="button"
          className={css.download}
          aria-label={controls.fullscreen.active ? t('row.exitFullscreen') : t('row.fullscreen')}
          title={controls.fullscreen.active ? t('row.exitFullscreen') : t('row.fullscreen')}
          onClick={() => { controls.fullscreen.toggle() }}
        >
          <IconFullscreenOutline16 size={14} />
        </button>
        <button
          type="button"
          className={controls.annotate ? css.downloadActive : css.download}
          aria-pressed={controls.annotate}
          aria-label={t('row.commentMode')}
          title={t('row.commentModeTitle')}
          onClick={() => { controls.toggleAnnotate() }}
        >
          <IconListPenOutline16 size={14} />
        </button>
        <button
          type="button"
          className={css.download}
          aria-label={controls.copied ? t('row.copied') : t('row.copy')}
          title={controls.copied ? t('row.copied') : t('row.copy')}
          onClick={() => { controls.onCopy() }}
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
          onClick={() => { downloadDocument(title, preview.html) }}
        >
          <IconDownloadOutline16 size={14} />
        </button>
        {controls.shareable && (
          <button
            type="button"
            className={css.download}
            aria-label={t('row.share')}
            title={t('row.share')}
            onClick={() => { controls.onShare() }}
          >
            <IconShareOutline16 size={14} />
          </button>
        )}
      </div>
      <div className={css.frameWrap} ref={controls.fullscreen.ref}>
        <AutoFrame
          title={title}
          html={preview.html}
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
      </div>
      <CommentBar
        picks={controls.picks}
        onComment={controls.onComment}
        onRemove={controls.onRemovePick}
        onSend={controls.sendAnnotations}
        onClear={controls.onClearPicks}
        t={t}
      />
    </div>
  )
}

/** Render this turn's settled visualizer documents, in call order. */
export function SettledPreviewNodeView({ node, t, inputActions }: SettledPreviewNodeViewProps) {
  return (
    <div className={css.stack}>
      {node.data.previews.map(preview => (
        <PreviewDoc key={preview.callId} preview={preview} t={t} inputActions={inputActions} />
      ))}
    </div>
  )
}
