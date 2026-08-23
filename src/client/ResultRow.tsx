// visualizer toolview row: the settled half of the presentation. A call's
// document reaches this row through one of two logged sources: inline mode's
// complete arguments (logged by tool/call and backfilled onto the result),
// or file mode's settled result presentation meta, which carries the bytes
// the tool loaded from the workspace file. Either way this row renders the
// document directly in a null-origin srcDoc frame (no bridge, no shell: a
// complete document needs no streaming machinery). The download control
// materializes the same bytes client-side as a Blob; it appears only on a
// settled successful call, because a partial download is corrupt by
// definition.

import { useCallback, useMemo, useState } from 'react'
import { DisclosureRow, IconCheckOutline16, IconCodeOutline16, IconCopyOutline16, IconDownloadOutline16, IconWarningOutline16, StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import { AutoFrame } from './AutoFrame.tsx'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import { COPY_FEEDBACK_MS, copyDocument, downloadDocument } from './download.ts'
import { openWidgetLink, submitWidgetPrompt } from './bridge-actions.ts'
import { createWidgetStorage, widgetStorageScope } from './widget-storage.ts'
import css from './Card.module.css'

/** Full card props composed by the keyed Tool slot. */
export type ResultRowProps = ToolCallViewProps & PropsLocale<'visualizer'>

/**
 * Frame height bounds and default mirrored from the tool's execute-time
 * validation in src/index.ts — the client bundle cannot import the node
 * half, so the copy is the price of the two-plane split; change both.
 */
const MIN_FRAME_HEIGHT_PX = 50
const MAX_FRAME_HEIGHT_PX = 2_000
const DEFAULT_FRAME_HEIGHT_PX = 480

/** Decoded document view of one visualizer call, from either logged source. */
interface DocView {
  title: string | null
  height: number | null
  html: string
}

/**
 * Decode the complete arguments of one inline-mode visualizer call.
 * @param argsRaw - the frozen raw arguments string of the call.
 * @returns the view when the JSON parses and carries a non-empty document,
 * else null.
 */
function argsView(argsRaw: string): DocView | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(argsRaw)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null
  const { title, height, html } = parsed as Record<string, unknown>
  if (typeof html !== 'string' || html.length === 0) return null
  return safeView(title, height, html)
}

/**
 * Shape-check one settled result's presentation meta — it crosses the wire —
 * into a document view for file mode, whose arguments carry only the path.
 * @param meta - the settled block's `meta` field.
 * @returns the view when every field is present and well-typed, else null.
 */
function metaView(meta: unknown): DocView | null {
  if (typeof meta !== 'object' || meta === null) return null
  const { title, html, height } = meta as Record<string, unknown>
  if (typeof html !== 'string' || html.length === 0) return null
  return safeView(title, height, html)
}

/**
 * Assemble a document view with the shared title and height guards.
 * @param title - the decoded title, when present.
 * @param height - the decoded opening height, when present.
 * @param html - the non-empty decoded document.
 * @returns the guarded view.
 */
function safeView(title: unknown, height: unknown, html: string): DocView {
  const safeHeight = typeof height === 'number' && Number.isInteger(height)
    && height >= MIN_FRAME_HEIGHT_PX && height <= MAX_FRAME_HEIGHT_PX
  return {
    title: typeof title === 'string' && title.trim().length > 0 ? title : null,
    height: safeHeight ? height : null,
    html,
  }
}

/**
 * Detect a file-mode call from its complete arguments: a path named while no
 * document streams. The row then shows the running state until the settled
 * result lands its presentation meta.
 * @param argsRaw - the raw arguments of the call head.
 * @returns the requested path when the call is file mode, else null.
 */
function filePathOf(argsRaw: string): string | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(argsRaw)
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null
  const { path, html } = parsed as Record<string, unknown>
  if (typeof path !== 'string' || path.trim().length === 0) return null
  if (typeof html === 'string' && html.length > 0) return null
  return path
}

