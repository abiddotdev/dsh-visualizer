// visualizer toolview row: the in-place presentation. The frame stays here
// — full chrome once settled, sweep sheen while running — for as long as the
// turn is open, exactly as before this row had a turn-tail counterpart: the
// only thing that changed is what happens once the turn closes. Compact
// transcript view folds this row's owning tool-call node behind one
// disclosure at that point (harness 0.1.2-rc.1), so a second copy also
// republishes through `conversation.chat.turnTail` (TurnTailCard.tsx, exempt
// from that fold) — briefly redundant in Normal view, but it means the frame
// never disappears before it has to. An error never reaches turn-tail: it
// rides the alert icon here instead, where it already settles before any
// turn can close.

import { useCallback, useMemo } from 'react'
import { DisclosureRow, IconCodeOutline16, IconWarningOutline16, StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import { SettledDoc } from './SettledDoc.tsx'
import { argsView } from './args-view.ts'
import { submitWidgetPrompt } from './bridge-actions.ts'
import css from './Card.module.css'

/** Full card props composed by the keyed Tool slot. */
export type ResultRowProps = ToolCallViewProps & PropsLocale<'visualizer'>

/** The argsRaw of either block form: direct on a running head, backfilled on a settled result. */
function argsRawOf(block: ToolCallViewProps['block']): string {
  return 'kind' in block ? (block.call?.argsRaw ?? '') : block.argsRaw
}

/** Longest error cause shown on the row; the rest stays in the trajectory view. */
const MAX_ERROR_SUMMARY_CHARS = 160

/**
 * The cause of a failed call, from the first text block of its result. The
 * `error` field carries only a name and a code (`Error: TOOL_ERROR`), while
 * the message the tool threw — the byte overflow, the out-of-range height —
 * rides the result content, so this is the one place the row can state what
 * actually went wrong. Content blocks are merge-extensible, hence the
 * structural read rather than a narrowed union.
 * @param content - the settled result's content blocks.
 * @returns the trimmed, bounded message, or null when none is carried.
 */
function errorCause(content: readonly unknown[]): string | null {
  for (const block of content) {
    if (typeof block !== 'object' || block === null) continue
    const { type, text } = block as { type?: unknown; text?: unknown }
    if (type !== 'text' || typeof text !== 'string') continue
    const trimmed = text.trim()
    if (trimmed.length > 0) return trimmed.slice(0, MAX_ERROR_SUMMARY_CHARS)
  }
  return null
}

/** Render one `visualizer` call: the live frame while running or settled-ok, else a status-only row. */
export function ResultRow({ block, t, inputActions, inspect, callId }: ResultRowProps) {
  const settled = 'kind' in block
  const onPrompt = useCallback((text: string): void => { submitWidgetPrompt(inputActions, text) }, [inputActions])
  const argsRaw = argsRawOf(block)
  // SettledDoc re-derives the same view from argsRaw itself (and memoizes it
  // there); this copy exists only to route between the frame and the
  // status-only row below, so it's memoized too rather than re-parsing a
  // possibly near-byte-cap document on every unrelated re-render.
  const view = useMemo(
    () => !settled || !block.isError ? argsView(argsRaw) : null,
    [settled, block, argsRaw],
  )

  if (view !== null) {
    return (
      <SettledDoc
        argsRaw={argsRaw}
        t={t}
        onPrompt={onPrompt}
        state={settled ? 'ok' : 'running'}
        inspect={inspect}
        callId={callId}
      />
    )
  }

  // No renderable document: either an error result (stated on the row, with
  // the alert icon carrying its name and code) or arguments with no html.
  // Neither has a frame to show.
  const title = t('row.title')
  const failed = settled && block.isError
  const errorInfo = failed && block.error !== undefined ? block.error : null
  // A failed call states its cause on the row; the alert icon keeps carrying
  // the error's name and code for the cases that have no message to show.
  const cause = failed ? errorCause(block.content) : null
  const summary = failed ? cause ?? '' : t('row.missing')

  return (
    <div
      className={css.card}
      data-tool="visualizer"
      data-state={settled ? (failed ? 'error' : 'ok') : 'running'}
    >
      <DisclosureRow
        rowClassName={css.row}
        titleClassName={css.title}
        chevronClassName={css.chevron}
        icon={failed ? <StateDot state="error" /> : <IconCodeOutline16 size={14} />}
        title={title}
        open={false}
        expandable={false}
        onToggle={() => {}}
        collapsedContent={(
          <>
            <span className={css.separator} aria-hidden />
            <span
              className={cause !== null ? css.scriptError : css.summary}
              title={cause ?? undefined}
            >
              {summary}
            </span>
            {errorInfo !== null && (
              <span
                className={css.alertIcon}
                title={`${errorInfo.name}: ${errorInfo.code}`}
                aria-label={`${errorInfo.name}: ${errorInfo.code}`}
              >
                <IconWarningOutline16 size={14} />
              </span>
            )}
          </>
        )}
      />
    </div>
  )
}
