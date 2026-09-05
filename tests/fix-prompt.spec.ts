import { describe, expect, it } from 'vitest'
import { composeFixPrompt } from '../src/client/fix-prompt.ts'
import { WIDGET_PROMPT_MAX_CHARS } from '../src/client/annotate.ts'

/** A failure with nothing set; each case overrides only what it exercises. */
const NONE = { title: null, scriptSrc: null, runtimeMessage: null, runtimeLine: null }

describe('composeFixPrompt', () => {
  it('composes nothing when the render did not fail', () => {
    expect(composeFixPrompt({ ...NONE, title: 'Dash' })).toBeNull()
  })

  it('treats empty failure strings as no failure at all', () => {
    expect(composeFixPrompt({ ...NONE, scriptSrc: '', runtimeMessage: '' })).toBeNull()
  })

  it('names the document, the runtime error, and its line', () => {
    const text = composeFixPrompt({
      ...NONE,
      title: 'Quarterly revenue',
      runtimeMessage: "TypeError: Cannot read properties of null (reading 'getContext')",
      runtimeLine: 42,
    })
    expect(text).toBe([
      'The document you just rendered, "Quarterly revenue", failed in the preview:',
      '',
      "- a script error on line 42: TypeError: Cannot read properties of null (reading 'getContext')",
      '',
      'Fix the cause and re-render the corrected document.',
    ].join('\n'))
  })

  it('omits the line when the frame could not attribute one', () => {
    const text = composeFixPrompt({ ...NONE, title: 'Dash', runtimeMessage: 'TypeError: x' })
    expect(text).toContain('- a script error: TypeError: x')
    expect(text).not.toContain('line')
  })

  it('names the document by position when the call carried no title', () => {
    const text = composeFixPrompt({ ...NONE, runtimeMessage: 'TypeError: x' })
    expect(text?.startsWith('The document you just rendered failed in the preview:')).toBe(true)
  })

  it('falls back to the positional name for a blank title', () => {
    const text = composeFixPrompt({ ...NONE, title: '   ', runtimeMessage: 'TypeError: x' })
    expect(text?.startsWith('The document you just rendered failed in the preview:')).toBe(true)
  })

  it('leads with the load failure and adds the root-cause hint', () => {
    const text = composeFixPrompt({
      ...NONE,
      title: 'Dash',
      scriptSrc: 'https://unpkg.com/chart.js',
      runtimeMessage: 'ReferenceError: Chart is not defined',
      runtimeLine: 12,
    })
    const lines = text?.split('\n') ?? []
    // The load failure explains the ReferenceError, so it is stated first.
    expect(lines[2]).toBe('- a library failed to load: https://unpkg.com/chart.js')
    expect(lines[3]).toBe('- a script error on line 12: ReferenceError: Chart is not defined')
    expect(text).toContain('root cause')
  })

  it('leaves the CDN hint out when nothing failed to load', () => {
    const text = composeFixPrompt({ ...NONE, title: 'Dash', runtimeMessage: 'TypeError: x' })
    expect(text).not.toContain('root cause')
  })

  it('bounds a model-authored title and stays inside the widget prompt cap', () => {
    const text = composeFixPrompt({
      ...NONE,
      title: 'T'.repeat(5_000),
      scriptSrc: `https://cdn.jsdelivr.net/${'p'.repeat(512)}`,
      runtimeMessage: 'E'.repeat(300),
      runtimeLine: 9,
    })
    expect(text).not.toBeNull()
    expect(text!.length).toBeLessThanOrEqual(WIDGET_PROMPT_MAX_CHARS)
    expect(text).toContain(`"${'T'.repeat(120)}"`)
    expect(text).not.toContain('T'.repeat(121))
  })
})
