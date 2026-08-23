import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { CallId } from '@deepseek-ai/dsh-llm'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as toolGenerativeUi from '../src/index.ts'

const testToolSignal = new AbortController().signal

/** Partial plugin config one test overrides; defaults fill the rest. */
type SetupConfig = Partial<{ maxHtmlBytes: number; guideTool: boolean; guideModules: string[] }>

/**
 * The plugin declares no fs inject: it mounts with or without a filesystem
 * service. Tests pass one only when file mode itself is under test, so the
 * default setup runs with none — inline calls structurally cannot reach a
 * filesystem because this context has no service to reach.
 */
async function setup(config: SetupConfig = {}, fs?: unknown) {
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  if (fs !== undefined) {
    ;(ctx as unknown as { reflect: { provide(name: string, value: unknown): void } })
      .reflect.provide('fs', fs)
  }
  await ctx.plugin(toolGenerativeUi, { maxHtmlBytes: 262_144, ...config })
  return { ctx }
}

/** Narrowed executor outcome: every assertion reads isError, content, and meta. */
interface ExecOutcome {
  isError: boolean
  content: readonly { type: string; text?: string }[]
  /** Presentation meta projected onto the settled event; null for inline mode. */
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
          path: { type: 'string' },
          html: { type: 'string' },
        },
      },
    })
    // Parameter order is the streaming contract: the document must be the
    // tail of the arguments JSON or no prefix preview is possible. Neither
    // parameter is schema-required — execute enforces exactly one of the two.
    const properties = (schema.parameters as { properties: Record<string, unknown> }).properties
    expect(Object.keys(properties)).toEqual(['title', 'height', 'path', 'html'])
  })

  it('renders a document from its arguments with no filesystem service mounted', async () => {
    const { ctx } = await setup()
    const html = '<!DOCTYPE html><html><body><h1>Revenue</h1></body></html>'

    const result = await call(ctx, { title: 'Revenue dashboard', html })

    expect(result.isError).toBe(false)
    expect(result.content).toEqual([{
      type: 'text',
      text: `Rendered Revenue dashboard (${html.length} bytes, 480px frame); document check passed.`,
    }])
    expect(result.meta).toBeNull()
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
    // An empty html is no document at all, so the call reads as source-less.
    expect(firstText(emptyResult)).toContain('pass exactly one of html or path')

    const tiny = await setup({ maxHtmlBytes: 5 })
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

  it('registers the guide tool alone when the render tool stays and config disables nothing', async () => {
    const { ctx } = await setup({ guideTool: true, guideModules: ['chart', 'art'] })
    expect(ctx.tools.schemas().map(tool => tool.name)).toEqual(['visualizer', 'visualizer_guide'])
  })

  it('skips the guide tool entirely when the config disables it', async () => {
    const { ctx } = await setup({ guideTool: false })
    expect(ctx.tools.schemas().map(tool => tool.name)).toEqual(['visualizer'])
  })

  it('narrows the guide tool enum to the configured modules', async () => {
    const { ctx } = await setup({ guideModules: ['chart'] })
    const schema = ctx.tools.schemas().find(tool => tool.name === 'visualizer_guide')
    if (schema === undefined) throw new Error('visualizer_guide was not registered')
    expect(schema.parameters).toMatchObject({
      properties: { modules: { items: { enum: ['chart'] } } },
    })

    // The configured type serves; a disabled type dies at the boundary.
    const chart = await guide(ctx, { modules: ['chart'] })
    expect(chart.isError).toBe(false)
    expect(firstText(chart)).toContain('## chart')
    const diagram = await guide(ctx, { modules: ['diagram'] })
    expect(diagram.isError).toBe(true)
    expect(firstText(diagram)).toContain('must be one of ["chart"]')
  })

  it('fails loud at load on an unknown or empty module set', async () => {
    await expect(setup({ guideModules: ['chart', 'collage'] })).rejects.toThrow(
      /unknown artifact type\(s\) collage; known types: chart, diagram, mockup, interactive, art/,
    )
    await expect(setup({ guideModules: [] })).rejects.toThrow(/must list at least one artifact type/)
  })
})

