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
 * Open button out of "Export", and vice versa.
 * @module dsh-visualizer/export-control
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { exportCall } from './share.ts'

/** How long a failed export stays visible before the control resets, offering a retry. */
export const EXPORT_FAILURE_REVERT_MS = 4_000

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
}

/**
 * One call's export-on-demand state and the idempotent `ensure` action both
 * of a card's share-adjacent controls call into.
 * @param callId - the call to export, or null where the card does not know
 * it (e.g. an owner currency with no per-call identity) — `ensure` then
 * always resolves null without a request.
 */
export function useExportControl(callId: string | null): ExportControl {
  const [state, setState] = useState<{ status: ExportStatus; name: string | null }>({ status: 'idle', name: null })
  const pending = useRef<Promise<string | null> | null>(null)
  const stateRef = useRef(state)
  stateRef.current = state

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

  return { status: state.status, name: state.name, ensure }
}
