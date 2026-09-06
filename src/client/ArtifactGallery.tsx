// The artifact gallery: a conversation.view tab listing every finalized
// export the host currently holds. Every render is already mirrored to disk
// and reachable at a stable share link the moment it settles (see
// export-fanout.ts), but until now the only way to reach one again was to
// still have its link — there was no way to see what had accumulated.
// Registered as its own tab (rather than living inside the chat transcript)
// because the listing is host-global, not scoped to the conversation it
// happened to render in.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ConvViewProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { PropsLocale } from '@deepseek-ai/dsh-client-ui-slots'
import {
  IconCheckOutline16, IconLinkOutline16, IconRefreshOutline16, IconShareOutline16, IconTrashOutline16, IconTriangleRightFill14,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { IconPinFill16, IconPinOutline16 } from './PinIcon.tsx'
import { ArtifactPreview } from './ArtifactPreview.tsx'
import type { ArtifactListEntry } from '../shared/export-name.ts'
import {
  type ArtifactDateFilter, deleteArtifact, fetchArtifactList, formatArtifactSize, formatArtifactTime, matchesDateFilter,
  setArtifactPinned, sortArtifactEntries,
} from './artifact-gallery.ts'
import { ARTIFACT_CHANGED_EVENT, type ArtifactChangedDetail, artifactPageUrlByName } from './share.ts'
import { COPY_FEEDBACK_MS, copyText } from './download.ts'
import css from './ArtifactGallery.module.css'

/** Full props of the registered `conversation.view` tab. */
export type ArtifactGalleryProps = ConvViewProps & PropsLocale<'visualizer'>

type LoadState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; entries: readonly ArtifactListEntry[] }

/** A listed export's kind bucket, for the gallery's kind filter. */
type KindFilter = 'all' | 'html' | 'svg'

/** The gallery's pinned-only filter. */
type PinnedFilter = 'all' | 'pinned'

/** Window a delete's confirm arm stays live before reverting on its own — long enough to notice, short enough that a stale arm never lingers into an unrelated later click. */
const DELETE_CONFIRM_MS = 3_000

/** One listed export's row: title, size, time, its actions, and — when
 * expanded — a live preview inline below the header. */
function ArtifactRow(
  { entry, t, expanded, onToggle, onDeleted, onPinned }: {
    entry: ArtifactListEntry
    t: ArtifactGalleryProps['t']
    expanded: boolean
    onToggle: (name: string) => void
    onDeleted: (name: string) => void
    onPinned: (name: string, pinned: boolean) => void
  },
) {
  const [copied, setCopied] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [pinning, setPinning] = useState(false)
  const confirmTimer = useRef<number | undefined>(undefined)
  const url = artifactPageUrlByName(entry.name)

  useEffect(() => () => { window.clearTimeout(confirmTimer.current) }, [])

  // Single click, no arm/confirm — pinning is reversible and non-destructive,
  // unlike Delete. The row's own displayed state only moves once the host
  // confirms, so a refused toggle leaves it exactly where it was.
  const onPinClick = useCallback((): void => {
    const next = !entry.pinned
    setPinning(true)
    void setArtifactPinned(entry.name, next).then((ok) => {
      setPinning(false)
      if (ok) onPinned(entry.name, next)
    })
  }, [entry.name, entry.pinned, onPinned])

  const onCopy = useCallback((): void => {
    if (url === null) return
    void copyText(url).then((ok) => {
      if (!ok) return
      setCopied(true)
      window.setTimeout(() => { setCopied(false) }, COPY_FEEDBACK_MS)
    })
  }, [url])

  // Two clicks, not a native confirm() dialog: the first arms the control
  // (reverting on its own after a few seconds, or on blur), the second —
  // while still armed — actually deletes. A misclick costs one extra click
  // to undo instead of a destroyed export.
  const onDeleteClick = useCallback((): void => {
    if (!confirming) {
      setConfirming(true)
      confirmTimer.current = window.setTimeout(() => { setConfirming(false) }, DELETE_CONFIRM_MS)
      return
    }
    window.clearTimeout(confirmTimer.current)
    setDeleting(true)
    void deleteArtifact(entry.name).then((ok) => {
      if (ok) { onDeleted(entry.name); return }
      setDeleting(false)
      setConfirming(false)
    })
  }, [confirming, entry.name, onDeleted])

  return (
    <li className={entry.pinned ? css.rowPinned : css.row}>
      <div className={css.rowHeader}>
        <button
          type="button"
          className={expanded ? css.rowTriggerSelected : css.rowTrigger}
          aria-expanded={expanded}
          onClick={() => { onToggle(entry.name) }}
        >
          <span className={expanded ? css.chevronExpanded : css.chevron}>
            <IconTriangleRightFill14 size={12} />
          </span>
          <span className={css.kindBadge}>{entry.kind.toUpperCase()}</span>
          <span className={css.title}>{entry.title}</span>
          <span className={css.meta}>
            {formatArtifactSize(entry.bytes)}
            {' · '}
            {formatArtifactTime(entry.mtimeMs)}
          </span>
        </button>
        <span className={css.actions}>
          <button
            type="button"
            className={entry.pinned ? css.pinToggleActive : css.pinToggle}
            disabled={pinning}
            aria-pressed={entry.pinned}
            onClick={onPinClick}
            aria-label={entry.pinned ? t('gallery.pinned') : t('gallery.pin')}
            title={entry.pinned ? t('gallery.pinned') : t('gallery.pin')}
          >
            {entry.pinned ? <IconPinFill16 size={14} /> : <IconPinOutline16 size={14} />}
          </button>
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
          <button
            type="button"
            className={confirming ? css.actionDanger : css.action}
            disabled={deleting}
            onClick={onDeleteClick}
            onBlur={() => { window.clearTimeout(confirmTimer.current); setConfirming(false) }}
            aria-label={confirming ? t('gallery.deleteConfirm') : t('gallery.delete')}
            title={confirming ? t('gallery.deleteConfirm') : t('gallery.delete')}
          >
            <IconTrashOutline16 size={14} />
          </button>
        </span>
      </div>
      {expanded && url !== null && (
        <div className={css.rowPreview}>
          <ArtifactPreview url={url} kind={entry.kind} label={t('gallery.previewTitle', { title: entry.title })} />
        </div>
      )}
    </li>
  )
}

