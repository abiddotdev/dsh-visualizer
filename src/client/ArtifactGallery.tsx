// The artifact gallery: a conversation.view tab listing every finalized
// export the host currently holds. Every render is already mirrored to disk
// and reachable at a stable share link the moment it settles (see
// export-fanout.ts), but until now the only way to reach one again was to
// still have its link — there was no way to see what had accumulated.
// Registered as its own tab (rather than living inside the chat transcript)
// because the listing is host-global, not scoped to the conversation it
// happened to render in.

import { useCallback, useEffect, useState } from 'react'
import type { ConvViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import { IconCheckOutline16, IconLinkOutline16, IconRefreshOutline16, IconShareOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ArtifactListEntry } from '../shared/export-name.ts'
import { fetchArtifactList, formatArtifactSize, formatArtifactTime } from './artifact-gallery.ts'
import { artifactPageUrlByName } from './share.ts'
import { COPY_FEEDBACK_MS, copyText } from './download.ts'
import css from './ArtifactGallery.module.css'

/** Full props of the registered `conversation.view` tab. */
export type ArtifactGalleryProps = ConvViewProps & PropsLocale<'visualizer'>

type LoadState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; entries: readonly ArtifactListEntry[] }

/** One listed export's row: title, size, time, and its two link actions. */
function ArtifactRow({ entry, t }: { entry: ArtifactListEntry; t: ArtifactGalleryProps['t'] }) {
  const [copied, setCopied] = useState(false)
  const url = artifactPageUrlByName(entry.name)
  const onCopy = useCallback((): void => {
    if (url === null) return
    void copyText(url).then((ok) => {
      if (!ok) return
      setCopied(true)
      window.setTimeout(() => { setCopied(false) }, COPY_FEEDBACK_MS)
    })
  }, [url])

  return (
    <li className={css.row}>
      <span className={css.kindBadge}>{entry.kind.toUpperCase()}</span>
      <span className={css.title}>{entry.title}</span>
      <span className={css.meta}>
        {formatArtifactSize(entry.bytes)}
        {' · '}
        {formatArtifactTime(entry.mtimeMs)}
      </span>
      <span className={css.actions}>
        <a
          className={css.action}
          href={url ?? undefined}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={t('gallery.open')}
          title={t('gallery.open')}
        >
          <IconShareOutline16 size={14} />
        </a>
        <button
          type="button"
          className={css.action}
          onClick={onCopy}
          aria-label={copied ? t('gallery.copied') : t('gallery.copyLink')}
          title={copied ? t('gallery.copied') : t('gallery.copyLink')}
        >
          {copied ? <IconCheckOutline16 size={14} /> : <IconLinkOutline16 size={14} />}
        </button>
      </span>
    </li>
  )
}

/** The gallery tab body: every finalized export, newest first, refreshable on demand. */
export function ArtifactGallery({ t }: ArtifactGalleryProps) {
  const [state, setState] = useState<LoadState>({ status: 'loading' })

  const load = useCallback((): void => {
    setState({ status: 'loading' })
    fetchArtifactList()
      .then((entries) => { setState({ status: 'ready', entries }) })
      .catch(() => { setState({ status: 'error' }) })
  }, [])

  // No push channel tells this tab a new render just settled elsewhere in
  // the conversation, so the list is a snapshot as of the last load or
  // manual refresh — one fetch on mount, same as opening any other tab.
  useEffect(() => { load() }, [load])

  return (
    <div className={css.gallery}>
      <div className={css.header}>
        <h2 className={css.heading}>{t('gallery.title')}</h2>
        <button
          type="button"
          className={css.refresh}
          onClick={load}
          aria-label={t('gallery.refresh')}
          title={t('gallery.refresh')}
        >
          <IconRefreshOutline16 size={14} />
        </button>
      </div>
      {state.status === 'loading' && <p className={css.status}>{t('gallery.loading')}</p>}
      {state.status === 'error' && <p className={css.status}>{t('gallery.error')}</p>}
      {state.status === 'ready' && state.entries.length === 0 && (
        <p className={css.status}>{t('gallery.empty')}</p>
      )}
      {state.status === 'ready' && state.entries.length > 0 && (
        <ul className={css.list}>
          {state.entries.map(entry => <ArtifactRow key={entry.name} entry={entry} t={t} />)}
        </ul>
      )}
    </div>
  )
}
