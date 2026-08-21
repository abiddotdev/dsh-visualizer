// visualizer-stream chat node: the live half of the visualizer
// presentation. Each card drives one content-sized shell frame (AutoFrame) —
// markup arrives as coalesced postMessage replaces, the frame grows with the
// measured content, scripts run exactly once at the phase-complete commit,
// and an interrupted stream keeps its last painted partial without ever
// running scripts. The card hides itself from the flow once the keyed
// tool.call.toolview row takes over, so this component only ever renders
// live evidence.

import { useState } from 'react'
import { DisclosureRow, IconCodeOutline16, IconDownloadOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { GenerativeCardData } from './stream-node.ts'
import { downloadDocument } from './download.ts'
import { AutoFrame, START_FRAME_HEIGHT_PX } from './AutoFrame.tsx'
import css from './Card.module.css'

/** Full card props composed by the keyed Chat Node slot. */
export type StreamCardProps = PropsRuntime<'conversation.chat.node', 'visualizer-stream'>
  & PropsLocale<'visualizer'>

type Translate = StreamCardProps['t']

/** One live document card and its shell frame. */
function LiveDoc({ card, t }: { card: GenerativeCardData; t: Translate }) {
  const [expanded, setExpanded] = useState(true)
  const title = card.title ?? t('card.title')
  const summary = card.phase === 'streaming'
    ? card.html.length === 0 ? t('card.thinking') : t('card.streaming')
    : card.phase === 'interrupted'
      ? t('card.interrupted')
      : t('card.chars', { chars: card.html.length })
  // The typing wave runs for the whole streaming phase — composing and
  // writing alike — and stops the moment the document settles.
  const live = card.phase === 'streaming'

  return (
    <div className={css.card} data-tool="visualizer" data-phase={card.phase}>
      <DisclosureRow
        rowClassName={css.row}
        titleClassName={css.title}
        chevronClassName={css.chevron}
        icon={<IconCodeOutline16 size={14} />}
        title={title}
        open={expanded}
        expandable={card.html.length > 0}
        expandOnRowClick
        keepContentWhenOpen
        onToggle={() => { setExpanded(value => !value) }}
        collapsedContent={(
          <>
            <span className={css.separator} aria-hidden />
            {/* The shimmer class carries the live phase; the plain summary
             * color serves the settled and interrupted labels. */}
            <span className={live ? `${css.summary} ${css.summaryLive}` : css.summary}>
              {summary}
            </span>
            {card.phase === 'complete' && (
              <button
                type="button"
                className={css.download}
                onClick={(event) => {
                  event.stopPropagation()
                  downloadDocument(title, card.html)
                }}
              >
                <IconDownloadOutline16 size={14} />
                {t('row.download')}
              </button>
            )}
          </>
        )}
      >
        {/* An interrupted stream keeps its last painted partial; scripts never
         * run. The frame opens at chat-line height regardless of any height
         * argument — measurements own the height, and a short open feels
         * native. */}
        {card.phase !== 'interrupted' && (
          <AutoFrame
            title={title}
            html={card.html}
            phase={card.phase === 'complete' ? 'complete' : 'streaming'}
            initialHeight={START_FRAME_HEIGHT_PX}
            className={css.frame}
          />
        )}
      </DisclosureRow>
    </div>
  )
}

/** Render this step's live visualizer streaming cards. */
export function StreamCard({ node, t }: StreamCardProps) {
  return (
    <div className={css.stack}>
      {node.data.cards.map((card, index) => <LiveDoc key={index} card={card} t={t} />)}
    </div>
  )
}
