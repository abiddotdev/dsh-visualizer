import { describe, expect, it } from 'vitest'
import { composeGuideText, composeModuleDetail, GUIDE_MODULE_IDS, MODULE_GUIDES } from '../src/guide/index.ts'

describe('visualizer guide', () => {
  it('composes the section from every registered roster entry', () => {
    const text = composeGuideText()
    for (const guide of MODULE_GUIDES) {
      expect(text).toContain(`- ${guide.module}: ${guide.summary}`)
    }
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
    expect(text).toContain('write plus show_html')
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
    expect(() => { composeModuleDetail(['chart', 'collage']) }).toThrow('unknown artifact type(s) collage')
    expect(() => { composeModuleDetail(['chart', 'collage']) }).toThrow(GUIDE_MODULE_IDS.join(', '))
  })
})
