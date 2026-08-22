import type { ModuleGuide } from '../types.ts'

/** Diagram artifact guidance. */
export const diagram: ModuleGuide = {
  module: 'diagram',
  summary: 'Flowcharts, architecture, and structure. Prefer SVG with a viewBox, laid out top-down so the shape grows cleanly while it streams.',
  detail: [
    'Build with inline SVG carrying a viewBox so the diagram scales with the column; declare markers and any defs before first use.',
    'Keep labels as svg text elements (not foreignObject) so text scales with the diagram and streams as plain markup.',
    'Compute node positions in the script — column ranks for a flow, tiers for architecture — never hand-place more than a handful of nodes.',
    'Connect boxes with paths derived from their boxes; orthogonal elbows read cleaner than long diagonals.',
    'Stroke and label with the --dsw-alias-* tokens so the diagram follows the host theme.',
    'Lay out top-down: the streamed document grows downward, matching the height the frame measures.',
  ],
}
