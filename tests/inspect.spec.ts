import { describe, expect, it } from 'vitest'
import { inspectDocument } from '../src/inspect.ts'

/** Findings as `line: message` strings, in reported order. */
function findings(html: string): string[] {
  return inspectDocument(html).issues.map(issue => `${issue.line}: ${issue.message}`)
}

describe('document inspection', () => {
  it('passes a clean document with module scripts, CDN imports, and json data', () => {
    const html = [
      '<!DOCTYPE html>',
      '<style>.a { fill: url(#grad); }</style>',
      '<svg id="grad" viewBox="0 0 10 10"><circle cx="1" r="2"/></svg>',
      '<script type="application/json">{"not": "js"]</script>',
      '<script type="module">',
      'import { select } from "https://esm.sh/d3";',
      'const el = select("#grad");',
      'await el.text();',
      '</script>',
    ].join('\n')
    expect(findings(html)).toEqual([])
  })

  it('reports a classic script syntax error at the script tag line', () => {
    const html = '<svg>\n<circle r="1"/>\n<script>function broken(</script>\n</svg>'
    const found = findings(html)
    expect(found).toHaveLength(1)
    expect(found[0]).toMatch(/^3: script does not parse: /)
  })

  it('reports duplicate attributes, duplicate ids, and dangling references', () => {
    const html = [
      '<svg>',
      '  <defs><linearGradient id="grad"/></defs>',
      '  <defs><linearGradient id="grad"/></defs>',
      '  <circle cx="1" cx="2" r="2" fill="url(#missing)"/>',
      '  <a href="#nowhere">link</a>',
      '</svg>',
    ].join('\n')
    const found = findings(html)
    expect(found).toContain('3: duplicate id "grad" (first defined at line 2)')
    expect(found).toContain('4: duplicate attribute "cx" on <circle>')
    expect(found).toContain('4: references id "missing" but no element defines it')
    expect(found).toContain('5: references id "nowhere" but no element defines it')
    // The defined gradient itself is not flagged.
    expect(found.join('\n')).not.toContain('"grad" but no element')
  })

  it('ignores defects inside HTML comments and external or skipped scripts', () => {
    const html = [
      '<!-- <circle cx="1" cx="2"/> <script>nope(</script> -->',
      '<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>',
      '<script type="importmap">{"broken"}</script>',
      '<svg><rect width="1"/></svg>',
    ].join('\n')
    expect(findings(html)).toEqual([])
  })

  it('checks inline event handlers and reports their parse failure', () => {
    const html = '<button onclick="updateMeters(">go</button>'
    const found = findings(html)
    expect(found).toHaveLength(1)
    expect(found[0]).toMatch(/^1: inline onclick handler does not parse: /)
  })

  it('declines to judge a module whose import could not be lifted cleanly', () => {
    const html = '<script type="module">import {\n  select,\n} from "https://esm.sh/d3";\nselect("svg");</script>'
    expect(findings(html)).toEqual([])
  })

  it('sorts findings by line across sections', () => {
    const html = [
      '<circle cx="1" cx="2"/>',
      '<script>nope(</script>',
      '<a href="#gone">x</a>',
    ].join('\n')
    const found = inspectDocument(html).issues
    expect(found.map(i => i.line)).toEqual([1, 2, 3])
  })
})