/** One filter chip: a single-select toggle within its group. */
function FilterChip<V extends string>(
  { value, active, label, onSelect }: { value: V; active: boolean; label: string; onSelect: (value: V) => void },
) {
  return (
    <button
      type="button"
      className={active ? css.chipActive : css.chip}
      aria-pressed={active}
      onClick={() => { onSelect(value) }}
    >
      {label}
    </button>
  )
}

/** The gallery tab body: every finalized export, newest first, searchable, filterable, and refreshable on demand. */
export function ArtifactGallery({ t }: ArtifactGalleryProps) {
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const [query, setQuery] = useState('')
  const [kindFilter, setKindFilter] = useState<KindFilter>('all')
  const [dateFilter, setDateFilter] = useState<ArtifactDateFilter>('all')
  const [pinnedFilter, setPinnedFilter] = useState<PinnedFilter>('all')
  // No row is expanded by default: auto-expanding the first one would fire
  // an extra preview fetch on every mount even when the reader only wants to
  // skim or filter. Tracked by name rather than index, and only one at a
  // time (an accordion, not independent disclosures) — expanding a
  // different row implicitly collapses whichever one was open.
  const [expandedName, setExpandedName] = useState<string | null>(null)
  const onToggle = useCallback((name: string): void => {
    setExpandedName(current => current === name ? null : name)
  }, [])

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

  // A row deleted host-side drops from state immediately rather than waiting
  // for the next load — the delete request already confirmed it is gone.
  const onDeleted = useCallback((name: string): void => {
    setState(current => current.status === 'ready'
      ? { status: 'ready', entries: current.entries.filter(entry => entry.name !== name) }
      : current)
  }, [])

  // A pin toggle patches the entry in place and re-sorts pinned-first rather
  // than refetching — the row should float to (or off) the top immediately.
  const onPinned = useCallback((name: string, pinned: boolean): void => {
    setState(current => current.status === 'ready'
      ? { status: 'ready', entries: sortArtifactEntries(current.entries.map(entry => entry.name === name ? { ...entry, pinned } : entry)) }
      : current)
  }, [])

  // Live cross-surface sync: a card's own Unshare removes a row here without
  // waiting for a manual Refresh (the same event this tab's own Delete also
  // raises, so this handler treats both sources identically). A card's own
  // Export cannot patch a full row locally — a name alone carries no kind,
  // size, or time — so it reloads the listing instead of synthesizing one.
  useEffect(() => {
    const onChanged = (event: Event): void => {
      const detail = (event as CustomEvent<ArtifactChangedDetail>).detail
      if (detail.exported) load()
      else onDeleted(detail.name)
    }
    window.addEventListener(ARTIFACT_CHANGED_EVENT, onChanged)
    return () => { window.removeEventListener(ARTIFACT_CHANGED_EVENT, onChanged) }
  }, [load, onDeleted])

  // Filtered client-side over the already-fetched list rather than a fresh
  // request per keystroke or per chip: a listing is at most a few hundred
  // rows, so a round trip would only add latency the reader can feel.
  const entries = state.status === 'ready' ? state.entries : EMPTY_ENTRIES
  const trimmedQuery = query.trim().toLowerCase()
  const filtered = useMemo(() => entries.filter(entry =>
    (trimmedQuery === '' || entry.title.toLowerCase().includes(trimmedQuery))
    && (kindFilter === 'all' || entry.kind === kindFilter)
    && matchesDateFilter(entry.mtimeMs, dateFilter)
    && (pinnedFilter === 'all' || entry.pinned)), [entries, trimmedQuery, kindFilter, dateFilter, pinnedFilter])
  const filtering = trimmedQuery !== '' || kindFilter !== 'all' || dateFilter !== 'all' || pinnedFilter !== 'all'

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
      {state.status === 'ready' && entries.length > 0 && (
        <>
          <div className={css.searchRow}>
            <input
              type="search"
              className={css.search}
              value={query}
              onChange={(event) => { setQuery(event.target.value) }}
              placeholder={t('gallery.searchPlaceholder')}
              aria-label={t('gallery.searchPlaceholder')}
            />
            <span className={css.count}>
              {filtering ? t('gallery.countFiltered', { shown: filtered.length, total: entries.length }) : t('gallery.countTotal', { total: entries.length })}
            </span>
          </div>
          <div className={css.filterRow}>
            <div className={css.chipGroup} role="group" aria-label={t('gallery.filterKindGroup')}>
              <FilterChip value="all" active={kindFilter === 'all'} label={t('gallery.filterAll')} onSelect={setKindFilter} />
              <FilterChip value="html" active={kindFilter === 'html'} label="HTML" onSelect={setKindFilter} />
              <FilterChip value="svg" active={kindFilter === 'svg'} label="SVG" onSelect={setKindFilter} />
            </div>
            <div className={css.chipGroup} role="group" aria-label={t('gallery.filterDateGroup')}>
              <FilterChip value="all" active={dateFilter === 'all'} label={t('gallery.filterAll')} onSelect={setDateFilter} />
              <FilterChip value="today" active={dateFilter === 'today'} label={t('gallery.filterToday')} onSelect={setDateFilter} />
              <FilterChip value="week" active={dateFilter === 'week'} label={t('gallery.filterWeek')} onSelect={setDateFilter} />
            </div>
            <div className={css.chipGroup} role="group" aria-label={t('gallery.filterPinnedGroup')}>
              <FilterChip value="all" active={pinnedFilter === 'all'} label={t('gallery.filterAll')} onSelect={setPinnedFilter} />
              <FilterChip value="pinned" active={pinnedFilter === 'pinned'} label={t('gallery.filterPinnedOnly')} onSelect={setPinnedFilter} />
            </div>
          </div>
        </>
      )}
      {state.status === 'loading' && <p className={css.status}>{t('gallery.loading')}</p>}
      {state.status === 'error' && <p className={css.status}>{t('gallery.error')}</p>}
      {state.status === 'ready' && entries.length === 0 && (
        <p className={css.status}>{t('gallery.empty')}</p>
      )}
      {state.status === 'ready' && entries.length > 0 && filtered.length === 0 && (
        <p className={css.status}>{t('gallery.noMatches')}</p>
      )}
      {filtered.length > 0 && (
        <ul className={css.list}>
          {filtered.map(entry => (
            <ArtifactRow
              key={entry.name}
              entry={entry}
              t={t}
              expanded={entry.name === expandedName}
              onToggle={onToggle}
              onDeleted={onDeleted}
              onPinned={onPinned}
            />
          ))}
        </ul>
      )}
    </div>
  )
}

/** Stable empty array so the `useMemo` dependency never churns while loading or on error. */
const EMPTY_ENTRIES: readonly ArtifactListEntry[] = []
