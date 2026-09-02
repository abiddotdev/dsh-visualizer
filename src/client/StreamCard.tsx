// visualizer-stream chat node: the one surface that carries a visualizer
// call from its first streamed byte through settlement. Each card drives one
// content-sized shell frame (AutoFrame) — markup arrives as coalesced
// postMessage replaces, the frame grows with the measured content, scripts
// run exactly once at the phase-complete commit, and an interrupted stream
// keeps its last painted partial without ever running scripts. Once
// `tool/call` dispatches, the card either keeps rendering right through
// settlement (chatPreview live: it retains coverage so the keyed
// tool.call.toolview row drops to a bare summary) or hides outright, ceding
// to the row exactly as before that feature existed — the two surfaces never
// double-render either way.

import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { DisclosureRow, IconCheckOutline16, IconCodeOutline16, IconCopyOutline16, IconDownloadOutline16, IconFullscreenOutline16, IconListPenOutline16, IconShareOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { GenerativeCardData } from './stream-node.ts'
import { downloadDocument } from './download.ts'
import { openWidgetLink } from './bridge-actions.ts'
import { useSettledDocument } from './settled-document.ts'
import { retainCoverage, releaseCoverage } from './preview-coverage.ts'
import { AutoFrame, START_FRAME_HEIGHT_PX } from './AutoFrame.tsx'
import { CommentBar } from './CommentBar.tsx'
import css from './Card.module.css'

/** Full card props composed by the keyed Chat Node slot. */
export type StreamCardProps = PropsRuntime<'conversation.chat.node', 'visualizer-stream'>
  & PropsLocale<'visualizer'>

type Translate = StreamCardProps['t']

/** Dwell time per model-authored loading message before the next rotates in. */
const LOADING_MESSAGE_MS = 4_800

/** Index into the loading messages, clamped to those arrived so far. */
function messageIndex(tick: number, count: number): number {
  return count === 0 ? 0 : tick % count
}

/** Stagger between neighboring glyph PAIRS of the loader wave: each pair
 * of characters rises and falls as one unit, this long after its left
 * neighbor, giving the label one small wave traveling in reading
 * direction. */
const WAVE_STAGGER_MS = 70

/** Glyphs per wave unit — every bob carries exactly this many characters
 * when the word allows it; the tail bob keeps the remainder. "Big wave…"
 * splits as [Big] [wav][e…]. */
const WAVE_GROUP_SIZE = 3

/** Split one word's glyphs into fixed-size bobs of {@link WAVE_GROUP_SIZE}
 * characters; the last bob may be shorter (a remainder). */
function waveGroups(chars: readonly string[]): string[] {
  const groups: string[] = []
  for (let start = 0; start < chars.length; start += WAVE_GROUP_SIZE) {
    groups.push(chars.slice(start, start + WAVE_GROUP_SIZE).join(''))
  }
  return groups
}

/** The loader label as per-word, per-BOB spans riding the wave. Words are
 * unbreakable inline-blocks separated by real spaces, so wrapping stays at
 * word boundaries; the bob stagger rides an inline animation-delay, so no
 * per-glyph class explosion. */
function WaveText({ label }: { label: string }): ReactNode[] {
  let groupIndex = 0
  return label.split(' ').flatMap((word, wordIndex): ReactNode[] => {
    const groups = waveGroups(Array.from(word))
    const bobs: ReactNode[] = groups.map((text, at) => (
      <span
        key={at}
        className={css.waveGlyph}
        style={{ animationDelay: `${-(groupIndex + at) * WAVE_STAGGER_MS}ms`}}
      >
        {text}
      </span>
    ))
    groupIndex += groups.length // each bob advances the phase…
    groupIndex++ // …and the space between words advances it too
    const wordSpan = <span key={`w${wordIndex}`} className={css.waveWord}>{bobs}</span>
    return wordIndex === 0 ? [wordSpan] : [' ', wordSpan]
  })
}

/** One live document card and its shell frame. */
function LiveDoc({ card, t, inputActions }: {
  card: GenerativeCardData
  t: Translate
  inputActions: StreamCardProps['inputActions']
}) {
  const [expanded, setExpanded] = useState(true)
  const title = card.title ?? t('card.title')
  const controls = useSettledDocument({ title: card.title, html: card.html, inputActions })
  // A card whose call dispatched is this callId's frame's primary home; the
  // keyed row drops to a bare summary for exactly this window, and hands the
  // frame back the moment this card unmounts (settle-with-error excludes it
  // upstream, or the feature is disabled and it never mounts at all).
  useEffect(() => {
    const callId = card.callId
    if (callId === undefined) return
    retainCoverage(callId)
    return () => { releaseCoverage(callId) }
  }, [card.callId])
  // Model-authored loading messages rotate on a fixed dwell while the
  // document streams; the generic phase label is the fallback when the
  // model passed none.
  const messages = card.loadingMessages ?? []
  const [tick, setTick] = useState(0)
  const live = card.phase === 'streaming'
  useEffect(() => {
    if (!live || messages.length <= 1) return
    const timer = window.setInterval(() => { setTick(value => value + 1) }, LOADING_MESSAGE_MS)
    return () => { window.clearInterval(timer) }
  }, [live, messages.length])
  const streamingLabel = messages.length > 0
    ? (messages[messageIndex(tick, messages.length)] ?? '')
    : card.html.length === 0 ? t('card.thinking') : t('card.streaming')
  // Loading messages always read as in-progress: append an ellipsis unless
  // the model already ended its message with one.
  const withEllipsis = (text: string): string =>
    text === '' || /(?:…|\.\.\.)$/.test(text.trimEnd()) ? text : `${text}…`
  const summary = card.phase === 'streaming'
    ? withEllipsis(streamingLabel)
    : card.phase === 'interrupted'
      ? t('card.interrupted')
      : t('card.chars', { chars: card.html.length })
  // The loader text wave runs only while model-authored messages are
  // cycling; composing/streaming fallbacks show no wave.
  const isLoaderText = card.phase === 'streaming' && messages.length > 0
  // The document is settled and controllable once the phase flips to
  // complete — dispatch alone (chatPreview live) does not gate this: the
  // html is already final and safe to copy/download/share the moment it
  // decodes clean, whether or not the executor has confirmed it yet.
  const settledOk = card.phase === 'complete'

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
            <span className={`${css.summary}${isLoaderText ? ` ${css.summaryWave}` : ''}`}>
              {isLoaderText && summary !== ''
                ? (
                    <>
                      {/* The screen-reader twin carries the whole message;
                       * the visual copy splits into waved glyphs. */}
                      <span className={css.srOnly}>{summary}</span>
                      <span aria-hidden><WaveText label={summary} /></span>
                    </>
                  )
                : summary}
            </span>
            {controls.failedSrc !== null && <span className={css.scriptError}>{t('card.scriptError')}</span>}
            {controls.runtimeError !== null && (
              <span className={css.scriptError}>
                {t('card.runtimeError')}
                {controls.runtimeError}
              </span>
            )}
            {settledOk && (
              <>
                {/* The frame must be mounted to hold fullscreen, so this
                 * control rides the expanded row alone; copy, download, and
                 * share act on the document bytes and need no frame. */}
                {expanded && (
                  <button
                    type="button"
                    className={css.download}
                    aria-label={controls.fullscreen.active ? t('card.exitFullscreen') : t('card.fullscreen')}
                    title={controls.fullscreen.active ? t('card.exitFullscreen') : t('card.fullscreen')}
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
                  aria-label={controls.copied ? t('card.copied') : t('card.copy')}
                  title={controls.copied ? t('card.copied') : t('card.copy')}
                  onClick={(event) => {
                    event.stopPropagation()
                    controls.onCopy()
                  }}
                >
                  {/* The check mark is the copied confirmation; the accessible
                   * name carries the state change. */}
                  {controls.copied ? <IconCheckOutline16 size={14} /> : <IconCopyOutline16 size={14} />}
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
                {controls.shareable && (
                  <button
                    type="button"
                    className={css.download}
                    aria-label={t('card.share')}
                    title={t('card.share')}
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
        )}
      >
        {/* An interrupted stream keeps its last painted partial; scripts never
         * run. The frame opens at chat-line height regardless of any height
         * argument — measurements own the height, and a short open feels
         * native, for this card's whole life through settlement. */}
        {card.phase !== 'interrupted' && (
          <div className={css.frameWrap} ref={controls.fullscreen.ref}>
            <AutoFrame
              title={title}
              html={card.html}
              phase={card.phase === 'complete' ? 'complete' : 'streaming'}
              initialHeight={START_FRAME_HEIGHT_PX}
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
            {/* The sheen rides only the live phase; a settled or interrupted
             * frame renders plain. */}
            {live && <div className={css.streamSweep} aria-hidden />}
          </div>
        )}
        {settledOk && (
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

/** Render this turn's live (and settled-preview) visualizer cards. */
export function StreamCard({ node, t, inputActions }: StreamCardProps) {
  return (
    <div className={css.stack}>
      {node.data.cards.map((card, index) => (
        <LiveDoc key={card.callId ?? index} card={card} t={t} inputActions={inputActions} />
      ))}
    </div>
  )
}
