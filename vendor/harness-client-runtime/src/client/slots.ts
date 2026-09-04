/**
 * Compile-time slot-registry face, trimmed from the harness client runtime
 * (see ../README.md): only the members client plugins call. The deployed
 * runtime supplies the full implementation through the module table.
 */
import type { Context } from '@deepseek-ai/cordis'

/** Keyed-slot registration face used by client plugins. */
export interface SlotRegistry {
  /**
   * Register one keyed slot contribution.
   * @param definition - slot name plus optional key and locale namespace.
   * @param component - the rendered node component for the slot.
   * @returns disposer removing the contribution.
   */
  register(
    definition: { readonly name: string; readonly key?: string; readonly locale?: string },
    component: unknown,
  ): () => void

  /**
   * Register one chain-slot contribution: `select` is the entry's routing
   * seat over the slot's owner currency, and its non-null return becomes the
   * rendered component's `matched` prop (see `dsh-client-ui-slots`'s
   * `ChainSelect`/`MatchedShare`, not re-exposed through this trimmed face).
   * @param definition - slot name, routing selector, and optional locale namespace.
   * @param component - the rendered node component for the slot.
   * @returns disposer removing the contribution.
   */
  register<M>(
    definition: { readonly name: string; readonly select: (owner: never) => M | null; readonly locale?: string },
    component: unknown,
  ): () => void

  /**
   * Register a lazy slot contribution factory, invoked once the slot is first
   * rendered.
   * @param name - slot name to inject into.
   * @param factory - lazily produces the registration disposer.
   * @returns disposer removing the injection.
   */
  inject(name: string, factory: () => () => void): () => void
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Keyed UI slot registry. */
    slots: SlotRegistry
  }
}

export type { Context }
