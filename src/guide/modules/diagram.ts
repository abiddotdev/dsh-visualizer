import type { ModuleGuide } from '../types.ts'

/** Diagram artifact guidance. */
export const diagram: ModuleGuide = {
  module: 'diagram',
  summary: 'Flowcharts, architecture, and structure. Prefer SVG with a viewBox, laid out top-down so the shape grows cleanly while it streams.',
  detail: [
    '### Mental model',
    'Three failures break nearly every diagram: a position defined in two places that drifts apart, layout math skipped until elements overlap, and the DOM mutated directly instead of re-rendered from one state object. Design against those three before drawing anything.',
    'Define the data first — nodes carrying label/type/metrics, edges carrying from/to/metrics, UI state separate — then derive every coordinate and edge path from that data.',
    'Layout strategy follows the data, not aesthetics: a fixed hierarchy (tiers, org charts, layered architecture) uses a manual row grid; an unknown or organic topology uses a force simulation.',
    '### Measurements',
    'Do the box math before writing coordinates: fix the viewBox, the node size, and each row y so nothing is placed by eye. Example grid: 800x400 canvas, 120x48 nodes, rows at y=50/170/300.',
    'Center text with text-anchor="middle" and dominant-baseline="central" at the computed box center; never approximate a baseline by nudging y.',
    'Stroke-only paths carry fill="none", or they render as filled black blobs covering the scene.',
    'Keep labels as svg text elements, not foreignObject: text scales with the diagram and streams as plain markup.',
    '### Composition',
    'Paint order is z-order: background, edges, nodes, labels, overlays — declare defs and markers before their first use.',
    'Edges connect computed box edges with orthogonal elbows, never box centers drawn through boxes.',
    'Text-spec diagrams (ERD, sequence, state, git graph) render through Mermaid from esm.sh: initialize with startOnLoad:false, await document.fonts.ready first, and pass explicit themeVariables for both light and dark.',
    'Stroke and label with the --dsw-alias-* tokens so the diagram follows the host theme; lay out top-down to match the direction the streamed frame grows.',
    '### Failure modes',
    'Edges detach from boxes after any change: coordinates duplicated in the shape and the edge — compute both from one source.',
    'Force nodes fly off-frame: no clamp — clamp positions in the tick handler and add centering forces.',
    'Text renders tiny and unreadable: an arbitrary oversized viewBox (1000x1000) — size the viewBox to the actual content.',
    'Mermaid renders unstyled or in the wrong theme: default variables — pass both light and dark themeVariables explicitly.',
    '### Quick reference',
    '- Data object first; positions derived once, never duplicated.',
    '- Box math on paper, then coordinates; text centered via anchor attributes.',
    '- Layer order: background, edges, nodes, labels, overlays; defs first.',
    '- Force layouts clamp and center; Mermaid inits startOnLoad:false with themeVariables.',
  ],
}
