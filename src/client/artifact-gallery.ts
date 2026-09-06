/**
 * Data and formatting for the artifact gallery tab: fetches the host's
 * listing endpoint and validates the response, since it crosses the network
 * boundary like every other host-to-card channel in this plugin — the
 * response is JSON over HTTP, not a typed call, so every field is re-checked
 * rather than trusted.
 * @module dsh-visualizer/artifact-gallery
 */

import type { ArtifactListEntry } from '../shared/export-name.ts'
import { artifactListUrl, artifactPageUrlByName, broadcastArtifactChanged } from './share.ts'

/** Validate one listing entry from the wire. */
function isEntry(value: unknown): value is ArtifactListEntry {
  if (typeof value !== 'object' || value === null) return false
  const { name, title, kind, bytes, mtimeMs } = value as Record<string, unknown>
  return typeof name === 'string' && name.length > 0
    && typeof title === 'string' && title.length > 0
    && (kind === 'html' || kind === 'svg')
    && typeof bytes === 'number' && Number.isFinite(bytes)
    && typeof mtimeMs === 'number' && Number.isFinite(mtimeMs)
}

/**
 * Fetch the current artifact listing.
 * @returns entries in the order the host sent them (most recent first); an
 * empty list where sharing is disabled or the card runs outside the harness
 * web UI — the same "nothing to show" the share control's own URL derivation
 * resolves to.
 * @throws when the request reaches the host but the answer is refused or
 * malformed, so the caller can tell "nothing shared yet" apart from
 * "something is wrong".
 */
export async function fetchArtifactList(): Promise<ArtifactListEntry[]> {
  const url = artifactListUrl()
  if (url === null) return []
  const response = await fetch(url, { cache: 'no-store' })
  if (!response.ok) throw new Error(`gallery listing request failed (${response.status})`)
  const data: unknown = await response.json()
  const entries = typeof data === 'object' && data !== null ? (data as Record<string, unknown>).entries : null
  if (!Array.isArray(entries)) throw new Error('gallery listing response was malformed')
  return entries.filter(isEntry)
}

/**
 * Delete one listed export from the host's disk — the same per-name URL the
 * Open/Copy link actions address, over DELETE instead of GET.
 * @param name - a name the listing endpoint returned.
 * @returns whether the host removed it; false where sharing is unavailable,
 * the request was refused, or the network call itself failed, so the caller
 * leaves the row in place rather than assuming success it never confirmed.
 */
export async function deleteArtifact(name: string): Promise<boolean> {
  const url = artifactPageUrlByName(name)
  if (url === null) return false
  try {
    const response = await fetch(url, { method: 'DELETE' })
    if (!response.ok) return false
    broadcastArtifactChanged(name, false)
    return true
  } catch {
    return false
  }
}

/**
 * In-flight listing request, shared by every concurrent caller rather than
 * one each. Every settled card mounted at once (a page reload, a switch into
 * a long transcript) reconciles its own export status against this same
 * listing (see `export-control.ts`) — without sharing the request, each
 * would fire its own; a transcript with fifty finalized cards would open
 * fifty requests where the gallery tab already proves one listing serves
 * them all. Cleared once resolved so a later, unrelated batch always sees
 * fresh state rather than a growing cache's staleness.
 */
let listingInFlight: Promise<readonly ArtifactListEntry[]> | null = null

/**
 * {@link fetchArtifactList}, deduped across whichever callers ask for it
 * inside the same round trip.
 * @returns the same settled result every concurrent caller awaits; never
 * throws — a failed listing resolves to an empty list, since callers here
 * use it only to answer "does this name already exist," not to render a
 * list a user is watching load (the gallery tab calls {@link fetchArtifactList}
 * directly for that, where a distinct error state matters).
 */
export function fetchArtifactListOnce(): Promise<readonly ArtifactListEntry[]> {
  if (listingInFlight === null) {
    listingInFlight = fetchArtifactList()
      .catch(() => [])
      .finally(() => { listingInFlight = null })
  }
  return listingInFlight
}

/** A listed export's age bucket, coarsest last, for the gallery's date filter. */
export type ArtifactDateFilter = 'all' | 'today' | 'week'

/** One day, in milliseconds — the unit both age buckets below are measured in. */
const DAY_MS = 86_400_000

/**
 * Whether one export's modification time falls inside the given age bucket.
 * Pure and clock-injected so the boundary (midnight, seven days back) is
 * testable without mocking global time.
 * @param mtimeMs - the export's modification time.
 * @param filter - the selected bucket.
 * @param now - the current time; defaults to the real clock.
 * @returns true when the export belongs in the bucket.
 */
export function matchesDateFilter(mtimeMs: number, filter: ArtifactDateFilter, now: number = Date.now()): boolean {
  if (filter === 'all') return true
  if (filter === 'today') return isSameCalendarDay(mtimeMs, now)
  return now - mtimeMs <= 7 * DAY_MS
}

/** Whether two timestamps fall on the same local calendar day. */
function isSameCalendarDay(a: number, b: number): boolean {
  const da = new Date(a)
  const db = new Date(b)
  return da.getFullYear() === db.getFullYear() && da.getMonth() === db.getMonth() && da.getDate() === db.getDate()
}

/** Binary size units the gallery displays; a single render stays well under a megabyte. */
const SIZE_UNITS = ['B', 'KB', 'MB'] as const

/**
 * Format a byte count for the gallery row: whole bytes below 1 KB, one
 * decimal place at or above it. Units are technical abbreviations, not
 * prose, so they stay unlocalized like every other size shown by the host.
 * @param bytes - the export's file size.
 * @returns e.g. `842 B`, `12.3 KB`.
 */
export function formatArtifactSize(bytes: number): string {
  let value = bytes
  let unitIndex = 0
  while (value >= 1024 && unitIndex < SIZE_UNITS.length - 1) {
    value /= 1024
    unitIndex++
  }
  const rounded = unitIndex === 0 ? String(Math.round(value)) : value.toFixed(1)
  return `${rounded} ${SIZE_UNITS[unitIndex]}`
}

/**
 * Format one export's modification time for the gallery row, in the reader's
 * own locale and time zone through Intl — a timestamp is not prose, so it
 * does not ride this plugin's zh/en dictionaries.
 * @param mtimeMs - Unix epoch ms.
 * @returns a medium date, short time string.
 */
export function formatArtifactTime(mtimeMs: number): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(mtimeMs))
}
