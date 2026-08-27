/**
 * The share control's action: open one document's served export page. The
 * host's export fanout mirrors the streamed document into the exports
 * directory under a content-digested name ({@link exportShareName}) and the
 * web server hands it back at the suburl built here — the URL derives from
 * the same `(title, html)` pair the card holds, so it always matches a page
 * the server can produce. One exact render maps to one stable shareable URL;
 * changed content lands beside it under a fresh name rather than clobbering.
 * Where the deployment disabled the feature, the boot-table announcement is
 * absent and the cards never offer the control at all.
 * @module dsh-visualizer/share
 */

import { EXPORTS_BOOT_GLOBAL, EXPORTS_ROUTE_PATH, exportShareName } from '../shared/export-name.ts'

/**
 * Whether the host's export fanout is live: the served page carries a
 * `globalThis` announcement the fanout pushes onto the boot table, so a
 * deployment that disabled the feature (`exports: false`) never sets it and
 * the cards hide the share control instead of opening a dead URL.
 * @returns true only where the route behind the share control exists.
 */
export function exportShareEnabled(): boolean {
  return (globalThis as unknown as Record<string, unknown>)[EXPORTS_BOOT_GLOBAL] === true
}

/**
 * The absolute URL of one document's export page.
 * @param title - the call's explicit `title` argument, or null when absent.
 * @param html - the complete document whose export page to open.
 * @returns the URL, or null where there is nothing to share — the feature is
 * disabled, or the card does not run inside the harness web UI (a non-http(s)
 * origin can only be an embedder, e.g. a file:// shell, that serves no
 * routes).
 */
export function exportPageUrl(title: string | null, html: string): string | null {
  if (!exportShareEnabled()) return null
  if (!/^https?:$/.test(window.location.protocol)) return null
  const name = exportShareName(title, html)
  return `${window.location.origin}${EXPORTS_ROUTE_PATH}/${encodeURIComponent(name)}`
}

/**
 * Open one document's export page in a new tab, through the same no-opener
 * gate widget links use.
 * @param title - the call's explicit `title` argument, or null when absent.
 * @param html - the complete document whose export page to open.
 * @returns whether a page opened; false when the origin serves no routes.
 */
export function openExportPage(title: string | null, html: string): boolean {
  const url = exportPageUrl(title, html)
  if (url === null) return false
  window.open(url, '_blank', 'noopener,noreferrer')
  return true
}
