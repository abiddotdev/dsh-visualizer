// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { downloadDocument } from '../src/client/download.ts'

afterEach(() => {
  vi.restoreAllMocks()
})

/** Install Blob-URL and click spies; exposes the anchor and Blob per call. */
function spies() {
  const created = vi.spyOn(URL, 'createObjectURL').mockImplementation((blob: Blob) => `blob:${blob.size}`)
  const revoked = vi.spyOn(URL, 'revokeObjectURL').mockReturnValue()
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
  return { created, revoked, click }
}

function lastAnchor(click: ReturnType<typeof spies>['click']): HTMLAnchorElement {
  const anchor = click.mock.instances.at(-1) as HTMLAnchorElement | undefined
  if (anchor === undefined) throw new Error('no anchor clicked')
  return anchor
}

describe('downloadDocument', () => {
  it('saves an HTML document under .html with the HTML mime type', () => {
    const s = spies()
    downloadDocument('Q3 dash', '<!DOCTYPE html><html><body><p>x</p></body></html>')
    expect(lastAnchor(s.click).download).toBe('Q3 dash.html')
    expect(s.created.mock.calls[0]?.[0].type).toBe('text/html;charset=utf-8')
  })

  it('saves a bare SVG document under .svg with the SVG mime type', () => {
    const s = spies()
    downloadDocument('Flow', '   <svg viewBox="0 0 100 40"><rect width="10" height="10"/></svg>')
    expect(lastAnchor(s.click).download).toBe('Flow.svg')
    expect(s.created.mock.calls[0]?.[0].type).toBe('image/svg+xml')
  })

  it('keeps an HTML document that merely mentions svg on the html path', () => {
    const s = spies()
    downloadDocument('T', '<!doctype html><body><svg><rect/></svg></body>')
    expect(lastAnchor(s.click).download).toBe('T.html')
  })
})
