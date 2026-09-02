/**
 * Which `visualizer` calls a mounted settled-preview chat node currently
 * covers. The preview node is the frame's primary home once the call
 * settles; the keyed tool row suppresses its own frame for exactly the calls
 * covered here, so the two surfaces never show one document twice. The
 * mounted view is the source of truth: a mount retains its call id and an
 * unmount releases it, which is what makes the handback automatic when a
 * preview leaves the flow — history windowed past the call, a retry reset,
 * or the feature disabled — and the row shows its frame again.
 *
 * @module dsh-visualizer/preview-coverage
 */

import { useCallback, useSyncExternalStore } from 'react'

/** Call ids of mounted preview views, as reference counts. */
const covered = new Map<string, number>()

/** Subscribers notified whenever some call id's coverage flips. */
const listeners = new Set<() => void>()

/** Notify every subscriber; flips are rare, so this is never hot. */
function emit(): void {
  for (const listener of listeners) listener()
}

/**
 * Record one mounted preview view for a call. Nesting is tolerated (two
 * surfaces rendering the same settled turn) via reference counting.
 * @param callId - the settled call the mounted view renders.
 */
export function retainCoverage(callId: string): void {
  const previous = covered.get(callId) ?? 0
  covered.set(callId, previous + 1)
  if (previous === 0) emit()
}

/**
 * Drop one mounted preview view's claim on a call; the last release flips
 * the call back to row-covered.
 * @param callId - the call whose view unmounted.
 */
export function releaseCoverage(callId: string): void {
  const previous = covered.get(callId) ?? 0
  if (previous === 0) return
  if (previous === 1) {
    covered.delete(callId)
    emit()
    return
  }
  covered.set(callId, previous - 1)
}

/**
 * Whether a mounted preview view currently covers a call. Imperative probe
 * for tests and one-off checks; the reactive read is {@link usePreviewCovered}.
 * @param callId - the settled call to look up.
 * @returns true while at least one preview view for the call is mounted.
 */
export function isPreviewCovered(callId: string): boolean {
  return covered.has(callId)
}

/**
 * Reactively read one call's coverage: true while the settled preview chat
 * node for the call is mounted, false once it unmounts — the row uses this
 * to suppress its own frame for the covered calls only.
 * @param callId - the settled call this row renders.
 * @returns the call's current coverage.
 */
export function usePreviewCovered(callId: string): boolean {
  const subscribe = useCallback((listener: () => void): (() => void) => {
    listeners.add(listener)
    return () => { listeners.delete(listener) }
  }, [])
  const getSnapshot = useCallback(() => covered.has(callId), [callId])
  return useSyncExternalStore(subscribe, getSnapshot)
}
