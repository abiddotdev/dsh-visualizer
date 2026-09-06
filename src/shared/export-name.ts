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
export const EXPORTS_ROUTE_PATH = '/artifacts/visualizer'

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

/** Most characters a slug keeps before the digest appends past it. */
export const MAX_EXPORT_BASE_CHARS = 60

/** Prefix length examined to tell a bare SVG document from an HTML one. */
const MODE_SNIFF_CHARS = 80

/** Fallback slug when a title is absent or slugs away to nothing. */
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
 * Slug one title into an ASCII kebab-case base: lowercase, hyphen-separated,
 * letters and digits only, capped and trimmed of edge hyphens. Unicode stays
 * out of file names and URLs entirely — the title's full form lives in the
 * card's display text, not in the artifact name; the digest that follows the
 * slug keeps distinct originals from aliasing even where their slugs collapse
 * to the same shape (or to nothing at all, where the fallback takes over).
 * @param title - the call's explicit `title` argument, or null when absent.
 * @returns the kebab-case base name for files, sidecars, and share URLs.
 */
export function exportFileBase(title: string | null): string {
  const slug = (title ?? '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, MAX_EXPORT_BASE_CHARS)
    .replace(/-+$/g, '')
  return slug.length > 0 ? slug : FALLBACK_BASE
}

/**
 * The finalized export's file name for local saves: the kebab-case slug plus
 * the kind extension, no digest. A download's name stays short and ASCII —
 * display of the title's full form is the card's business, never the name.
 * @param title - the call's explicit `title` argument, or null when absent.
 * @param html - the complete document.
 * @returns `<slug>.svg` for a bare SVG document, `<slug>.html` otherwise.
 */
export function exportFileName(title: string | null, html: string): string {
  return exportFileBase(title) + (isSvgDocument(html) ? SVG_EXTENSION : HTML_EXTENSION)
}

/**
 * One 64-bit fingerprint over the export identity: the original title
 * (unslugged — two different titles must never share a URL even where their
 * ASCII slug shapes collide) followed by a separator and the complete document.
 * Two `Math.imul` lanes over the UTF-16 code units with final avalanche —
 * no BigInt and no TextEncoder on the hot path: where FNV-1a via BigInt cost
 * ~90 ms on a max-size (256 KB) document, this costs ~2 ms, which matters on
 * the browser half where the click handler digests while the tab paints.
 * Each bundle carries its own copy of one identical function, so host and
 * card derive byte-identical names deterministically; sixteen hex digits give a collision birthday far beyond any deployment's
 * render count; the point is uniqueness, not secrecy — anyone holding the
 * page can recompute it.
 * @param identity - the string to digest: the base name and the complete
 *   document, separated so neither alone collides across pairs.
 * @returns sixteen lowercase hex characters.
 */
function digestHex(identity: string): string {
  let h1 = 0xdeadbeef | 0
  let h2 = 0x41c6ce57 | 0
  for (let i = 0; i < identity.length; i++) {
    const ch = identity.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  // Final avalanche: each lane mixes in the other's high bits, so every
  // input bit reaches every output bit (the cyrb53 finishing step, widened).
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0')
}

/**
 * The finalized export's served/sidecar name: the kebab-case slug plus a
 * digest over the original title and the bytes, so one slug under different
 * content never clobbers an earlier export, distinct originals never alias,
 * and one exact render always shares one stable URL no matter how often it
 * re-renders. Both planes derive this from the same `(title, html)` pair
 * they each hold, so host and card cannot disagree.
 * @param title - the call's explicit `title` argument, or null when absent.
 * @param html - the complete document.
 * @returns `<slug>-<16 hex digits>.svg|.html`.
 */
export function exportShareName(title: string | null, html: string): string {
  const base = exportFileBase(title)
  return `${base}-${digestHex(`${String(title ?? '')}\u0000${html}`)}${isSvgDocument(html) ? SVG_EXTENSION : HTML_EXTENSION}`
}

/**
 * The streaming sidecar's file name for one base.
 * @param base - the base name {@link exportFileBase} produced.
 * @returns `<base>.partial`.
 */
export function partialFileName(base: string): string {
  return base + PARTIAL_SUFFIX
}

/** One servable export's identity for the artifact gallery listing. */
export interface ArtifactListEntry {
  /** The exact served name (`<slug>-<16hex>.html|.svg`); what the page and copy-link URLs address. */
  name: string
  /** Human-readable title derived from the slug: digest and extension stripped, hyphens read as spaces. */
  title: string
  /** `svg` for a bare-SVG export, `html` otherwise. */
  kind: 'html' | 'svg'
  /** File size in bytes. */
  bytes: number
  /** Last-modified time, Unix epoch ms — the finalize rename's mtime. */
  mtimeMs: number
  /** Whether the gallery has pinned this export: floats it above unpinned
   * entries in the listing and exempts it from the age-based retention sweep. */
  pinned: boolean
}

/** Digest suffix {@link exportShareName} appends; stripped before display. */
const DIGEST_SUFFIX = /-[0-9a-f]{16}$/

/**
 * Human-readable title of one served export name, for the artifact gallery
 * listing: the digest and extension stripped, hyphens read as spaces, first
 * character capitalized. The original title is not recoverable from the name
 * alone — kebab-slugging is lossy by design (see {@link exportFileBase}) —
 * so this is a display approximation, not a round-trip.
 * @param servedName - a name {@link isServableExportName} accepts.
 * @returns the display title.
 */
export function displayTitleOf(servedName: string): string {
  const dot = servedName.lastIndexOf('.')
  const stem = dot === -1 ? servedName : servedName.slice(0, dot)
  const spaced = stem.replace(DIGEST_SUFFIX, '').replace(/-+/g, ' ').trim()
  if (spaced.length === 0) return FALLBACK_BASE
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
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
