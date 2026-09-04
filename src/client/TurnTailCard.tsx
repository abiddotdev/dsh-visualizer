// visualizer turn-tail row: the Compact-transcript safety net. `turn-tail`
// does not exist as a chat node until `turn/end` (see turn-tail.ts), so this
// can only ever take over at that boundary — but it IS exempt from the
// turn-process fold that hides the in-place tool-call row once the turn
// closes, so every settled document republishes here too, once, after the
// closing message.

import { useCallback } from 'react'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { SettledDoc } from './SettledDoc.tsx'
import { submitWidgetPrompt, type WidgetInputActions } from './bridge-actions.ts'
import type { VisualizerTurnCard } from './turn-tail.ts'
import css from './Card.module.css'

/** Full card props composed by the `conversation.chat.turnTail` chain slot. */
export type TurnTailCardProps = {
  matched: readonly VisualizerTurnCard[]
  inputActions: WidgetInputActions
} & PropsLocale<'visualizer'>

/** Render every settled visualizer document produced by one closed turn. */
export function TurnTailCard({ matched, t, inputActions }: TurnTailCardProps) {
  const onPrompt = useCallback((text: string): void => { submitWidgetPrompt(inputActions, text) }, [inputActions])
  return (
    <div className={css.stack}>
      {matched.map(card => <SettledDoc key={card.callId} argsRaw={card.argsRaw} t={t} onPrompt={onPrompt} />)}
    </div>
  )
}
