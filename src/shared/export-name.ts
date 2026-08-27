/**
 * Plane-neutral derivation of an export's file name and route path. Both
 * halves of the package need the identical mapping — the host half names the
 * file it fans out to disk, the browser half names the URL its share control
 * opens — so the algorithm lives once here and each bundle inlines it. The
 * node half may import this module (it is pure), but nothing here may import
 * either plane.
 * @module dsh-visualizer/shared/export-name
 */

/** Suburl the exports route owns on the harness web server. */
export const EXPORTS_ROUTE_PATH = '/visualizer'

/**
 * `globalThis` property the host sets through the web server's index-inject
 * table while the exports feature is active — carrying the boot capability
 * token the share control appends to export URLs. Absent means the deployment
 * disabled the feature (`exports: false`), and the card hides the share button
 * instead of opening a dead URL.
 */
export const EXPORTS_BOOT_GLOBAL = '__DSH_VISUALIZER_EXPORTS__'

/**
 * Suffix of the streaming sidecar. The document's extension (html vs svg) is
 * only stable once the document is complete, so while it streams the growing
 * prefix parks under this fixed suffix, which the serve route never hands out.
 */
export const PARTIAL_SUFFIX = '.partial'

/** File-name extensions an export may finalize as, by document kind. */
const HTML_EXTENSION = '.html'
const SVG_EXTENSION = '.svg'

/** Most characters a friendly base name keeps; the digest appends past it. */
export const MAX_EXPORT_BASE_CHARS = 100

/** Prefix length examined to tell a bare SVG document from an HTML one. */
const MODE_SNIFF_CHARS = 80

/** Fallback base when a title is absent or sanitizes away to nothing. */
const FALLBACK_BASE = 'render'

/**
 * Whether the document is a bare SVG rather than HTML: it opens with `<svg`
 * before any HTML framing appears. The guide teaches raw SVG as the
 * diagram/mockup carriage, so both kinds reach the export path.
 * @param html - the document (complete, or a growing prefix while streaming).
 * @returns true when the finalized bytes should carry the `.svg` extension.
 */
export function isSvgDocument(html: string): boolean {
  return html.trimStart().slice(0, MODE_SNIFF_CHARS).toLowerCase().startsWith('<svg')
}

/**
 * Sanitize one title into an export base name: strip path separators and other
 * unfriendly characters, trim, cap, and fall back. No path separator survives,
 * and no form of dot stays, so the result is always one safe path segment.
 * @param title - the call's explicit `title` argument, or null when absent.
 * @returns the base name shared by the partial sidecar and the final file.
 */
export function exportFileBase(title: string | null): string {
  const sanitized = (title ?? '')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .trim()
    .slice(0, MAX_EXPORT_BASE_CHARS)
    .trim()
  return sanitized.length > 0 && sanitized !== '.' && sanitized !== '..' ? sanitized : FALLBACK_BASE
}

/**
 * The finalized export's file name for local saves: the sanitized title plus
 * the kind extension, no digest. A download's name stays human-shaped.
 * @param title - the call's explicit `title` argument, or null when absent.
 * @param html - the complete document.
 * @returns `<base>.svg` for a bare SVG document, `<base>.html` otherwise.
 */
export function exportFileName(title: string | null, html: string): string {
  return exportFileBase(title) + (isSvgDocument(html) ? SVG_EXTENSION : HTML_EXTENSION)
}

/**
 * One 64-bit FNV-1a digest over the document identity, hex-encoded. Pure
 * JavaScript rather than SubtleCrypto: the derivation must stay synchronous
 * and identical in both bundles, and node has no monopoly on TextEncoder.
 * Sixteen hex digits give a collision birthday far beyond any deployment's
 * render count; the point is uniqueness, not secrecy — anyone holding the
 * page can recompute it.
 * @param identity - the string to digest: the base name and the complete
 *   document, separated so neither alone collides across pairs.
 * @returns sixteen lowercase hex characters.
 */
function digestHex(identity: string): string {
  let hash = 0xcbf29ce484222325n
  const prime = 0x100000001b3n
  for (const byte of new TextEncoder().encode(identity)) {
    hash ^= BigInt(byte)
    hash = (hash * prime) & 0xffffffffffffffffn
  }
  return hash.toString(16).padStart(16, '0')
}

/**
 * The finalized export's served/sidecar name: the friendly base plus a
 * content digest, so one title under different bytes never clobbers an
 * earlier export, and one exact render always shares one stable URL no
 * matter how often it re-renders. Both planes derive this from the same
 * `(title, html)` pair they each hold, so host and card cannot disagree.
 * @param title - the call's explicit `title` argument, or null when absent.
 * @param html - the complete document.
 * @returns `<base>-<16 hex digits>.svg|.html`.
 */
export function exportShareName(title: string | null, html: string): string {
  const base = exportFileBase(title)
  return `${base}-${digestHex(`${base}\u0000${html}`)}${isSvgDocument(html) ? SVG_EXTENSION : HTML_EXTENSION}`
}

/**
 * The streaming sidecar's file name for one base.
 * @param base - the base name {@link exportFileBase} produced.
 * @returns `<base>.partial`.
 */
export function partialFileName(base: string): string {
  return base + PARTIAL_SUFFIX
}

/**
 * Validate one request path segment as a finalized export name. The serve
 * route answers `<route>/<name>`; everything else (nested paths, dot-dot,
 * partial sidecars, unknown extensions) is a 404, never a directory read.
 * One safe segment before one known extension is the whole contract — what
 * bases may look like is the derivation's business, and serving is anyway a
 * lookup of files this plugin's finalize wrote.
 * @param name - the decoded single segment after the route prefix.
 * @returns true when the name may be served.
 */
export function isServableExportName(name: string): boolean {
  if (!/^[^\u0000-\u001f/\\]+(?:\.html|\.svg)$/.test(name)) return false
  const extension = name.endsWith(SVG_EXTENSION) ? SVG_EXTENSION.length : HTML_EXTENSION.length
  const base = name.slice(0, -extension)
  return base.length > 0 && base !== '.' && base !== '..'
}
