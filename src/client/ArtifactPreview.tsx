// The gallery's detail-pane preview: a live render of an artifact's own
// already-served, already-sandboxed page — never a server-generated
// thumbnail. That would mean the host executing model-authored HTML/scripts
// to screenshot it, which contradicts this plugin's whole security model
// (rendering stays client-side, inside a sandboxed frame, always). An SVG
// export needs no frame at all: browsers never run script for `<img>`
// content regardless of what the SVG contains, and the served SVG's own CSP
// already strips `script-src` server-side.
//
// An HTML export is fetched as text and embedded via `srcDoc`, the same
// technique the chat card's own AutoFrame uses for its (in-memory) document
// — never a `src=` navigation to the served URL. `X-Frame-Options`/CSP
// `frame-ancestors` only govern navigations that fetch a document over
// HTTP(S); `srcDoc` content is supplied inline, so it is never subject to
// either, regardless of whether the exports route ever ends up served from
// a different origin than the app (see README's "Production hardening
// tip"). The pane itself is sized purely by CSS (`.previewBox`'s
// `aspect-ratio`, in ArtifactGallery.module.css): the iframe/img fill it at
// 100%/100%, so the embedded document reflows at whatever real pixel width
// the pane occupies instead of being laid out at a fixed virtual viewport
// and shrunk via `transform: scale()` — no JS measurement needed, and it
// adapts to window resizes for free through the browser's own layout engine.

import { useEffect, useState } from 'react'
import css from './ArtifactGallery.module.css'

/** Fetch progress for the HTML branch's `srcDoc` text. */
type FetchState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; html: string }

/**
 * A live preview of one served artifact, filling its container.
 * @param url - the artifact's already-resolved served URL (from
 * `artifactPageUrlByName`) — not recomputed here.
 * @param kind - `svg` renders a plain image; `html` fetches the served page
 * as text and renders it as a sandboxed `srcDoc` iframe.
 * @param label - localized accessible name; drives both `alt` and `title`.
 */
export function ArtifactPreview({ url, kind, label }: { url: string; kind: 'html' | 'svg'; label: string }) {
  return (
    <div className={css.previewBox}>
      {kind === 'svg' ? <img className={css.previewImage} src={url} alt={label} /> : <HtmlPreview url={url} label={label} />}
    </div>
  )
}

/**
 * The HTML branch: fetches the served (already-wrapped) page as text, then
 * embeds it via `srcDoc` — a plain resource fetch, never a navigation, so
 * `X-Frame-Options`/CSP `frame-ancestors` never apply regardless of the
 * exports route's origin relative to the app.
 */
function HtmlPreview({ url, label }: { url: string; label: string }) {
  const [state, setState] = useState<FetchState>({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    setState({ status: 'loading' })
    fetch(url, { cache: 'no-store' })
      .then((response) => {
        if (!response.ok) throw new Error(`preview fetch failed (${response.status})`)
        return response.text()
      })
      .then((html) => { if (!cancelled) setState({ status: 'ready', html }) })
      .catch(() => { if (!cancelled) setState({ status: 'error' }) })
    return () => { cancelled = true }
  }, [url])

  if (state.status !== 'ready') return null
  return <iframe className={css.previewFrame} srcDoc={state.html} sandbox="allow-scripts" title={label} />
}
