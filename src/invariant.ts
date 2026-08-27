/**
 * Package-owned invariant companion for `dsh-visualizer`.
 * @module dsh-visualizer/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = 'dsh-visualizer'

/** Cordis companion plugin name. */
export const name = 'visualizer-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the model-facing adapter owns no lifecycle stream — the
 * call/result relation it produces is already the tools registry's owned event
 * pair — and the cards are pure projections of the logged call arguments they
 * render; the stream Context is folded by the shared conversation-event engine.
 * The export fanout is likewise a read-only projection: it observes the same
 * logged events and writes files no other component reads back.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
