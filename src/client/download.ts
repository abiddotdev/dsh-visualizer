/**
 * Client-side document download: the complete bytes the call carried are
 * already in memory, so saving needs only a Blob and an object URL — no
 * filesystem round-trip, and it works identically on replay.
 */

/**
 * Delay before the object URL is released. The browser starts the download
 * only after `click()` returns, so revoking in the same task can yield an
 * empty file; the URL needs to outlive the handoff, not the whole fetch.
 */
export const REVOKE_DELAY_MS = 4_000

/**
 * Save one document as a standalone HTML file.
 * @param title - card title; sanitized into the download file name.
 * @param html - the complete document.
 */
export function downloadDocument(title: string, html: string): void {
  const safe = title.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim() || 'render'
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `${safe}.html`
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => { URL.revokeObjectURL(url) }, REVOKE_DELAY_MS)
}
