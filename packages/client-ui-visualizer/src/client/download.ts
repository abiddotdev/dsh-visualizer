/**
 * Client-side document download: the complete bytes the call carried are
 * already in memory, so saving needs only a Blob and an object URL — no
 * filesystem round-trip, and it works identically on replay.
 */

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
  URL.revokeObjectURL(url)
}
