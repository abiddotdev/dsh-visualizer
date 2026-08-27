import { describe, expect, it } from 'vitest'
import {
  EXPORTS_ROUTE_PATH, MAX_EXPORT_BASE_CHARS, PARTIAL_SUFFIX,
  exportFileBase, exportFileName, exportShareName, isServableExportName, isSvgDocument, partialFileName,
} from '../src/shared/export-name.ts'

describe('export naming', () => {
  it('keeps the shared route path under the plugin namespace', () => {
    expect(EXPORTS_ROUTE_PATH).toBe('/artifacts/visualizer')
    expect(PARTIAL_SUFFIX).toBe('.partial')
  })

  it('slugs a title into kebab-case ASCII', () => {
    expect(exportFileBase('Q3: "final" Review')).toBe('q3-final-review')
    expect(exportFileBase('  Spaced   Out  ')).toBe('spaced-out')
    expect(exportFileBase('a/b\\c')).toBe('a-b-c')
    expect(exportFileBase('Über – Übersicht')).toBe('u-ber-u-bersicht')
    expect(exportFileBase('--mixed--CASE--')).toBe('mixed-case')
  })

  it('keeps unicode out of the slug entirely', () => {
    // CJK and other non-Latin scripts slug away to nothing: files and URLs
    // stay ASCII, the card's display text keeps the full title.
    expect(exportFileBase('图表')).toBe('render')
    expect(exportFileBase('中文 Dashboard 图表')).toBe('dashboard')
  })

  it('falls back for absent, blank, and punctuation-only titles', () => {
    expect(exportFileBase(null)).toBe('render')
    expect(exportFileBase('')).toBe('render')
    expect(exportFileBase('   ')).toBe('render')
    expect(exportFileBase('.')).toBe('render')
    expect(exportFileBase('..')).toBe('render')
    expect(exportFileBase('???')).toBe('render')
  })

  it('caps a long title at the shared limit', () => {
    const long = 'x'.repeat(MAX_EXPORT_BASE_CHARS + 50)
    expect(exportFileBase(long)).toBe('x'.repeat(MAX_EXPORT_BASE_CHARS))
  })

  it('sniffs bare SVG documents against HTML framing', () => {
    expect(isSvgDocument('<svg viewBox="0 0 10 10"><rect/></svg>')).toBe(true)
    expect(isSvgDocument('   <svg/>')).toBe(true)
    expect(isSvgDocument('<!doctype html><body><svg/>')).toBe(false)
    expect(isSvgDocument('<html><svg/></html>')).toBe(false)
  })

  it('derives the same file name for the host writer and the card share control', () => {
    expect(exportFileName('Dash', '<!DOCTYPE html><html></html>')).toBe('dash.html')
    expect(exportFileName('Flow', '<svg><rect/></svg>')).toBe('flow.svg')
    expect(exportFileName(null, '<p>x</p>')).toBe('render.html')
    expect(partialFileName('Dash')).toBe('Dash.partial')
  })

  it('keys served names by slug plus content digest over the original title', () => {
    const html = '<!DOCTYPE html><html></html>'
    expect(exportShareName('Dash Board', html)).toMatch(/^dash-board-[0-9a-f]{16}\.html$/)
    expect(exportShareName(null, '<p>x</p>')).toMatch(/^render-[0-9a-f]{16}\.html$/)
    expect(exportShareName('Flow Chart', '<svg><rect/></svg>')).toMatch(/^flow-chart-[0-9a-f]{16}\.svg$/)
    // Colliding-slug originals never alias: the digest covers the unslugged
    // title, and both still read as the same friendly shape.
    const a = exportShareName('Résumé — v1', html)
    const b = exportShareName('Resume - v1', html)
    expect(a).not.toBe(b)
    expect(a.startsWith('re-sume-v1-')).toBe(true)
    expect(b.startsWith('resume-v1-')).toBe(true)
  })

  it('gives identical renders one stable name and changed bytes another', () => {
    const html = '<!DOCTYPE html><html><body>v1</body></html>'
    const v2 = '<!DOCTYPE html><html><body>v2</body></html>'
    // Re-rendering exact same output: the same shareable URL, forever.
    expect(exportShareName('Dash', html)).toBe(exportShareName('Dash', html))
    // Changed content under one title: a new file, the old link intact.
    expect(exportShareName('Dash', html)).not.toBe(exportShareName('Dash', v2))
    // Same bytes under different titles never collide either.
    expect(exportShareName('A', html)).not.toBe(exportShareName('B', html))
  })

  it('spreads every single-character mutation to a distinct digest', () => {
    // Avalanche property of the imul-lane fingerprint: flipping any one
    // character anywhere in a document-sized identity must change the name.
    const filler = 'lorem ipsum dolor sit amet '.repeat(400)
    const base = `<!DOCTYPE html><html><body>${filler}</body></html>`
    const baseline = exportShareName('Dash', base)
    const names = new Set<string>()
    for (let position = 30; position < base.length - 20; position += 97) {
      const mutated = `${base.slice(0, position)}${base[position] === 'x' ? 'y' : 'x'}${base.slice(position + 1)}`
      const name = exportShareName('Dash', mutated)
      expect(name).not.toBe(baseline)
      names.add(name)
    }
    expect(names.size).toBeGreaterThan(50)
  })

  it('keeps near-adjacent inputs collision-free at scale', () => {
    // Sequential, visually-near-identical documents (the realistic render
    // workload) must all land on unique names.
    const seen = new Set<string>()
    for (let i = 0; i < 10_000; i++) {
      const name = exportShareName('Report', `<p>row ${i}</p>`.repeat(20))
      expect(seen.has(name)).toBe(false)
      seen.add(name)
    }
  })

  it('digests large documents fast enough for the click path', () => {
    // The share control digests on click while the tab paints; a max-size
    // document must cost milliseconds, not frames. Guarded loosely — an
    // order-of-magnitude regression (e.g. back to per-byte BigInt) trips
    // this long before it reaches a user.
    const doc = `<!DOCTYPE html><html><body>${'x'.repeat(262_144 - 34)}</body></html>`
    exportShareName('Warm', doc)
    const started = performance.now()
    for (let i = 0; i < 5; i++) exportShareName(`Run ${i}`, doc)
    expect(performance.now() - started).toBeLessThan(500)
  })

  it('serves only finalized single-segment names', () => {
    expect(isServableExportName('chart.html')).toBe(true)
    expect(isServableExportName('a b.svg')).toBe(true)
    expect(isServableExportName('图表.html')).toBe(true)
    // The streaming sidecar is never exposed.
    expect(isServableExportName('chart.partial')).toBe(false)
    // Traversal and nesting never reach the filesystem.
    expect(isServableExportName('../evil.html')).toBe(false)
    expect(isServableExportName('..\\evil.html')).toBe(false)
    expect(isServableExportName('nested/path.html')).toBe(false)
    expect(isServableExportName('/abs.html')).toBe(false)
    // Dot-only bases and unknown extensions stay 404.
    expect(isServableExportName('.html')).toBe(false)
    expect(isServableExportName('..svg')).toBe(false)
    expect(isServableExportName('chart.txt')).toBe(false)
    expect(isServableExportName('')).toBe(false)
  })
})
