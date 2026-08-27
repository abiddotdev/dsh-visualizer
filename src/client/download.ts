/**
 * Client-side document export: the complete bytes the call carried are
 * already in memory, so saving needs only a Blob and an object URL — no
 * filesystem round-trip, and it works identically on replay.
 * @module dsh-visualizer/download
 */

import { exportFileName } from '../shared/export-name.ts'

/**
 * Delay before the object URL is released. The browser starts the download
 * only after `click()` returns, so revoking in the same task can yield an
 * empty file; the URL needs to outlive the handoff, not the whole fetch.
 */
export const REVOKE_DELAY_MS = 4_000

/** How long the copy control shows its confirmation before reverting. */
export const COPY_FEEDBACK_MS = 1_600

/**
 * Save one document as a standalone file: `.svg` for a bare SVG document,
 * `.html` otherwise. The name is the same one the host's export fanout and
 * the share control derive, so a download, a shared page, and the file on
 * disk all carry one name.
 * @param title - card title; sanitized into the download file name.
 * @param html - the complete document.
 */
export function downloadDocument(title: string, html: string): void {
  const name = exportFileName(title, html)
  const svg = name.endsWith('.svg')
  const blob = new Blob([html], { type: svg ? 'image/svg+xml' : 'text/html;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = name
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => { URL.revokeObjectURL(url) }, REVOKE_DELAY_MS)
}

/**
 * Copy one document's bytes to the clipboard.
 * @param html - the complete document.
 * @returns whether the write succeeded; resolves false when the clipboard
 * API is absent (non-secure context, embedder) or the write is denied, so
 * callers show no confirmation either way.
 */
export async function copyDocument(html: string): Promise<boolean> {
  const clipboard = navigator.clipboard
  if (clipboard === undefined || clipboard === null) return false
  try {
    await clipboard.writeText(html)
    return true
  } catch {
    // A denied or failed write is the only reachable failure; the caller
    // learns of it through the false resolve, never a thrown promise.
    return false
  }
}
