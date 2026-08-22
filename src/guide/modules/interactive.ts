import type { ModuleGuide } from '../types.ts'

/** Interactive artifact guidance. */
export const interactive: ModuleGuide = {
  module: 'interactive',
  summary: 'Dashboards, explainers, and small apps. HTML with the script placed last, computing from data embedded in the document; '
    + 'a button may call sendPrompt(text) to ask the agent a follow-up, and window.storage (async get/set/delete, keys like table:record_id, '
    + 'get rejects on a missing key) keeps state across renders of the same conversation.',
  detail: [
    '### Mental model',
    'All state lives in one object; one render() reads only that state; every mutation goes through a setter that re-renders. Direct DOM patches (el.style.width = ...) scatter state across the tree and the next re-render loses them.',
    'Compute from a <script type="application/json"> data block parsed on start; the document stands alone with no fetches to invented endpoints.',
    'Before coding, write the encoding table: each data field to the control that filters it and the marks that display it.',
    '### Controls',
    'No <form> elements: a submit navigates the frame and the widget disappears. Use buttons with click handlers.',
    'Sliders carry step="1" for integers and a live readout; round every displayed value (toFixed, never raw floats — 33.333333333336% is a bug).',
    'Bind with addEventListener to re-render functions, not inline onclick strings.',
    'sendPrompt(text) is for what the document cannot compute itself: explanations, analysis, recommendations, drill-down from a data point. Filtering, sorting, math, and show/hide stay in JS. Send rich context, not a bare question — name the row or metric the user clicked. The host rate-limits repeats.',
    'Persist user state with window.storage get/set/delete under keys like filters:region; get rejects on a missing key, so catch it to apply first-run defaults. Never touch localStorage or sessionStorage — the sandbox denies both.',
    'Size canvas to devicePixelRatio with the context scaled to match, and SVG via viewBox, so controls stay crisp on scaled displays.',
    '### Failure modes',
    'Widget vanishes on submit: a <form> tag — plain buttons with handlers.',
    'Display desyncs after updates: direct DOM mutation — route every change through state and render().',
    'State resets after regeneration: localStorage silently failed — window.storage is the supported store.',
    'Canvas colors draw black or transparent: var(...) passed as a fill — use literal hex on canvas, tokens in CSS.',
    'Keep persisted state small: one document scope holds 256k units across all keys and values.',
    '### Quick reference',
    '- State object + render() + setters; never patch the DOM directly.',
    '- No <form>, no localStorage; sendPrompt for analysis, JS for computation.',
    '- Round every displayed number; sliders step="1" with live readouts.',
    '- window.storage with namespaced keys; catch missing-key rejects for first-run defaults.',
  ],
}
