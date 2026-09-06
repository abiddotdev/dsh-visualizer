/**
 * The card's share-adjacent actions: create an export on demand, then open
 * or copy the link to it. The host writes nothing until `exportCall` asks —
 * see `export-fanout.ts`'s write path — so every URL here is addressed by
 * the exact name the write confirmed, never recomputed client-side from
 * `(title, html)` ahead of that confirmation. Where the deployment disabled
 * the feature, the boot-table announcement is absent and the cards never
 * offer the controls at all.
 * @module dsh-visualizer/share
 */

import { EXPORTS_BOOT_GLOBAL, EXPORTS_ROUTE_PATH } from '../shared/export-name.ts'
import { copyText } from './download.ts'

/**
 * Fired on `window` whenever an export is created or removed, by whichever
 * surface asked for it — a card's own `ensure()`/`unshare()`, or the
 * gallery's Delete. Every surface that keeps its own local copy of a name's
 * share state (a card's `useExportControl`, the gallery's listing) reconciles
 * off this instead of only finding out at its own next mount: without it,
 * unsharing a file from the gallery would leave a still-open card showing
 * Share/Copy-link/Unshare for a file that already 404s until the page
 * reloads, and the reverse (exporting elsewhere) would leave a stale gallery
 * row missing until a manual Refresh.
 */
export const ARTIFACT_CHANGED_EVENT = 'dsh-artifact-changed'

/** Payload of {@link ARTIFACT_CHANGED_EVENT}. */
export interface ArtifactChangedDetail {
  /** The export's served name — the same identity every surface already keys off. */
  readonly name: string
  /** `true` once created; `false` once removed. */
  readonly exported: boolean
}

/**
 * Tell every other surface holding this name that its share state just
 * changed. Broadcast rather than transported: nothing here carries who
 * changed it or why, only the fact and the name, which is all a listener
 * needs to reconcile its own local copy.
 * @param name - the export's served name.
 * @param exported - its state after the change.
 */
export function broadcastArtifactChanged(name: string, exported: boolean): void {
  window.dispatchEvent(new CustomEvent<ArtifactChangedDetail>(ARTIFACT_CHANGED_EVENT, { detail: { name, exported } }))
}

/**
 * Whether the host's export route is live: the served page carries a
 * `globalThis` announcement the route pushes onto the boot table, so a
 * deployment that disabled the feature (`shareArtifacts: false`) never sets
 * it and the cards hide the share controls instead of offering a dead one.
 * @returns true only where the route behind the share controls exists.
 */
export function exportShareEnabled(): boolean {
  return typeof (globalThis as unknown as Record<string, unknown>)[EXPORTS_BOOT_GLOBAL] === 'string'
}

/**
 * The boot capability token the host announced, or null where it did not —
 * every request carries it as `?k=`, and the route refuses requests without
 * it. Holding the token is what makes a link work; a name alone serves
 * nothing, so links stop being enumerable.
 * @returns the announced token, or null outside the harness web UI.
 */
function capabilityToken(): string | null {
  const value = (globalThis as unknown as Record<string, unknown>)[EXPORTS_BOOT_GLOBAL]
  return typeof value === 'string' && value.length > 0 ? value : null
}

/**
 * The route's own root — the artifact gallery's listing (`GET`) and the
 * export-on-demand write (`POST`) both address this same URL.
 * @returns the URL, or null where there is nothing to share — the feature is
 * disabled, or the card does not run inside the harness web UI (a non-http(s)
 * origin can only be an embedder, e.g. a file:// shell, that serves no
 * routes).
 */
export function artifactListUrl(): string | null {
  const token = capabilityToken()
  if (token === null) return null
  if (!/^https?:$/.test(window.location.protocol)) return null
  return `${window.location.origin}${EXPORTS_ROUTE_PATH}/?k=${encodeURIComponent(token)}`
}

/**
 * One export's page URL, addressed by its exact served name — returned
 * either by {@link exportCall} once the write confirms, or by the gallery's
 * listing endpoint.
 * @param name - a confirmed export name.
 * @returns the URL, or null under the same conditions as {@link artifactListUrl}.
 */
export function artifactPageUrlByName(name: string): string | null {
  const token = capabilityToken()
  if (token === null) return null
  if (!/^https?:$/.test(window.location.protocol)) return null
  return `${window.location.origin}${EXPORTS_ROUTE_PATH}/${encodeURIComponent(name)}?k=${encodeURIComponent(token)}`
}

/**
 * Ask the host to create (or re-create) the export for one settled
 * `visualizer` call — the write behind the card's Export control. Nothing
 * here sends the document's bytes: the host reads them straight from
 * whichever live session's durable log logged the call, naming only which
 * call to mirror. The write is idempotent, so calling this twice for the
 * same call is a cheap no-op the second time, not a duplicate.
 * @param callId - the call to export.
 * @returns the finalized export's name, or null where sharing is
 * unavailable, the call could not be resolved, or the host refused the
 * request (rate limit, malformed response).
 */
export async function exportCall(callId: string): Promise<string | null> {
  const url = artifactListUrl()
  if (url === null) return null
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ callId }),
    })
    if (!response.ok) return null
    const data: unknown = await response.json()
    const name = typeof data === 'object' && data !== null ? (data as Record<string, unknown>).name : null
    if (typeof name !== 'string' || name.length === 0) return null
    broadcastArtifactChanged(name, true)
    return name
  } catch {
    return null
  }
}

/**
 * Open one already-exported artifact's page in a new tab, through the same
 * no-opener gate widget links use. Safe to call synchronously inside a
 * click handler: the caller only reaches this once `exportCall` (or the
 * gallery listing) already confirmed the name exists.
 * @param name - a confirmed export name.
 * @returns whether a page opened; false when the origin serves no routes.
 */
export function openArtifactPage(name: string): boolean {
  const url = artifactPageUrlByName(name)
  if (url === null) {
    // A no-op click is a debugging dead end; say why nothing opened.
    console.info('visualizer: share is unavailable outside the harness web UI')
    return false
  }
  window.open(url, '_blank', 'noopener,noreferrer')
  return true
}

/**
 * Copy one already-exported artifact's page address to the clipboard.
 * @param name - a confirmed export name.
 * @returns whether the address reached the clipboard; false where there is
 * no URL to build or the clipboard refused, so the caller confirms nothing.
 */
export async function copyArtifactLink(name: string): Promise<boolean> {
  const url = artifactPageUrlByName(name)
  if (url === null) {
    console.info('visualizer: share is unavailable outside the harness web UI')
    return false
  }
  return copyText(url)
}
