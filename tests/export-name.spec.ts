import { describe, expect, it } from 'vitest'
import {
  EXPORTS_ROUTE_PATH, MAX_EXPORT_BASE_CHARS, PARTIAL_SUFFIX,
  exportFileBase, exportFileName, isServableExportName, isSvgDocument, partialFileName,
} from '../src/shared/export-name.ts'

describe('export naming', () => {
  it('keeps the shared route path under the plugin namespace', () => {
    expect(EXPORTS_ROUTE_PATH).toBe('/visualizer')
    expect(PARTIAL_SUFFIX).toBe('.partial')
  })

  it('sanitizes a title into one safe path segment', () => {
    expect(exportFileBase('Q3: "final"')).toBe('Q3_ _final_')
    expect(exportFileBase('a/b\\c')).toBe('a_b_c')
    expect(exportFileBase('  spaced  ')).toBe('spaced')
    expect(exportFileBase('图表')).toBe('图表')
  })

  it('falls back for absent, blank, and dot-only titles', () => {
    expect(exportFileBase(null)).toBe('render')
    expect(exportFileBase('')).toBe('render')
    expect(exportFileBase('   ')).toBe('render')
    expect(exportFileBase('.')).toBe('render')
    expect(exportFileBase('..')).toBe('render')
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
    expect(exportFileName('Dash', '<!DOCTYPE html><html></html>')).toBe('Dash.html')
    expect(exportFileName('Flow', '<svg><rect/></svg>')).toBe('Flow.svg')
    expect(exportFileName(null, '<p>x</p>')).toBe('render.html')
    expect(partialFileName('Dash')).toBe('Dash.partial')
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
