import { describe, expect, it } from 'vitest'
import { extractStreamArgs } from '../src/client/partial-args.ts'

describe('extractStreamArgs', () => {
  it('returns null before the html key opens its string', () => {
    expect(extractStreamArgs('')).toBeNull()
    expect(extractStreamArgs('{')).toBeNull()
    expect(extractStreamArgs('{"title"')).toBeNull()
    expect(extractStreamArgs('{"title":"Dash","height":480,"html":')).toBeNull()
    expect(extractStreamArgs('{"html":null,"x":1}')).toBeNull()
    expect(extractStreamArgs('not json')).toBeNull()
  })

  it('decodes a growing html prefix with title and height', () => {
    const early = extractStreamArgs('{"title":"Dash","height":480,"html":"<p>he')
    expect(early).toEqual({ html: '<p>he', complete: false, title: 'Dash', height: 480, loadingMessages: [] })

    const late = extractStreamArgs('{"title":"Dash","height":480,"html":"<p>hello</p>"}')
    expect(late).toEqual({ html: '<p>hello</p>', complete: true, title: 'Dash', height: 480, loadingMessages: [] })
  })

  it('unescapes JSON string escapes inside the streaming value', () => {
    const view = extractStreamArgs('{"html":"a\\"b\\\\c\\n\\t\\u4e2d\\ud83d"}')
    expect(view?.html).toBe('a"b\\c\n\t中\ud83d')
    expect(view?.complete).toBe(true)
  })

  it('drops a dangling escape, a cut unicode sequence, and a cut surrogate pair', () => {
    expect(extractStreamArgs('{"html":"x\\')?.html).toBe('x')
    expect(extractStreamArgs('{"html":"x\\u4e')?.html).toBe('x')
    // U+1F600 as a streamed surrogate pair: high half cut from its low half.
    expect(extractStreamArgs('{"html":"\\ud83d')?.html).toBe('')
    expect(extractStreamArgs('{"html":"\\ud83d\\')?.html).toBe('')
  })

  it('decodes a settled loadingMessages array before the html key opens', () => {
    // While the array is still streaming (bracket not closed), the html key
    // cannot have opened, so every observable view carries settled items.
    const growing = extractStreamArgs('{"loadingMessages":["Setting up","Wiring"],"html":"<p>x')
    expect(growing?.loadingMessages).toEqual(['Setting up', 'Wiring'])

    const escaped = extractStreamArgs('{"loadingMessages":["Bribing bars to stand \u0041"],"html":"<p>x')
    expect(escaped?.loadingMessages).toEqual(['Bribing bars to stand A'])

    const empty = extractStreamArgs('{"loadingMessages":[],"html":"<p>x')
    expect(empty?.loadingMessages).toEqual([])
  })

  it('carries settled title and height; values before html closed by the time it opened', () => {
    // A cut earlier value cannot coexist with an opened html: the scanner is
    // still inside that value. So every observable view carries settled ones.
    const view = extractStreamArgs('{"title":"Da","height":48,"html":"<p>x')
    expect(view).toEqual({ html: '<p>x', complete: false, title: 'Da', height: 48, loadingMessages: [] })

    const nonInteger = extractStreamArgs('{"height":48.5,"html":"<p>x"}')
    expect(nonInteger?.height).toBeNull()
    expect(nonInteger?.html).toBe('<p>x')

    const absent = extractStreamArgs('{"html":"<p>x"}')
    expect(absent?.title).toBeNull()
    expect(absent?.height).toBeNull()
  })

  it('does not mistake the key text inside an earlier string value', () => {
    const view = extractStreamArgs('{"title":"say \\"html\\": goodbye","html":"<p>ok</p>"}')
    expect(view?.title).toBe('say "html": goodbye')
    expect(view?.html).toBe('<p>ok</p>')
    expect(view?.complete).toBe(true)
  })

  it('skips composite values that precede the html key', () => {
    const raw = '{"meta":{"nested":"{\\"html\\":\\"trap\\"}"},"html":"<p>real</p>"}'
    const view = extractStreamArgs(raw)
    expect(view?.html).toBe('<p>real</p>')
    expect(view?.complete).toBe(true)
  })
})
