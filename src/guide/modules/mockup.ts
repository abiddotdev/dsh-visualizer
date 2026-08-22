import type { ModuleGuide } from '../types.ts'

/** Mockup artifact guidance. */
export const mockup: ModuleGuide = {
  module: 'mockup',
  summary: 'UI mockups of pages and components. SVG with flat fills over the transparent canvas; no gradients or shadows.',
  detail: [
    '### Mental model',
    'A mockup reproduces structure and states, not pixel perfection: real copy over lorem ipsum, the actual control set over decorative stand-ins, and every state the flow has (empty, filled, error, disabled) shown or reachable.',
    'Show alternatives as stacked variants with a caption each, never one wide composite the reader must decode.',
    'Clickable flows belong to the interactive module; a mockup may stay static — but wiring handlers to swap visible state lets a reviewer click through, so prefer it when the flow is the point.',
    '### Measurements',
    'Work a fixed grid inside one viewBox: 680 wide, 20px page margins (640 usable), 12px gaps between stacked components, 16-20px padding inside cards, 20px body line-height; two columns of 314, three of 205.',
    'Exact radii per element class, not one radius everywhere: 6px on inputs, 8px on cards, 12px on modals.',
    'Font sizes bottom out at 11px; weights 400 and 500 only — weight is emphasis, and more than two weights reads as noise.',
    'Tight gap of 8px between a label and its input; 24px between major sections.',
    '### Composition',
    'Paint order is z-order: page background, card backgrounds, card content, overlaid badges and selection states, tooltips last.',
    'Every input carries a label above it. The primary action sits rightmost or bottom-most; a destructive action always has a Cancel beside it; the active nav item carries an underline or fill.',
    'Flat fills only over the transparent canvas; gradients and shadows corrupt the streamed preview while it grows.',
    'Theme with the --dsw-* tokens and system fonts — a mockup that invents its own palette or typeface misleads review into arguing about the wrong thing.',
    '### Failure modes',
    'Cards float unaligned: no grid — place every element on the 12px gutter grid with computed column widths.',
    'States invisible: only the happy path drawn — add error, empty, and disabled variants of the critical fields.',
    'Buttons orphaned left: no alignment rule — primary rightmost, secondary left of it, full-width only in narrow columns.',
    '### Quick reference',
    '- Grid: 680 viewBox, 20 margins, 12 gutters, 16-20 padding; radii 6/8/12 by element class.',
    '- Labels above inputs (8px gap); primary action rightmost; destructive gets Cancel.',
    '- Min font 11px; weights 400/500 only; flat fills; --dsw-* tokens and system fonts.',
    '- Real copy, real controls, real states; variants stacked with captions.',
  ],
}
