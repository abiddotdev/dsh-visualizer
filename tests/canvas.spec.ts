import { describe, expect, it } from 'vitest'
import { validateCanvasOps } from '../src/canvas/validate.ts'
import { extractCanvasStreamArgs } from '../src/canvas/stream-args.ts'
import { canvasPromptText, CANVAS_PROMPT_PREFIX } from '../src/canvas/types.ts'

describe('validateCanvasOps', () => {
  it('accepts a valid mixed batch', () => {
    const ops = validateCanvasOps([
      { op: 'stroke', color: 'ink', width: 3, points: [0, 0, 10, 10] },
      { op: 'rect', color: 'accent', width: 2, bounds: [10, 10, 40, 20] },
      { op: 'text', color: 'ink', text: 'hi', size: 20, at: [5, 5] },
      { op: 'arrow', color: 'ink', width: 2, bounds: [0, 0, 100, 50] },
    ], [])
    expect(ops).toHaveLength(4)
  })

  it('clamps coordinates into the logical canvas', () => {
    const [op] = validateCanvasOps([{ op: 'stroke', color: 'ink', width: 3, points: [-50, -20, 5000, 9999] }], []) as [{ points: number[] }]
    expect(op.points).toEqual([0, 0, 1000, 640])
  })

  it('rejects unknown colors, empty batches, and clear-as-op', () => {
    expect(() => validateCanvasOps([{ op: 'stroke', color: 'hotpink', width: 3, points: [0, 0, 1, 1] }], [])).toThrow(/unknown color/)
    expect(() => validateCanvasOps([], [])).toThrow(/non-empty/)
    expect(() => validateCanvasOps([{ op: 'clear' } as never], [])).toThrow(/clear is a tool argument/)
  })

  it('rejects malformed strokes and bounds', () => {
    expect(() => validateCanvasOps([{ op: 'stroke', color: 'ink', width: 3, points: [0, 0] }], [])).toThrow(/points/)
    expect(() => validateCanvasOps([{ op: 'rect', color: 'ink', width: 3, bounds: [1, 2, 3] }], [])).toThrow(/bounds/)
    expect(() => validateCanvasOps([{ op: 'text', color: 'ink', text: '', size: 10, at: [0, 0] }], [])).toThrow(/text/)
  })

  it('caps ops per call and scene size', () => {
    const many = Array.from({ length: 65 }, () => ({ op: 'line', color: 'ink', width: 1, bounds: [0, 0, 1, 1] }))
    expect(() => validateCanvasOps(many, [])).toThrow(/at most 64/)
    // 8 calls of 64 fill the scene; the next op exceeds the 512 cap.
    const full: unknown[] = []
    for (let i = 0; i < 8; i++) full.push(...validateCanvasOps(many.slice(0, 64), full as never[]))
    expect(() => validateCanvasOps([{ op: 'line', color: 'ink', width: 1, bounds: [0, 0, 1, 1] }], full as never[])).toThrow(/scene is full/)
  })
})

describe('extractCanvasStreamArgs', () => {
  it('recovers complete ops from a cut ops array', () => {
    const raw = '{"clear":false,"ops":[{"op":"stroke","color":"ink","width":3,"points":[10,10,50,60]},{"op":"rect","color":"accent","width":2,"bounds":[1,2,3,4'
    const view = extractCanvasStreamArgs(raw)
    expect(view).not.toBeNull()
    expect(view!.clear).toBe(false)
    expect(view!.complete).toBe(false)
    expect(view!.ops).toHaveLength(1)
    expect(view!.partial).not.toBeNull()
    expect(view!.partial!.op).toBe('rect')
    expect(view!.partial!.numbers).toEqual([1, 2, 3, 4])
  })

  it('reads clear:true and completes on the closing bracket', () => {
    const raw = '{"clear":true,"ops":[]}'
    const view = extractCanvasStreamArgs(raw)!
    expect(view.clear).toBe(true)
    expect(view.complete).toBe(true)
    expect(view.ops).toHaveLength(0)
  })

  it('decodes a cut text op', () => {
    const raw = '{"ops":[{"op":"text","color":"ink","size":20,"at":[5,5],"text":"hel'
    const view = extractCanvasStreamArgs(raw)!
    expect(view.partial!.text).toBe('hel')
    expect(view.partial!.op).toBe('text')
  })

  it('returns null before the ops key arrives', () => {
    expect(extractCanvasStreamArgs('{"clear":fal')).toBeNull()
    expect(extractCanvasStreamArgs('{')).toBeNull()
  })
})

describe('canvasPromptText', () => {
  it('wraps note and ops', () => {
    const text = canvasPromptText([{ op: 'stroke', color: 'accentWarm', width: 3, points: [1, 2, 3, 4] }], 'fix this')
    expect(text.startsWith(CANVAS_PROMPT_PREFIX)).toBe(true)
    expect(text).toContain('fix this')
    expect(text).toContain('"points":[1,2,3,4]')
  })

  it('omits the note line when empty', () => {
    const text = canvasPromptText([], '   ')
    expect(text).toBe(`${CANVAS_PROMPT_PREFIX}[]`)
  })
})
