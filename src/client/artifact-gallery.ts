/**
 * Data and formatting for the artifact gallery tab: fetches the host's
 * listing endpoint and validates the response, since it crosses the network
 * boundary like every other host-to-card channel in this plugin — the
 * response is JSON over HTTP, not a typed call, so every field is re-checked
 * rather than trusted.
 * @module dsh-visualizer/artifact-gallery
 */

import type { ArtifactListEntry } from '../shared/export-name.ts'
import { artifactListUrl } from './share.ts'

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
