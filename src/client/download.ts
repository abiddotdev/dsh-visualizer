/**
 * Client-side document export: the complete bytes the call carried are
 * already in memory, so saving needs only a Blob and an object URL — no
 * filesystem round-trip, and it works identically on replay.
 * @module dsh-visualizer/download
 */

/**
 * Delay before the object URL is released. The browser starts the download
 * only after `click()` returns, so revoking in the same task can yield an
 * empty file; the URL needs to outlive the handoff, not the whole fetch.
 */
export const REVOKE_DELAY_MS = 4_000

/** Prefix length examined to tell a bare SVG document from an HTML one. */
const MODE_SNIFF_CHARS = 80

/** How long the copy control shows its confirmation before reverting. */
export const COPY_FEEDBACK_MS = 1_600

/**
 * Whether the document is a bare SVG rather than HTML: it opens with `<svg`
 * before any HTML framing appears. The guide teaches raw SVG as the
 * diagram/mockup carriage, so both kinds reach the download control.
 * @param html - the complete document.
 * @returns true when the bytes should be saved as `.svg`.
 */
function isSvgDocument(html: string): boolean {
  return html.trimStart().slice(0, MODE_SNIFF_CHARS).toLowerCase().startsWith('<svg')
}

/**
 * Save one document as a standalone file: `.svg` for a bare SVG document,
 * `.html` otherwise.
 * @param title - card title; sanitized into the download file name.
 * @param html - the complete document.
 */
export function downloadDocument(title: string, html: string): void {
  const svg = isSvgDocument(html)
  const safe = title.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim() || 'render'
  const blob = new Blob([html], { type: svg ? 'image/svg+xml' : 'text/html;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = `${safe}.${svg ? 'svg' : 'html'}`
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