describe('visualizer file mode', () => {
  const DOC = '<!DOCTYPE html><html><body><h1>From disk</h1></body></html>'
  const FILE_BYTES = new TextEncoder().encode(DOC).byteLength

  /**
   * Fake filesystem service over one in-memory file map, shaped to the
   * structural slice the tool reads through.
   */
  function fakeFs(files: Map<string, string>, type = 'file') {
    return {
      resolve: async (path: string) => ({ displayPath: path }),
      stat: async (target: { displayPath: string }) =>
        files.has(target.displayPath) ? { type } : undefined,
      readText: async (target: { displayPath: string }) => files.get(target.displayPath) ?? '',
    }
  }

  it('rejects a path call per call when no filesystem service is mounted, naming the html fallback', async () => {
    // Deliberately no fs provided: the plugin still registered (the schema
    // test pins that), and only this call fails.
    const { ctx } = await setup()

    const result = await call(ctx, { path: 'report.html' })
    expect(result.isError).toBe(true)
    expect(firstText(result)).toContain('no filesystem service is available in this deployment')
    expect(firstText(result)).toContain('pass the document as html instead of path')
  })

  it('loads a workspace document and carries its bytes in the result meta', async () => {
    const files = new Map([['report.html', DOC]])
    const { ctx } = await setup({}, fakeFs(files))

    const result = await call(ctx, { path: 'report.html' })

    expect(result.isError).toBe(false)
    expect(firstText(result)).toBe(
      `Rendered report (${FILE_BYTES} bytes from report.html, 480px frame); document check passed.`,
    )
    expect(result.meta).toEqual({ title: 'report', html: DOC, height: 480 })
  })

  it('prefers an explicit title over the derived file name', async () => {
    const files = new Map([['report.html', DOC]])
    const { ctx } = await setup({}, fakeFs(files))

    const result = await call(ctx, { title: 'Q3 Report', path: 'report.html' })
    expect(result.isError).toBe(false)
    expect(result.meta).toMatchObject({ title: 'Q3 Report' })
  })

  it('rejects a call naming both sources or neither', async () => {
    const files = new Map([['report.html', DOC]])
    const { ctx } = await setup({}, fakeFs(files))

    const both = await call(ctx, { html: DOC, path: 'report.html' })
    expect(both.isError).toBe(true)
    expect(firstText(both)).toContain('pass either html or path, not both')

    const neither = await call(ctx, { title: 'x' })
    expect(neither.isError).toBe(true)
    expect(firstText(neither)).toContain('pass exactly one of html or path')
  })

  it('fails loud on a missing, non-regular, or empty document', async () => {
    const missingCtx = (await setup({}, fakeFs(new Map()))).ctx
    const missing = await call(missingCtx, { path: 'gone.html' })
    expect(missing.isError).toBe(true)
    expect(firstText(missing)).toContain('cannot render "gone.html": not found')

    const dirCtx = (await setup({}, fakeFs(new Map([['d.html', DOC]]), 'directory'))).ctx
    const dir = await call(dirCtx, { path: 'd.html' })
    expect(dir.isError).toBe(true)
    expect(firstText(dir)).toContain('cannot render "d.html": not a regular file')

    const emptyCtx = (await setup({}, fakeFs(new Map([['e.html', '']])))).ctx
    const empty = await call(emptyCtx, { path: 'e.html' })
    expect(empty.isError).toBe(true)
    expect(firstText(empty)).toContain('cannot render "e.html": the document is empty')
  })

  it('applies the same byte budget to loaded documents', async () => {
    const big = `${DOC}${'<p>x</p>'.repeat(50)}`
    const files = new Map([['big.html', big]])
    const { ctx } = await setup({ maxHtmlBytes: 100 }, fakeFs(files))

    const result = await call(ctx, { path: 'big.html' })
    expect(result.isError).toBe(true)
    expect(firstText(result)).toContain(`"big.html" is ${new TextEncoder().encode(big).byteLength} bytes`)
    expect(firstText(result)).toContain('over the 100-byte render limit')
  })

  it('runs the settle-time document check on loaded documents too', async () => {
    // Duplicate id: one defect the check flags in any source mode.
    const defective = '<!DOCTYPE html><html><body><p id="a"></p><p id="a"></p></body></html>'
    const files = new Map([['broken.html', defective]])
    const { ctx } = await setup({}, fakeFs(files))

    const result = await call(ctx, { path: 'broken.html' })
    expect(result.isError).toBe(false)
    expect(firstText(result)).toContain('1 document issue(s)')
    expect(firstText(result)).toContain('duplicate id "a"')
    // A checked-but-defective file still renders; the meta carries the bytes.
    expect(result.meta).toMatchObject({ title: 'broken', height: 480 })
  })

  it('resolves paths under the calling session working directory', async () => {
    const seen: Array<{ cwd?: string }> = []
    const fs = {
      resolve: async (path: string, opts?: { cwd?: string }) => {
        seen.push({ cwd: opts?.cwd })
        return { displayPath: path }
      },
      stat: async () => ({ type: 'file' }),
      readText: async () => DOC,
    }
    const { ctx } = await setup({}, fs)

    await call(ctx, { path: 'report.html' })
    expect(seen).toEqual([{ cwd: undefined }])
  })
})
