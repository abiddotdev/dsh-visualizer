import { describe, expect, it } from 'vitest'
import { validateCanvasOps } from '../src/canvas/validate.ts'
import { extractCanvasStreamArgs } from '../src/canvas/stream-args.ts'
import { canvasPromptText, CANVAS_PROMPT_PREFIX } from '../src/canvas/types.ts'
import type { CanvasOp } from '../src/canvas/types.ts'
import { canvasProjectionDefinition } from '../src/canvas/index.ts'
import { normalizeCanvasOps } from '../src/canvas/normalize.ts'

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

  it('accepts near-miss geometry: pair pairs and the points alias', () => {
    const [line] = validateCanvasOps([
      { op: 'line', color: 'ink', width: 2, bounds: [[10, 20], [30, 40]] },
    ], []) as [{ bounds: number[] }]
    expect(line.bounds).toEqual([10, 20, 30, 40])
    const [arrow] = validateCanvasOps([
      { op: 'arrow', color: 'ink', width: 2, points: [1, 2, 3, 4] },
    ], []) as [{ bounds: number[] }]
    expect(arrow.bounds).toEqual([1, 2, 3, 4])
    const [rect] = validateCanvasOps([
      { op: 'rect', color: 'ink', width: 2, points: [5, 6, 7, 8] },
    ], []) as [{ bounds: number[] }]
    expect(rect.bounds).toEqual([5, 6, 7, 8])
  })

  it('applies the documented width/size defaults when omitted', () => {
    const [stroke] = validateCanvasOps([{ op: 'stroke', color: 'ink', points: [0, 0, 10, 10] }], []) as [{ width: number }]
    expect(stroke.width).toBe(3)
    const [shape] = validateCanvasOps([{ op: 'ellipse', color: 'ink', bounds: [0, 0, 10, 10] }], []) as [{ width: number }]
    expect(shape.width).toBe(3)
    const [text] = validateCanvasOps([{ op: 'text', color: 'ink', text: 'hi', at: [5, 5] }], []) as [{ size: number }]
    expect(text.size).toBe(20)
    // Out-of-range explicit widths still throw.
    expect(() => validateCanvasOps([{ op: 'stroke', color: 'ink', width: 99, points: [0, 0, 1, 1] }], [])).toThrow(/width/)
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

describe('canvas projection fold', () => {
  const definition = canvasProjectionDefinition()

  it('starts null and takes the whole scene from each draw event', () => {
    expect(definition.init()).toBeNull()
    const first = [{ op: 'stroke', color: 'ink', width: 3, points: [1, 2, 3, 4] }] as CanvasOp[]
    const afterFirst = definition.apply(null, { type: 'canvas/draw', data: { ops: first } })
    expect(afterFirst).toEqual(first)
    // Whole-scene rule: the second event REPLACES, not appends.
    const second = [
      { op: 'stroke', color: 'ink', width: 3, points: [0, 0, 1, 1] },
      { op: 'rect', color: 'accent', width: 2, bounds: [10, 10, 20, 20] },
    ] as CanvasOp[]
    expect(definition.apply(afterFirst, { type: 'canvas/draw', data: { ops: second } })).toEqual(second)
  })

  it('keeps the same state reference for unrelated events (zero downstream work)', () => {
    const state = [{ op: 'text', color: 'ink', text: 'hi', at: [1, 1] }] as CanvasOp[]
    expect(definition.apply(state, { type: 'turn/start' })).toBe(state)
    expect(definition.apply(state, { type: 'message/update' })).toBe(state)
  })

  it('views state unchanged and versions at 1', () => {
    const state = [{ op: 'ellipse', color: 'accent', bounds: [0, 0, 5, 5] }] as CanvasOp[]
    expect(definition.view(state)).toBe(state)
    expect(definition.stateVersion).toBe(1)
    expect(definition.key).toBe('canvas')
  })

  it('schema accepts whole scenes and null', () => {
    expect(definition.schema.safeParse(null).success).toBe(true)
    expect(definition.schema.safeParse([{ op: 'stroke', color: 'ink' }]).success).toBe(true)
    expect(definition.schema.safeParse('nope').success).toBe(false)
    expect(definition.schema.safeParse([42]).success).toBe(false)
  })
})

describe('canvas op normalization tolerance', () => {
  it('aliases type→op and infers a missing discriminator from shape fields', () => {
    const norm = normalizeCanvasOps([
      { type: 'rect', color: 'ink', bounds: [1, 2, 3, 4] },          // alias
      { color: 'ink', points: [0, 0, 10, 10] },                      // infer stroke
      { text: 'hi', at: [5, 5] },                                    // infer text
      { color: 'ink', bounds: [2, 2, 8, 8] },                        // infer rect
    ])
    expect(norm.notes).toHaveLength(0)
    expect(norm.ops.map(op => op.op)).toEqual(['rect', 'stroke', 'text', 'rect'])
  })

  it('coerces numeric strings and clamps width into range instead of throwing', () => {
    const norm = normalizeCanvasOps([
      { op: 'rect', color: 'ink', width: '2.5', bounds: ['10', 20, 30, '40'] },
      { op: 'stroke', color: 'ink', width: 0, points: [0, 0, 5, 5] },   // below range → clamped up
      { op: 'stroke', color: 'ink', width: 'broad', points: [0, 0, 5, 5] }, // unusable → dropped field
    ])
    expect(norm.notes).toHaveLength(0)
    expect(norm.ops[0]).toMatchObject({ width: 2.5, bounds: [10, 20, 30, 40] })
    expect(norm.ops[1]?.width).toBe(0.5)
    expect(norm.ops[2]?.width).toBeUndefined()
  })

  it('drops hopeless ops with reasons but keeps the rest of the batch', () => {
    const norm = normalizeCanvasOps([
      { op: 'circle', color: 'ink' },                                   // unknown kind
      { op: 'ellipse', color: 'ink', bounds: [1, 2, 3] },               // short bounds
      { op: 'stroke', color: 'ink', points: [1, 2, 3] },                // odd length
      { op: 'rect', color: 'ink', bounds: [1, 2, 3, 4] },               // fine
      'garbage',
    ])
    expect(norm.ops).toHaveLength(1)
    expect(norm.notes.map(note => note.index)).toEqual([0, 1, 2, 4])
    expect(norm.notes[2]?.reason).toContain('even length')
  })

  it('accepts the exact car-drawing batch from a live session (regression)', () => {
    const car = [
      { bounds: [250, 350, 200, 120], color: 'ink', op: 'rect', width: 2.5 },
      { bounds: [300, 280, 160, 80], color: 'ink', op: 'rect', width: 2.5 },
      { bounds: [200, 450, 40, 40], color: 'ink', op: 'ellipse', width: 2.5 },
      { bounds: [420, 450, 40, 40], color: 'ink', op: 'ellipse', width: 2.5 },
      { points: [220, 470, 200, 470, 200, 490, 220, 490], color: 'ink', op: 'stroke', width: 3 },
      { points: [480, 470, 500, 470, 500, 490, 480, 490], color: 'ink', op: 'stroke', width: 3 },
    ]
    const norm = normalizeCanvasOps(car)
    expect(norm.notes).toHaveLength(0)
    // And it survives the strict validator unchanged.
    expect(() => validateCanvasOps(norm.ops, [])).not.toThrow()
    // The streaming decoder also recovers every op from this payload.
    const view = extractCanvasStreamArgs(JSON.stringify({ ops: car }))
    expect(view?.ops).toHaveLength(6)
  })
})
