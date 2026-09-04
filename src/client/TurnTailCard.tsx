// visualizer turn-tail row: the Compact-transcript safety net. `turn-tail`
// does not exist as a chat node until `turn/end` (see turn-tail.ts), so this
// can only ever take over at that boundary — but it IS exempt from the
// turn-process fold that hides the in-place tool-call row once the turn
// closes, so every settled document republishes here too, once, after the
// closing message. Normal transcript view never folds anything, so the
// in-place row's own copy already survives there without help — this stays
// empty in that mode instead of showing a redundant second copy.

import { useCallback } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { SettledDoc } from './SettledDoc.tsx'
import { submitWidgetPrompt, type WidgetInputActions } from './bridge-actions.ts'
import { normalTranscriptView, type ChatSettingsSection } from './transcript-view.ts'
import type { VisualizerTurnCard } from './turn-tail.ts'
import css from './Card.module.css'

/** Full card props composed by the `conversation.chat.turnTail` chain slot. */
export type TurnTailCardProps = {
  matched: readonly VisualizerTurnCard[]
  inputActions: WidgetInputActions
  /** Synthesized from the `transcriptView` hooks-inject member (see index.ts). */
  useTranscriptView: (selector: (snapshot: { value: ChatSettingsSection | undefined }) => boolean) => boolean
} & PropsLocale<'visualizer'>

/** Render every settled visualizer document produced by one closed turn, unless Normal view already shows it in place. */
export function TurnTailCard({ matched, t, inputActions, useTranscriptView }: TurnTailCardProps) {
  const onPrompt = useCallback((text: string): void => { submitWidgetPrompt(inputActions, text) }, [inputActions])
  const normalView = useTranscriptView(normalTranscriptView)
  if (normalView) return null
  return (
    <div className={css.stack}>
      {matched.map(card => <SettledDoc key={card.callId} argsRaw={card.argsRaw} t={t} onPrompt={onPrompt} />)}
    </div>
  )
}
