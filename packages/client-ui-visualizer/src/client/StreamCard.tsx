// generativeui-stream chat node: the live half of the render_html
// presentation. Each card drives one null-origin shell frame through a
// StreamFrameController — markup arrives as coalesced postMessage replaces,
// scripts run exactly once at the phase-complete commit, and an interrupted
// stream keeps its last painted partial without ever running scripts. The
// card hides itself from the flow once the keyed tool.call.toolview row takes
// over, so this component only ever renders live evidence.

import { useCallback, useEffect, useRef, useState } from 'react'
import { DisclosureRow, IconCodeOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { GenerativeCardData } from './stream-node.ts'
import { downloadDocument } from './download.ts'
import { StreamFrameController } from './stream-bridge.ts'
import { STREAM_SHELL } from './shell.ts'
import css from './Card.module.css'

/** Full card props composed by the keyed Chat Node slot. */
export type StreamCardProps = PropsRuntime<'conversation.chat.node', 'generativeui-stream'>
  & PropsLocale<'generativeui'>

/** Frame height default mirrored from the tool's execute-time default. */
const DEFAULT_FRAME_HEIGHT_PX = 480

type Translate = StreamCardProps['t']

/** One live document card and its shell frame. */
function LiveDoc({ card, t }: { card: GenerativeCardData; t: Translate }) {
  const controller = useRef<StreamFrameController | null>(null)
  const [expanded, setExpanded] = useState(true)
  const title = card.title ?? t('card.title')
  const height = card.height ?? DEFAULT_FRAME_HEIGHT_PX
  const summary = card.phase === 'streaming'
    ? t('card.streaming')
    : card.phase === 'interrupted'
      ? t('card.interrupted')
      : t('card.chars', { chars: card.html.length })

  const attach = useCallback((frame: HTMLIFrameElement | null): void => {
    controller.current?.destroy()
    controller.current = frame === null ? null : new StreamFrameController(frame)
  }, [])
  useEffect(() => (): void => { controller.current?.destroy() }, [])
  useEffect(() => {
    const bridge = controller.current
    if (bridge === null) return
    if (card.phase === 'complete') bridge.commit(card.html)
    // An interrupted stream keeps its last painted partial; scripts never run.
    else if (card.phase === 'streaming') bridge.update(card.html)
  }, [card.html, card.phase])

  return (
    <div className={css.card} data-tool="render_html" data-phase={card.phase}>
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
            <span className={css.summary}>{summary}</span>
            {card.phase === 'complete' && (
              <button
                type="button"
                className={css.download}
                onClick={(event) => {
                  event.stopPropagation()
                  downloadDocument(title, card.html)
                }}
              >
                {t('row.download')}
              </button>
            )}
          </>
        )}
      >
        <iframe
          ref={attach}
          className={css.frame}
          srcDoc={STREAM_SHELL}
          title={title}
          sandbox="allow-scripts"
          style={{ height: `${height}px` }}
        />
      </DisclosureRow>
    </div>
  )
}

/** Render this step's live render_html streaming cards. */
export function StreamCard({ node, t }: StreamCardProps) {
  return (
    <div className={css.stack}>
      {node.data.cards.map((card, index) => <LiveDoc key={index} card={card} t={t} />)}
    </div>
  )
}