/** The argsRaw of either block form: direct on a running head, backfilled on a settled result. */
function argsRawOf(block: ToolCallViewProps['block']): string {
  return 'kind' in block ? (block.call?.argsRaw ?? '') : block.argsRaw
}

/** Render one settled or running `visualizer` call. */
export function ResultRow({ block, t, inputActions }: ResultRowProps) {
  const settled = 'kind' in block
  const onPrompt = useCallback((text: string): void => { submitWidgetPrompt(inputActions, text) }, [inputActions])
  // Inline mode renders from the logged arguments; file mode's arguments
  // carry only a path, so its settled result meta is the bytes' only source.
  const argsDoc = !settled || !block.isError ? argsView(argsRawOf(block)) : null
  const metaDoc = settled && !block.isError ? metaView(block.meta) : null
  const view = argsDoc ?? metaDoc
  // Loading state belongs to the running phase only: once settled, a file
  // call whose meta carries no document has failed to deliver one.
  const loadingFile = !settled && view === null ? filePathOf(argsRawOf(block)) : null
  const title = view?.title ?? t('row.title')
  const height = view?.height ?? DEFAULT_FRAME_HEIGHT_PX
  // The failure rides the alert icon in the row chrome; its native tooltip
  // carries the full error the result logged.
  const errorInfo = settled && block.isError && block.error !== undefined ? block.error : null
  const summary = view !== null
    ? settled && !block.isError
      ? t('row.chars', { chars: view.html.length })
      : t('row.running')
    : loadingFile !== null
      ? t('row.loading', { path: loadingFile })
      : errorInfo !== null
        ? ''
        : t('row.missing')
  const [expanded, setExpanded] = useState(true)
  const [copied, setCopied] = useState(false)
  // First failed external script wins: one notice per row, later failures
  // add nothing.
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  // First runtime error message wins; the first is the defect, the rest
  // repeat it.
  const [runtimeError, setRuntimeError] = useState<string | null>(null)
  const onRuntimeError = useCallback((message: string): void => {
    setRuntimeError(current => current ?? message)
  }, [])
  // State follows the document's title: the same title regenerates into the
  // same scope, and the streaming card derives the identical one.
  const storage = useMemo(() => createWidgetStorage(widgetStorageScope(view?.title ?? null)), [view?.title])
  const settledOk = settled && !block.isError && view !== null

  /** Collapsed-row trailing content: char count, then the download control on a settled success. */
  const rowChrome = () => (
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
      {errorInfo !== null && (
        <span
          className={css.alertIcon}
          title={`${errorInfo.name}: ${errorInfo.code}`}
          aria-label={`${errorInfo.name}: ${errorInfo.code}`}
        >
          <IconWarningOutline16 size={14} />
        </span>
      )}
      {settledOk && (
        <>
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
            {/* The check mark is the copied confirmation; the accessible name
             * carries the state change. */}
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
        </>
      )}
    </>
  )

  // Same DisclosureRow chrome as the streaming card above it: one expandable
  // frame per visualizer call, differing only in document source.
  /* jscpd:ignore-start — the DisclosureRow chrome is shared with the
     streaming card; the two rows differ in document source, not chrome. */
  return rowJsx()

  /** The outer card DOM; separated so the shared chrome stays one unit. */
  function rowJsx() {
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
          expandable={view !== null}
          expandOnRowClick
          keepContentWhenOpen
          onToggle={() => { setExpanded(value => !value) }}
          collapsedContent={rowChrome()}
        >
          {view !== null && (
            <div className={css.frameWrap}>
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
              />
              {/* Same live-phase sheen as the streaming card, over the
               * running row's already-visible document. */}
              {!settled && <div className={css.streamSweep} aria-hidden />}
            </div>
          )}
        </DisclosureRow>
      </div>
    )
  }
  /* jscpd:ignore-end */
}
