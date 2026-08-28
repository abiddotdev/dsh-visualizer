/**
 * Comment rows under a settled visualizer frame. The card owns the pick
 * list; this component renders one row per pick (kind chip, tag, element
 * text, note input, remove) plus the footer Send / Clear controls, and
 * rides the host's own DOM — inputs and buttons live outside the sandboxed
 * frame, so typing never crosses the bridge and keyboard access is native.
 *
 * @module dsh-visualizer/CommentBar
 */

import type { ChangeEvent } from 'react'
import { IconSendOutline16, IconTrashOutline16, IconCloseFill14 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { ANNOTATION_COMMENT_MAX_CHARS, type AnnotationPick } from './annotate.ts'
import css from './Card.module.css'

type Translate = PropsLocale<'visualizer'>['t']

/** Props of the comment rows below one visualizer frame. */
export interface CommentBarProps {
  /** The card's picks, in pick order; the note is part of each pick. */
  readonly picks: readonly AnnotationPick[]
  /** Set one pick's note. */
  readonly onComment: (id: string, comment: string) => void
  /** Drop one pick. */
  readonly onRemove: (id: string) => void
  /** Send every pick as one widget prompt; the card clears on success. */
  readonly onSend: () => void
  /** Drop every pick at once. */
  readonly onClear: () => void
  /** Locale seat over this package's dictionary. */
  readonly t: Translate
}

/** One pick's row: kind chip, tag, element text, note input, remove. */
function PickRow({ pick, onComment, onRemove, t }: {
  pick: AnnotationPick
  onComment: (id: string, comment: string) => void
  onRemove: (id: string) => void
  t: Translate
}) {
  const onInput = (event: ChangeEvent<HTMLInputElement>): void => {
    onComment(pick.id, event.target.value.slice(0, ANNOTATION_COMMENT_MAX_CHARS))
  }
  return (
    <div className={css.commentRow}>
      <span className={css.commentKind}>{pick.kind === 'area' ? t('row.commentArea') : t('row.commentElement')}</span>
      <span className={css.commentTag}>&lt;{pick.tag}&gt;</span>
      {pick.text.length > 0 && <span className={css.commentText} title={pick.text}>{pick.text}</span>}
      <input
        className={css.commentInput}
        type="text"
        value={pick.comment}
        placeholder={t('row.commentPlaceholder')}
        aria-label={t('row.commentInputLabel')}
        onChange={onInput}
        // Rows are keyed by pick id, so only a newly added row mounts and
        // takes focus; typing flows straight after a pick, no click needed.
        autoFocus
      />
      <button
        type="button"
        className={css.commentRemove}
        aria-label={t('row.commentRemove')}
        title={t('row.commentRemove')}
        onClick={() => { onRemove(pick.id) }}
      >
        <IconCloseFill14 size={12} />
      </button>
    </div>
  )
}

/**
 * The comment strip below a settled frame: one row per pick, then Send and
 * Clear. Renders only while at least one pick exists; the mode toggle in
 * the row chrome explains how picks are made.
 */
export function CommentBar({ picks, onComment, onRemove, onSend, onClear, t }: CommentBarProps) {
  if (picks.length === 0) return null
  return (
    <div className={css.commentBar} data-testid="comment-bar">
      {picks.map(pick => (
        <PickRow key={pick.id} pick={pick} onComment={onComment} onRemove={onRemove} t={t} />
      ))}
      <div className={css.commentFooter}>
        <button type="button" className={css.commentSend} onClick={onSend}>
          <IconSendOutline16 size={14} />
          {t('row.commentSend')}
        </button>
        <button type="button" className={css.commentClear} onClick={onClear}>
          <IconTrashOutline16 size={14} />
          {t('row.commentClear')}
        </button>
      </div>
    </div>
  )
}
