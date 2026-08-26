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
    'Persist user state with window.storage get/set/delete under keys like filters:region; get rejects on a missing key, so catch it to apply first-run defaults. Never touch localStorage or sessionStorage — the sandbox denies both. Batch one logical group into a single key (one round trip, atomic) instead of a key per fragment, show a loading state while any await runs, and keep persisted state small: one document scope holds 256k units across all keys and values.',
    'Icons in HTML come from a webfont library on the CDN (Tabler: <i class="ti ti-name">, outline variants only — filled ones are not in the font) at explicit per-icon font sizes so every icon in one component matches; inside SVG a webfont <i> renders nothing — use Unicode glyphs or inline paths in a <text>/<path> instead. Icons never exceed 48px; align with vertical-align in flow or dominant-baseline in SVG; decorative icons carry aria-hidden.',
    'Size canvas to devicePixelRatio with the context scaled to match, and SVG via viewBox, so controls stay crisp on scaled displays.',
    '### Starter snippet',
    'The state-render-setter loop this module leans on, with a button routed through sendPrompt instead of a <form>:',
    '```js\nlet state = { count: 0 }\nfunction render() {\n  document.getElementById(\'count\').textContent = state.count\n}\nfunction setCount(next) {\n  state.count = next\n  render()\n}\ndocument.getElementById(\'inc\').addEventListener(\'click\', () => setCount(state.count + 1))\ndocument.getElementById(\'explain\').addEventListener(\'click\', () =>\n  sendPrompt(`Why did the count reach ${state.count}?`))\nrender()\n```',
    'window.storage with a namespaced key and a caught first-run miss, instead of localStorage:',
    '```js\ntry {\n  state.filters = await window.storage.get(\'filters:region\')\n} catch {\n  state.filters = { region: \'all\' } // first run: key does not exist yet\n}\n```',
    'A Tabler icon inline with text: both classes are required, and the optical baseline needs a manual nudge:',
    '```html\n<span style="color: var(--dsw-alias-label-secondary); font-size: 14px">\n  <i class="ti ti-check" style="font-size: 16px; vertical-align: -2px" aria-hidden="true"></i>\n  Connected\n</span>\n```',
    '### Failure modes',
    'Widget vanishes on submit: a <form> tag — plain buttons with handlers.',
    'The whole app loads inside the card after a click: an href anchor navigated the null-origin frame — plain buttons with scrollIntoView; fragment links are converted automatically.',
    'Display desyncs after updates: direct DOM mutation — route every change through state and render().',
    'State resets after regeneration: localStorage silently failed — window.storage is the supported store.',
    'Canvas colors draw black or transparent: var(...) passed as a fill — use literal hex on canvas, tokens in CSS.',
    'Keep persisted state small: one document scope holds 256k units across all keys and values.',    '### Quick reference',
    '- State object + render() + setters; never patch the DOM directly.',
    '- No <form>, no localStorage; sendPrompt for analysis, JS for computation.',
    '- Round every displayed number; sliders step="1" with live readouts.',
    '- window.storage with namespaced keys; catch missing-key rejects for first-run defaults.',
  ],
}
