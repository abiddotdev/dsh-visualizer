import type { ModuleGuide } from '../types.ts'

/** Art artifact guidance. */
export const art: ModuleGuide = {
  module: 'art',
  summary: 'Generative and animated scenes. Canvas or SVG, with a CDN library such as p5.js when needed; keep every animation within the contract.',
  detail: [
    'Seed the generator and expose the seed as a visible control; reproducibility separates art from a bug report.',
    'Draw on a canvas sized to devicePixelRatio with the context scaled to match, or use SVG with a viewBox; both stay crisp when the column resizes.',
    'Animate only transform, opacity, and stroke-dashoffset, guarded by prefers-reduced-motion; layout animation repaints the whole frame every tick.',
    'Offer a control that calls sendPrompt for a rerun ("another variation in this palette") — regeneration with different parameters beats in-frame rewrites.',
    'Keep the frame transparent unless the piece needs a ground; a forced background fights the chat surface it sits on.',
  ],
}
