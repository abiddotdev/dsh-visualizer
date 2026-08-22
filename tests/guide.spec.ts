import { describe, expect, it } from 'vitest'
import { composeGuideText, MODULE_GUIDES } from '../src/guide/index.ts'

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
      expect(seen.has(guide.module)).toBe(false)
      seen.add(guide.module)
    }
    expect(seen.size).toBe(MODULE_GUIDES.length)
  })

  it('carries the prose gate and the CDN hosts the shell CSP enforces', () => {
    const text = composeGuideText()
    expect(text).toContain('Never write HTML or SVG as prose')
    expect(text).toContain('write plus show_html')
    for (const host of ['https://esm.sh', 'https://cdnjs.cloudflare.com', 'https://cdn.jsdelivr.net', 'https://unpkg.com']) {
      expect(text).toContain(host)
    }
  })
})
