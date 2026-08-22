import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { CallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as toolGenerativeUi from '../src/index.ts'

const testToolSignal = new AbortController().signal

async function setup(maxHtmlBytes = 262_144) {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(toolGenerativeUi, { maxHtmlBytes })
  return { ctx }
}

/** Narrowed executor outcome: every assertion reads isError, content, and meta absence. */
interface ExecOutcome {
  isError: boolean
  content: readonly { type: string; text?: string }[]
  meta?: unknown
}

let callCounter = 0
function call(ctx: Context, args: unknown): Promise<ExecOutcome> {
  return ctx.tools.execute({
    signal: testToolSignal,
    callId: CallId(`render-${++callCounter}`),
    name: 'visualizer',
    arguments: args,
  })
}

/** First content block's text, or the empty string when absent. */
function firstText(outcome: ExecOutcome): string {
  const block = outcome.content[0]
  return block === undefined ? '' : block.text ?? ''
}

describe('visualizer tool', () => {
  it('registers a model-facing tool schema whose html parameter is last', async () => {
    const { ctx } = await setup()
    const schema = ctx.tools.schemas().find(tool => tool.name === 'visualizer')
    if (schema === undefined) throw new Error('visualizer was not registered')

    expect(schema).toMatchObject({
      name: 'visualizer',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          height: { type: 'number' },
          html: { type: 'string' },
        },
        required: ['html'],
      },
    })
    // Parameter order is the streaming contract: the document must be the
    // tail of the arguments JSON or no prefix preview is possible.
    const properties = (schema.parameters as { properties: Record<string, unknown> }).properties
    expect(Object.keys(properties)).toEqual(['title', 'height', 'html'])
  })

  it('renders a document from its arguments without touching the filesystem', async () => {
    const { ctx } = await setup()
    const html = '<!DOCTYPE html><html><body><h1>Revenue</h1></body></html>'

    const result = await call(ctx, { title: 'Revenue dashboard', html })

    expect(result.isError).toBe(false)
    expect(result.content).toEqual([{
      type: 'text',
      text: `Rendered Revenue dashboard (${html.length} bytes, 480px frame); document check passed.`,
    }])
    expect(result.meta).toBeUndefined()
  })

  it('derives the title and counts bytes as UTF-8, not UTF-16 code units', async () => {
    const { ctx } = await setup()
    // 2 CJK characters = 6 UTF-8 bytes, 2 UTF-16 code units.
    const result = await call(ctx, { html: '中文' })

    expect(result.content).toEqual([{ type: 'text', text: 'Rendered HTML (6 bytes, 480px frame); document check passed.' }])
  })

  it('lists document issues in the result so the model re-renders in the same turn', async () => {
    const { ctx } = await setup()
    const html = '<svg>\n<circle cx="1" cx="2" r="2" fill="url(#grad)"/>\n<script>function broken(</script>\n</svg>'

    const result = await call(ctx, { title: 'Broken', html })

    expect(result.isError).toBe(false)
    const text = firstText(result)
    expect(text).toContain('3 document issue(s)')
    expect(text).toContain('fix and re-render the corrected document in this turn')
    expect(text).toContain('line 2: duplicate attribute "cx" on <circle>')
    expect(text).toContain('line 2: references id "grad" but no element defines it')
    expect(text).toContain('line 3: script does not parse:')
  })

  it('rejects an empty document, an oversized one, and a fractional height', async () => {
    const empty = await setup()
    const emptyResult = await call(empty.ctx, { html: '  ' })
    expect(emptyResult.isError).toBe(true)
    expect(firstText(emptyResult)).toContain('html must be a non-empty document')

    const tiny = await setup(5)
    const bigResult = await call(tiny.ctx, { html: '中文' })
    expect(bigResult.isError).toBe(true)
    expect(firstText(bigResult)).toContain('over the 5-byte render limit')

    const fractional = await setup()
    const fracResult = await call(fractional.ctx, { html: '<p>x</p>', height: 480.5 })
    expect(fracResult.isError).toBe(true)
    expect(firstText(fracResult)).toContain('height must be an integer between 50 and 2000')
  })

  it('rejects a blank explicit title', async () => {
    const { ctx } = await setup()
    const result = await call(ctx, { title: '  ', html: '<p>x</p>' })
    expect(result.isError).toBe(true)
    expect(firstText(result)).toContain('title must be a non-empty string')
  })
})

describe('visualizer_guide tool', () => {
  /** Execute one guide call and return its rendered text. */
  async function guide(ctx: Context, args: unknown): Promise<ExecOutcome> {
    return ctx.tools.execute({
      signal: testToolSignal,
      callId: CallId(`guide-${++callCounter}`),
      name: 'visualizer_guide',
      arguments: args,
    })
  }

  it('registers beside the visualizer with an enum-constrained module array', async () => {
    const { ctx } = await setup()
    const schema = ctx.tools.schemas().find(tool => tool.name === 'visualizer_guide')
    if (schema === undefined) throw new Error('visualizer_guide was not registered')
    expect(ctx.tools.schemas().map(tool => tool.name)).toEqual(['visualizer', 'visualizer_guide'])
    expect(schema.parameters).toMatchObject({
      type: 'object',
      properties: { modules: { type: 'array', items: { type: 'string', enum: ['chart', 'diagram', 'mockup', 'interactive', 'art'] } } },
      required: ['modules'],
    })
  })

  it('returns the requested recipe as the model-visible text', async () => {
    const { ctx } = await setup()
    const result = await guide(ctx, { modules: ['chart'] })
    expect(result.isError).toBe(false)
    expect(firstText(result)).toContain('## chart')
    expect(firstText(result)).not.toContain('## diagram')
  })

  it('rejects an empty or unknown module list at the argument boundary', async () => {
    const { ctx } = await setup()
    const empty = await guide(ctx, { modules: [] })
    expect(empty.isError).toBe(true)
    // The enum rejects unknown ids before execute runs; composeModuleDetail
    // remains the second layer for non-boundary callers.
    const unknown = await guide(ctx, { modules: ['collage'] })
    expect(unknown.isError).toBe(true)
    expect(firstText(unknown)).toContain('must be one of ["chart","diagram","mockup","interactive","art"]')
  })
})
