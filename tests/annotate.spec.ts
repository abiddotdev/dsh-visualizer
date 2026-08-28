import { describe, expect, it } from 'vitest'
import { WIDGET_PROMPT_MAX_CHARS } from '../src/client/AutoFrame.tsx'
import { ANNOTATION_COMMENT_MAX_CHARS, composeAnnotationPrompt, parseAnnotation } from '../src/client/annotate.ts'

/** One well-formed pick as the frame posts it; note applied post-parse. */
function pick(overrides: Record<string, unknown> = {}, comment = ''): AnnotationPickLike {
  const parsed = parseAnnotation({
    id: 'a1',
    kind: 'element',
    selector: 'section:nth-of-type(2)',
    tag: 'section',
    snippet: '<section>revenue</section>',
    text: 'revenue',
    ...overrides,
  })
  if (parsed === null) throw new Error('fixture pick failed to parse')
  return { ...parsed, comment }
}

type AnnotationPickLike = ReturnType<typeof parseAnnotation> & { comment: string }

describe('parseAnnotation', () => {
  it('accepts a well-formed pick and never trusts a frame-posted note', () => {
    const parsed = parseAnnotation({
      id: 'a1', kind: 'element', selector: 'section:nth-of-type(2)',
      tag: 'section', snippet: '<section>revenue</section>', text: 'revenue',
      comment: 'forged note',
    })
    expect(parsed).toEqual({
      id: 'a1', kind: 'element', selector: 'section:nth-of-type(2)',
      tag: 'section', snippet: '<section>revenue</section>', text: 'revenue', comment: '',
    })
  })

  it('rejects malformed payloads', () => {
    expect(parseAnnotation(null)).toBeNull()
    expect(parseAnnotation('x')).toBeNull()
    expect(parseAnnotation({ id: '', kind: 'element', selector: 'p', tag: 'p', snippet: '', text: '' })).toBeNull()
    expect(parseAnnotation({ id: 'x'.repeat(65), kind: 'element', selector: 'p', tag: 'p', snippet: '', text: '' })).toBeNull()
    expect(parseAnnotation({ id: 'a', kind: 'region', selector: 'p', tag: 'p', snippet: '', text: '' })).toBeNull()
    expect(parseAnnotation({ id: 'a', kind: 'element', selector: '', tag: 'p', snippet: '', text: '' })).toBeNull()
    expect(parseAnnotation({ id: 'a', kind: 'element', selector: 5, tag: 'p', snippet: '', text: '' })).toBeNull()
    expect(parseAnnotation({ id: 'a', kind: 'element', selector: 'p', tag: '', snippet: '', text: '' })).toBeNull()
    expect(parseAnnotation({ id: 'a', kind: 'element', selector: 'p', tag: 'p', text: '' })).toBeNull()
    expect(parseAnnotation({ id: 'a', kind: 'element', selector: 'p', tag: 'p', snippet: '' })).toBeNull()
  })

  it('bounds every string field host-side', () => {
    const parsed = parseAnnotation({
      id: 'a', kind: 'element',
      selector: 'x'.repeat(500), tag: 't'.repeat(100),
      snippet: 'y'.repeat(1000), text: 'z'.repeat(1000),
    })
    expect(parsed?.selector.length).toBe(300)
    expect(parsed?.tag.length).toBe(32)
    expect(parsed?.snippet.length).toBe(400)
    expect(parsed?.text.length).toBe(200)
  })
})

describe('composeAnnotationPrompt', () => {
  it('returns null with no picks', () => {
    expect(composeAnnotationPrompt([])).toBeNull()
  })

  it('composes one block per pick with locator lines', () => {
    const picks = [
      pick({ id: 'a1' }, 'make this red'),
      pick({ id: 'a2', kind: 'area', tag: 'div', selector: '.hero', snippet: '<div class="hero">', text: '' }),
    ]
    const text = composeAnnotationPrompt(picks)!
    expect(text).toContain('Comments on marked elements')
    expect(text).toContain('- make this red')
    expect(text).toContain('(no note)')
    expect(text).toContain('element: <section> section:nth-of-type(2)')
    expect(text).toContain('text: "revenue"')
    expect(text).toContain('markup: <section>revenue</section>')
    expect(text.length).toBeLessThanOrEqual(WIDGET_PROMPT_MAX_CHARS)
  })

  it('omits the bullet for a single pick', () => {
    const text = composeAnnotationPrompt([pick(undefined, 'bigger')])!
    expect(text).toContain('\nbigger\n')
    expect(text).not.toContain('- bigger')
  })

  it('degrades to selector-only under the prompt cap', () => {
    // Snippets land at the 400-char host bound, so 20 picks force the
    // degrade path honestly (20 × ~500 > the 4000-char prompt cap).
    const picks = Array.from({ length: 20 }, (_, i) => pick({
      id: `a${i}`,
      selector: `div:nth-of-type(${i + 1}) > span.marked-item-${i}`,
      snippet: 'x'.repeat(400),
      text: `item ${i}`,
    }, `note ${i} for the element`))
    const text = composeAnnotationPrompt(picks)!
    expect(text.length).toBeLessThanOrEqual(WIDGET_PROMPT_MAX_CHARS)
    expect(text).toContain('note 0 for the element')
    expect(text).toContain('note 19 for the element')
    expect(text).not.toContain('markup:')
  })
})

describe('comment cap', () => {
  it('is well under the prompt cap so several notes fit', () => {
    expect(ANNOTATION_COMMENT_MAX_CHARS).toBe(500)
    expect(ANNOTATION_COMMENT_MAX_CHARS).toBeLessThan(WIDGET_PROMPT_MAX_CHARS)
  })
})
