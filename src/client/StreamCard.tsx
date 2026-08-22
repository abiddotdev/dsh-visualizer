// visualizer-stream chat node: the live half of the visualizer
// presentation. Each card drives one content-sized shell frame (AutoFrame) —
// markup arrives as coalesced postMessage replaces, the frame grows with the
// measured content, scripts run exactly once at the phase-complete commit,
// and an interrupted stream keeps its last painted partial without ever
// running scripts. The card hides itself from the flow once the keyed
// tool.call.toolview row takes over, so this component only ever renders
// live evidence.

import { useCallback, useMemo, useState } from 'react'
import { DisclosureRow, IconCheckOutline16, IconCodeOutline16, IconCopyOutline16, IconDownloadOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { GenerativeCardData } from './stream-node.ts'
import { COPY_FEEDBACK_MS, copyDocument, downloadDocument } from './download.ts'
import { openWidgetLink, submitWidgetPrompt } from './bridge-actions.ts'
import { createWidgetStorage, widgetStorageScope } from './widget-storage.ts'
import { AutoFrame, START_FRAME_HEIGHT_PX } from './AutoFrame.tsx'
import css from './Card.module.css'

/** Full card props composed by the keyed Chat Node slot. */
export type StreamCardProps = PropsRuntime<'conversation.chat.node', 'visualizer-stream'>
  & PropsLocale<'visualizer'>

type Translate = StreamCardProps['t']

/** One live document card and its shell frame. */
function LiveDoc({ card, t, onPrompt }: { card: GenerativeCardData; t: Translate; onPrompt: (text: string) => void }) {
  const [expanded, setExpanded] = useState(true)
  const [copied, setCopied] = useState(false)
  // First failed external script wins: one notice per card, later failures
  // add nothing.
  const [failedSrc, setFailedSrc] = useState<string | null>(null)
  // First runtime error message wins; the first is the defect, the rest
  // repeat it.
  const [runtimeError, setRuntimeError] = useState<string | null>(null)
  const onRuntimeError = useCallback((message: string): void => {
    setRuntimeError(current => current ?? message)
  }, [])
  const title = card.title ?? t('card.title')
  // State follows the document's title: the same title regenerates into the
  // same scope, and the settled row derives the identical one.
  const storage = useMemo(() => createWidgetStorage(widgetStorageScope(card.title)), [card.title])
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
            <span className={css.summary}>
              {summary}
            </span>
            {failedSrc !== null && <span className={css.scriptError}>{t('card.scriptError')}</span>}
            {runtimeError !== null && (
              <span className={css.scriptError}>
                {t('card.runtimeError')}
                {runtimeError}
              </span>
            )}
            {card.phase === 'complete' && (
              <>
                <button
                  type="button"
                  className={css.download}
                  aria-label={copied ? t('card.copied') : t('card.copy')}
                  title={copied ? t('card.copied') : t('card.copy')}
                  onClick={(event) => {
                    event.stopPropagation()
                    void copyDocument(card.html).then((ok) => {
                      if (!ok) return
                      setCopied(true)
                      window.setTimeout(() => { setCopied(false) }, COPY_FEEDBACK_MS)
                    })
                  }}
                >
                  {/* The check mark is the copied confirmation; the accessible
                   * name carries the state change. */}
                  {copied ? <IconCheckOutline16 size={14} /> : <IconCopyOutline16 size={14} />}
                </button>
                <button
                  type="button"
                  className={css.download}
                  aria-label={t('row.download')}
                  title={t('row.download')}
                  onClick={(event) => {
                    event.stopPropagation()
                    downloadDocument(title, card.html)
                  }}
                >
                  <IconDownloadOutline16 size={14} />
                </button>
              </>
            )}
          </>
        )}
      >
        {/* An interrupted stream keeps its last painted partial; scripts never
         * run. The frame opens at chat-line height regardless of any height
         * argument — measurements own the height, and a short open feels
         * native. */}
        {card.phase !== 'interrupted' && (
          <div className={css.frameWrap}>
            <AutoFrame
              title={title}
              html={card.html}
              phase={card.phase === 'complete' ? 'complete' : 'streaming'}
              initialHeight={START_FRAME_HEIGHT_PX}
              className={css.frame}
              onPrompt={onPrompt}
              onOpenLink={openWidgetLink}
              onScriptError={setFailedSrc}
              onRuntimeError={onRuntimeError}
              storage={storage}
            />
            {/* The sheen rides only the live phase; a settled or interrupted
             * frame renders plain. */}
            {live && <div className={css.streamSweep} aria-hidden />}
          </div>
        )}
      </DisclosureRow>
    </div>
  )
}

/** Render this step's live visualizer streaming cards. */
export function StreamCard({ node, t, inputActions }: StreamCardProps) {
  const onPrompt = useCallback((text: string): void => { submitWidgetPrompt(inputActions, text) }, [inputActions])
  return (
    <div className={css.stack}>
      {node.data.cards.map((card, index) => <LiveDoc key={index} card={card} t={t} onPrompt={onPrompt} />)}
    </div>
  )
}
