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

import { useCallback } from 'react'
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

/** Render one `visualizer` call: the live frame while running or settled-ok, else a status-only row. */
export function ResultRow({ block, t, inputActions }: ResultRowProps) {
  const settled = 'kind' in block
  const onPrompt = useCallback((text: string): void => { submitWidgetPrompt(inputActions, text) }, [inputActions])
  const view = !settled || !block.isError ? argsView(argsRawOf(block)) : null

  if (view !== null) {
    return <SettledDoc argsRaw={argsRawOf(block)} t={t} onPrompt={onPrompt} state={settled ? 'ok' : 'running'} />
  }

  // No renderable document: either an error result (the alert icon carries
  // it) or arguments with no html. Neither has a frame to show.
  const title = t('row.title')
  const errorInfo = settled && block.isError && block.error !== undefined ? block.error : null
  const summary = errorInfo !== null ? '' : t('row.missing')

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
        open={false}
        expandable={false}
        onToggle={() => {}}
        collapsedContent={(
          <>
            <span className={css.separator} aria-hidden />
            <span className={css.summary}>{summary}</span>
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
