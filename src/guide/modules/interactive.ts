import type { ModuleGuide } from '../types.ts'

/** Interactive artifact guidance. */
export const interactive: ModuleGuide = {
  module: 'interactive',
  summary: 'Dashboards, explainers, and small apps. HTML with the script placed last, computing from data embedded in the document; '
    + 'a button may call sendPrompt(text) to ask the agent a follow-up, and window.storage (async get/set/delete, keys like table:record_id, '
    + 'get rejects on a missing key) keeps state across renders of the same conversation.',
  detail: [
    'Compute from a <script type="application/json"> data block parsed on start; the document must stand alone with no fetches to invented endpoints.',
    'Bind controls with addEventListener to re-render functions, not inline onclick strings; one render function that reads the whole state keeps updates predictable.',
    'When a control needs data or analysis the document lacks, call sendPrompt(text) with a concrete question about what the widget shows; the host rate-limits repeats.',
    'Persist user state across regenerations with window.storage get/set/delete under keys like filters:region; get rejects on a missing key, so catch it to apply first-run defaults.',
    'Size draws to devicePixelRatio on canvas, or size SVG with a viewBox, so controls stay crisp on scaled displays.',
    'Keep interaction state small: one document scope holds 256k units across all keys and values.',
  ],
}
