import { describe, expect, it } from 'vitest'
import { composeGuideText, composeModuleDetail, GUIDE_MODULE_IDS, MODULE_GUIDES } from '../src/guide/index.ts'

describe('visualizer guide', () => {
  it('composes the section from every registered roster entry', () => {
    const text = composeGuideText()
    for (const guide of MODULE_GUIDES) {
      expect(text).toContain(`- ${guide.module}: ${guide.summary}`)
    }
  })

  it('lists only the configured modules when a subset is passed', () => {
    const text = composeGuideText(['chart'])
    expect(text).toContain('- chart: ')
    expect(text).not.toContain('- diagram: ')
    expect(text).not.toContain('- interactive: ')

    // The contract and gates stay regardless of the module set.
    expect(text).toContain('## Authoring contract')
    expect(text).toContain('## When to render a visual')
  })

  it('treats disabled modules as unknown in detail composition', () => {
    expect(composeModuleDetail(['chart'], ['chart'])).toContain('## chart')
    expect(() => composeModuleDetail(['diagram'], ['chart']))
      .toThrow(/unknown or disabled artifact type\(s\) diagram; enabled types: chart/)
  })

  it('never names a tool outside this plugin', () => {
    // Other harness tools introduce themselves through their own prompt
    // sections; the guide's gates route only among this plugin's surfaces.
    expect(composeGuideText()).not.toContain('show_html')
  })

  it('closes the roster with the just-in-time nudge when the guide tool is on', () => {
    const text = composeGuideText()
    expect(text).toContain('pull its recipe with visualizer_guide')
    // The nudge is the roster's last line: after the type list, before nothing.
    expect(text.trimEnd().endsWith('pull its recipe with visualizer_guide.')).toBe(true)
  })

  it('omits the nudge when the guide tool is disabled', () => {
    const text = composeGuideText(GUIDE_MODULE_IDS, false)
    expect(text).toContain('- chart: ')
    expect(text).not.toContain('visualizer_guide')
  })

  it('keeps roster names unique and summaries non-empty', () => {
    const seen = new Set<string>()
    for (const guide of MODULE_GUIDES) {
      expect(guide.summary.trim().length).toBeGreaterThan(0)
      expect(guide.detail.length).toBeGreaterThan(0)
      for (const line of guide.detail) expect(line.trim().length).toBeGreaterThan(0)
      expect(seen.has(guide.module)).toBe(false)
      seen.add(guide.module)
    }
    expect(seen.size).toBe(MODULE_GUIDES.length)
  })

  it('gives every module the shared recipe skeleton', () => {
    for (const guide of MODULE_GUIDES) {
      const sections = guide.detail
        .filter(line => line.startsWith('### '))
        .map(line => line.slice(4))
      // Fixed bookends: thinking order leads, failures read symptom-first,
      // the checklist closes.
      expect(sections, `${guide.module} sections`).toContain('Mental model')
      expect(sections, `${guide.module} sections`).toContain('Failure modes')
      expect(sections, `${guide.module} sections`).toContain('Quick reference')
      expect(sections[0]).toBe('Mental model')
      expect(sections[sections.length - 1]).toBe('Quick reference')
    }
  })

  it('carries the prose gate and the CDN hosts the shell CSP enforces', () => {
    const text = composeGuideText()
    expect(text).toContain('Never write HTML or SVG as prose')
    expect(text).toContain('pass its path instead of html')
    for (const host of ['https://esm.sh', 'https://cdnjs.cloudflare.com', 'https://cdn.jsdelivr.net', 'https://unpkg.com']) {
      expect(text).toContain(host)
    }
  })

  it('composes requested module detail in roster order, collapsing duplicates', () => {
    const text = composeModuleDetail(['interactive', 'chart', 'interactive'])
    expect(text.indexOf('## chart')).toBeLessThan(text.indexOf('## interactive'))
    expect(text).not.toContain('## diagram')
    for (const line of MODULE_GUIDES.find(g => g.module === 'chart')!.detail) {
      expect(text).toContain(line)
    }
  })

  it('names the known types when asked for an unknown one', () => {
    expect(() => { composeModuleDetail(['chart', 'collage']) }).toThrow('unknown or disabled artifact type(s) collage')
    expect(() => { composeModuleDetail(['chart', 'collage']) }).toThrow(GUIDE_MODULE_IDS.join(', '))
  })
})
