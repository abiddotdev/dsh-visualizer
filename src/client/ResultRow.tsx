// visualizer toolview row: the in-place running/error status. A settled
// success no longer renders its document here — Compact transcript view
// (harness 0.1.2-rc.1) folds this row's owning tool-call node behind one
// disclosure once the turn closes, so the full interactive card moved to the
// `conversation.chat.turnTail` chain (see turn-tail.ts, TurnTailCard.tsx),
// which sits outside that fold. This row keeps only what still needs to be
// seen at call time: a running spinner, and an error's alert icon and
// tooltip — both settle before the fold can apply.

import { DisclosureRow, IconCodeOutline16, IconWarningOutline16, StateDot } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import { argsView } from './args-view.ts'
import css from './Card.module.css'

/** Full card props composed by the keyed Tool slot. */
export type ResultRowProps = ToolCallViewProps & PropsLocale<'visualizer'>

/** The argsRaw of either block form: direct on a running head, backfilled on a settled result. */
function argsRawOf(block: ToolCallViewProps['block']): string {
  return 'kind' in block ? (block.call?.argsRaw ?? '') : block.argsRaw
}

/** Render one running or error `visualizer` call; a settled success shows a pointer to its turn-tail card. */
export function ResultRow({ block, t }: ResultRowProps) {
  const settled = 'kind' in block
  const view = !settled || !block.isError ? argsView(argsRawOf(block)) : null
  const title = view?.title ?? t('row.title')
  const errorInfo = settled && block.isError && block.error !== undefined ? block.error : null
  const summary = view !== null
    ? settled && !block.isError
      ? t('row.rendered')
      : t('row.running')
    : errorInfo !== null
      ? ''
      : t('row.missing')

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
