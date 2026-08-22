import type { ModuleGuide } from '../types.ts'

/** Mockup artifact guidance. */
export const mockup: ModuleGuide = {
  module: 'mockup',
  summary: 'UI mockups of pages and components. SVG with flat fills over the transparent canvas; no gradients or shadows.',
  detail: [
    'Reproduce structure and states, not pixel perfection: real copy over lorem ipsum, and the actual control set over decorative stand-ins.',
    'Show alternatives as stacked variants with a caption each, not one wide composite the reader must decode.',
    'Use real form controls and wire their handlers to swap visible state, so a reviewer can click through the flows.',
    'Theme with the --dsw-* tokens and system fonts; a mockup that invents its own palette misleads review.',
    'Flat fills only over the transparent canvas; gradients and shadows corrupt the streamed preview while it grows.',
  ],
}
