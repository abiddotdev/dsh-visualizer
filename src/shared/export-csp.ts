/**
 * Plane-neutral network-egress policy for rendered documents, in force in both
 * places a document runs: the sandboxed shell's `<meta>` CSP (streaming card
 * and settled row) and the serve route's response header on the exported page.
 * One list here; src/guide/contract.ts names the same hosts in prompt prose —
 * the client bundle cannot import the node half, so a widening must land in
 * both files together.
 * @module dsh-visualizer/shared/export-csp
 */

/**
 * Network-egress allowlist every rendered document is confined to. The node
 * half validates sizes, not origins, so this list is the only origin policy a
 * document meets: the tool's public-CDN promise is kept here and nowhere else.
 * Widening it widens what a rendered document may fetch and execute — inside
 * the frame and on the served page alike.
 */
const CDN_LIST = [
  'https://esm.sh',
  'https://cdnjs.cloudflare.com',
  'https://cdn.jsdelivr.net',
  'https://unpkg.com',
].join(' ')

/**
 * The CSP directive string the shell interpolates into its `<meta>` and the
 * serve route sends as a response header.
 */
export const RENDER_CSP_DIRECTIVES = [
  "default-src 'unsafe-inline' data:",
  `script-src 'unsafe-inline' ${CDN_LIST}`,
  `style-src 'unsafe-inline' ${CDN_LIST}`,
  `img-src 'self' data: ${CDN_LIST}`,
  `font-src ${CDN_LIST}`,
  `connect-src ${CDN_LIST}`,
  "form-action 'none'",
  "base-uri 'none'",
  "object-src 'none'",
].join('; ')
