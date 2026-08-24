/**
 * The universal authoring contract every visualizer document follows,
 * independent of artifact type.
 * @module dsh-visualizer/guide/contract
 */

/* The CDN hosts name the same four origins src/client/shell.ts enforces in
 * the frame CSP — the client bundle cannot import this half, so a change to
 * one list must land on the other. */
/** Contract lines of the guide; the section's second block. */
export const CONTRACT: readonly string[] = [
  'Order the document to stream: style rules first, visible markup next, scripts last — the preview paints while you write, and scripts run once after the document completes.',
  'Keep the document self-contained: inline styles and scripts, or libraries loaded from https://esm.sh, https://cdnjs.cloudflare.com, https://cdn.jsdelivr.net, or https://unpkg.com; scripts from other domains fail silently.',
  'The preview renders on a transparent canvas over the chat background; do not set page or body backgrounds unless the user asks for a specific background or theme.',
  'While the document streams, markup is replaced as it grows: place style rules before the markup they style, and avoid gradients and shadows on streamed content.',
  'Animate only transform, opacity, and stroke-dashoffset, wrapped in @media (prefers-reduced-motion: no-preference); animating layout properties repaints the whole frame on every tick. Loop durations stay between 0.8s and 2.0s — shorter reads frantic, longer sluggish.',
  'Keep typography quiet: sentence case everywhere (never Title Case or ALL CAPS except short uppercase metadata labels with letter-spacing), weights 400 and 500 only, and SVG text at 14px for primary labels and 12px for secondary.',
  'Mark visuals for assistive tech: every <svg> carries role="img" and an aria-label with a fallback text node inside, decorative icons get aria-hidden, dynamically updated regions get aria-live, and status is never color alone — pair it with a shape, dash pattern, or text label.',
  'The host injects its --dsw-* design tokens onto the document root at load and again on theme changes — color with them (e.g. color: var(--dsw-alias-label-primary)) so the artifact follows the app theme instead of hardcoding its palette. In SVG, CSS variables resolve only through the style attribute (style="fill: var(--dsw-alias-label-primary)"), never the fill/stroke attributes, which draw black or nothing.',
  'The frame sizes itself to the content: avoid position:fixed, which reports no height, and never hide streamed content with display:none.',
  'The frame spans the chat column and the document fills it: give SVG width="100%" with a viewBox, read window.innerWidth for script-driven layouts, and never hardcode a design width like 800px — a fixed-width element overflows the column or wastes it. The frame fires its own resize event when the column changes.',
  'Nearly every broken visual traces to one of three causes: a position defined in two places, layout math skipped, or the DOM mutated directly instead of re-rendered — derive each position once, compute before drawing, and render from a single state object.',
  'A render result carries a static document check (script syntax, duplicate attributes, dangling id references); when it lists issues, fix them and re-render the corrected document before finishing your turn.',
  'Never navigate from inside the document: no href anchors, no location writes, no forms — the frame is a null-origin srcdoc and any navigation reloads the host app inside the card. For in-document jumps use <button> with element.scrollIntoView(); fragment links are converted to that scroll automatically.',
  'Keep every explanation in the response prose, never inside the artifact: the document carries only the visual, and consecutive visuals get a prose bridge between them — stacked back-to-back renders with no connecting text read as an unedited dump.',
  'Loading messages are 1–4 short status lines (~5 words each) shown while the document streams: plain for serious topics (illness, war, grief — anything the reader might be personally affected by; describe what the code is doing in dull terms, not evocative ones), playful for everything else (alliteration, puns, personification). Scale count with complexity: one for a simple chart, up to four for a dense interactive scene.',
]
