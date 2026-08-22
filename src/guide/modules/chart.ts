import type { ModuleGuide } from '../types.ts'

/** Chart artifact guidance. */
export const chart: ModuleGuide = {
  module: 'chart',
  summary: 'Data displays: bar, line, pie, scatter, heatmap. Inline SVG for small sets, one CDN library for complex series.',
  detail: [
    'Hand-rolled inline SVG is best under ~30 points; beyond that load one library — https://cdn.jsdelivr.net/npm/chart.js or https://esm.sh/echarts — with a script tag and initialize it from a script placed last.',
    'Embed the data as a <script type="application/json"> block and parse it on start; never scrape numbers back out of the rendered DOM.',
    'Label axes, units, and series directly in the markup; the reader cannot interrogate the frame.',
    'Compute scales from the data range in the script, with padding so labels never clip at the frame edge.',
    'Redraw on resize: listen for window resize, re-read the container width, and re-render — the frame width follows the chat column.',
    'Animate series in with stroke-dashoffset or opacity under prefers-reduced-motion guards, not with layout tweens.',
  ],
}
