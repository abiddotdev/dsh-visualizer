// visualizer toolview row: the settled half of the presentation. The call's
// complete arguments — logged by tool/call and backfilled onto the result —
// are the document's authoritative home, so this row JSON-parses argsRaw and
// renders the document directly in a null-origin srcDoc frame (no bridge, no
// shell: a complete document needs no streaming machinery). The download
// control materializes the same bytes client-side as a Blob; it appears only
// on a settled successful call, because a partial download is corrupt by
// definition.

import { useCallback, useState } from 'react'
import { DisclosureRow, IconCodeOutline16, IconDownloadOutline16, StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import { AutoFrame } from './AutoFrame.tsx'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import { downloadDocument } from './download.ts'
import { submitWidgetPrompt } from './bridge-actions.ts'
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

/** Decoded view of one complete visualizer call's arguments. */
interface ArgsView {
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
function argsView(argsRaw: string): ArgsView | null {
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

/** The argsRaw of either block form: direct on a running head, backfilled on a settled result. */
function argsRawOf(block: ToolCallViewProps['block']): string {
  return 'kind' in block ? (block.call?.argsRaw ?? '') : block.argsRaw
}

/** Render one settled or running `visualizer` call. */
export function ResultRow({ block, t, inputActions }: ResultRowProps) {
  const settled = 'kind' in block
  const onPrompt = useCallback((text: string): void => { submitWidgetPrompt(inputActions, text) }, [inputActions])
  const view = !settled || !block.isError ? argsView(argsRawOf(block)) : null
  const title = view?.title ?? t('row.title')
  const height = view?.height ?? DEFAULT_FRAME_HEIGHT_PX
  const summary = view !== null
    ? settled && !block.isError
      ? t('row.chars', { chars: view.html.length })
      : t('row.running')
    : settled && block.isError && block.error !== undefined
      ? block.error.code
      : t('row.missing')
  const [expanded, setExpanded] = useState(true)
  const settledOk = settled && !block.isError && view !== null

  /** Collapsed-row trailing content: char count, then the download control on a settled success. */
  const rowChrome = () => (
    <>
      <span className={css.separator} aria-hidden />
      <span className={css.summary}>{summary}</span>
      {settledOk && (
        <button
          type="button"
          className={css.download}
          onClick={(event) => {
            event.stopPropagation()
            downloadDocument(title, view.html)
          }}
        >
          <IconDownloadOutline16 size={14} />
          {t('row.download')}
        </button>
      )}
    </>
  )

  // DisclosureRow wiring mirrors the settled show_html row deliberately: both
  // cards are the same expandable chrome over a sandboxed frame; only the
  // document source (logged arguments vs result meta) differs.
  /* jscpd:ignore-start — the DisclosureRow chrome is the shared show_html card
     wiring; the two rows differ in document source, not in chrome. */
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
            <AutoFrame
              title={title}
              html={view.html}
              phase="complete"
              initialHeight={height}
              className={css.frame}
              onPrompt={onPrompt}
            />
          )}
        </DisclosureRow>
      </div>
    )
  }
  /* jscpd:ignore-end */
}
