/**
 * Export-on-demand state, shared by every card that offers a Share/Copy
 * link pair: nothing is written to the host's disk until this runs once —
 * see `share.ts`'s `exportCall` and `export-fanout.ts`'s write path. Two
 * controls both need this: the Open-standalone-page button (which must stay
 * synchronous with its own click to avoid a popup blocker, so it shows an
 * "Export" state until the write is confirmed, only then becoming "Open")
 * and Copy-link (which has no such constraint and can await the same
 * `ensure()` transparently before copying). Both call the same `ensure()` so
 * a click on either one updates both — copying a link first also flips the
 * Open button out of "Export", and vice versa. Copy-link and Unshare only
 * ever render once `status === 'exported'`, so neither needs its own
 * `ensure()` call: by the time they are reachable, the export already is.
 * @module dsh-visualizer/export-control
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { exportShareName } from '../shared/export-name.ts'
import { deleteArtifact } from './artifact-gallery.ts'
import { artifactPageUrlByName, exportCall } from './share.ts'

/** How long a failed export stays visible before the control resets, offering a retry. */
export const EXPORT_FAILURE_REVERT_MS = 4_000

/** Window Unshare's confirm arm stays live before reverting on its own — the same span the gallery's own row-level delete uses. */
export const UNSHARE_CONFIRM_MS = 3_000

export type ExportStatus = 'idle' | 'exporting' | 'exported' | 'failed'

export interface ExportControl {
  readonly status: ExportStatus
  /** The finalized export's name once `status === 'exported'`; null otherwise. */
  readonly name: string | null
  /**
   * Ensure the call is exported: reuses the cached name once exported, joins
   * an already in-flight request rather than starting a second one, and
   * otherwise starts the write.
   * @returns the export's name, or null when there is no call to export or
   * the host refused the request.
   */
  readonly ensure: () => Promise<string | null>
  /**
   * Remove the export from the host's disk and, on success, return the
   * control to `idle` — a genuinely unshared card, not just a locally
   * forgotten one. A no-op (resolves false) when nothing is currently
   * exported.
   * @returns whether the host removed it.
   */
  readonly unshare: () => Promise<boolean>
}

/**
 * One call's export-on-demand state and the idempotent `ensure` action both
 * of a card's share-adjacent controls call into.
 * @param callId - the call to export, or null where the card does not know
 * it (e.g. an owner currency with no per-call identity) — `ensure` then
 * always resolves null without a request.
 * @param title - the call's title, for the same-name reconciliation check
 * below; only ever read at mount.
 * @param html - the call's document, for the same reason.
 */
export function useExportControl(callId: string | null, title: string | null, html: string): ExportControl {
  const [state, setState] = useState<{ status: ExportStatus; name: string | null }>({ status: 'idle', name: null })
  const pending = useRef<Promise<string | null> | null>(null)
  const stateRef = useRef(state)
  stateRef.current = state

  // A page reload remounts every card at 'idle', with no memory of whatever
  // this component's state held before — but the export itself is durable
  // (a file on the host's disk), so 'idle' would be a lie for a call that
  // was already exported in an earlier page load. The client already
  // computes the exact name that export would carry (the same digest both
  // planes always derive), so a HEAD check on mount asks the one question
  // local state cannot answer: does it already exist. Runs once per callId;
  // an in-progress or already-settled `ensure()` (from a user's own click
  // racing ahead of this) always wins, since the check only ever moves
  // 'idle' state, never overwrites 'exporting'/'exported'/'failed'.
  useEffect(() => {
    if (callId === null) return
    const url = artifactPageUrlByName(exportShareName(title, html))
    if (url === null) return
    let cancelled = false
    void fetch(url, { method: 'HEAD' }).then((response) => {
      if (cancelled || !response.ok || stateRef.current.status !== 'idle') return
      setState({ status: 'exported', name: exportShareName(title, html) })
    }).catch(() => {})
    return () => { cancelled = true }
    // title/html are frozen once a call settles, so only callId identifying
    // a fresh card is worth re-checking; deliberately not a dependency.
  }, [callId])

  const ensure = useCallback((): Promise<string | null> => {
    if (stateRef.current.status === 'exported' && stateRef.current.name !== null) {
      return Promise.resolve(stateRef.current.name)
    }
    if (callId === null) return Promise.resolve(null)
    if (pending.current !== null) return pending.current
    setState({ status: 'exporting', name: null })
    const request = exportCall(callId).then((name) => {
      pending.current = null
      setState(name !== null ? { status: 'exported', name } : { status: 'failed', name: null })
      return name
    })
    pending.current = request
    return request
  }, [callId])

  useEffect(() => {
    if (state.status !== 'failed') return
    const timer = window.setTimeout(() => { setState({ status: 'idle', name: null }) }, EXPORT_FAILURE_REVERT_MS)
    return () => { window.clearTimeout(timer) }
  }, [state.status])

  const unshare = useCallback((): Promise<boolean> => {
    const name = stateRef.current.name
    if (stateRef.current.status !== 'exported' || name === null) return Promise.resolve(false)
    return deleteArtifact(name).then((ok) => {
      if (ok) setState({ status: 'idle', name: null })
      return ok
    })
  }, [])

  return { status: state.status, name: state.name, ensure, unshare }
}
