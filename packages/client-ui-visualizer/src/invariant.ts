/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-client-ui-visualizer`.
 * @module @deepseek-ai/dsh-client-ui-visualizer/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-client-ui-visualizer'

/** Cordis companion plugin name. */
export const name = 'ui-visualizer-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the cards are pure projections of the logged call arguments they
 * render; the stream Context is folded by the shared conversation-event engine.
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
