/**
 * Model-facing Consumer of the streaming inline HTML presentation: the
 * `visualizer` tool. The model passes the complete self-contained document
 * as the `html` argument — last in the schema, so this package's browser
 * half (`./client`) can decode a growing prefix of
 * the streamed call arguments and paint a live preview while the model is
 * still writing. Nothing touches the workspace: the document's durable home
 * is the logged `tool/call` arguments themselves, so a replayed transcript
 * re-renders the panel without re-running anything, and the card offers a
 * client-side download of the settled document.
 *
 * @module dsh-visualizer
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
// Type-side-effect import: pulls the systemPrompt Context augmentation so the
// injected service member type-checks without the harness-wide program.
import type {} from '@deepseek-ai/dsh-system-prompt'
import { composeGuideText, composeModuleDetail, GUIDE_MODULE_IDS } from './guide/index.ts'
import type { GuideModule } from './guide/index.ts'
import { inspectDocument } from './inspect.ts'

export const name = 'visualizer'
export const inject = ['tools', 'systemPrompt']

/* jscpd:ignore-start — the frame bounds and Config surface are duplicated by
   design across the package's two planes; see the mirrored copies in
   src/client/ResultRow.tsx. */
/** Byte length of one rendered document; bounds session-log growth per call. */
const DEFAULT_MAX_HTML_BYTES = 262_144
/**
 * Frame viewport bounds and default, in pixels; presentation invariants, not
 * deployment choices. Mirrored by src/client/ResultRow.tsx — the client
 * bundle cannot import this half, so a change here must land there too.
 */
const MIN_FRAME_HEIGHT_PX = 50
const MAX_FRAME_HEIGHT_PX = 2_000
const DEFAULT_FRAME_HEIGHT_PX = 480

/** Plugin configuration after schemastery fills defaults. */
export interface Config {
  /** Largest document one call renders, in UTF-8 bytes. */
  maxHtmlBytes: number
  /** Whether the `visualizer_guide` spec-pull tool registers at all. */
  guideTool: boolean
  /** Artifact types the guide teaches and the guide tool serves. */
  guideModules: string[]
}

export const Config: z<Config> = z.object({
  maxHtmlBytes: z.number().default(DEFAULT_MAX_HTML_BYTES),
  guideTool: z.boolean().default(true),
  guideModules: z.array(z.string()).default([...GUIDE_MODULE_IDS]),
})

/** The shape after schemastery applied the defaults. */
type ResolvedConfig = Required<Config>
/* jscpd:ignore-end */

const encoder = new TextEncoder()

/** Canonical result fields; the model sees only these plus the rendered text. */
interface RenderHtmlResult {
  title: string
  bytes: number
  height: number
  /** Settle-time document check findings, one string per defect; empty when clean. */
  issues: string[]
}
/** Result of one guide lookup; `text` is the model-visible recipe. */
interface GuideResult {
  modules: string[]
  text: string
}

/** Most inspection findings listed in one result; the rest collapse to a count. */
const MAX_REPORTED_ISSUES = 6

/** Most loading messages the tool accepts. */
const MAX_LOADING_MESSAGES = 4

/**
 * Panel title for a document: the explicit `title` argument, else a fixed
 * generic name — the streamed call has no path to derive a name from.
 * @param explicitTitle - the call's optional `title` argument.
 * @returns the panel title.
 */
function deriveTitle(explicitTitle: string | undefined): string {
  if (explicitTitle === undefined) return 'HTML'
  const trimmed = explicitTitle.trim()
  if (trimmed.length === 0) throw new Error('title must be a non-empty string')
  return trimmed
}

/**
 * Project one render result into its model-visible text: the base line
 * every result carries, then the document check verdict. A clean document
 * says so; a defective one lists its findings with the re-render
 * instruction, so the correction happens in the same turn.
 * @param value - the canonical result of the call.
 * @returns the rendered text block content.
 */
function renderResultText(value: RenderHtmlResult): string {
  const base = `Rendered ${value.title} (${value.bytes} bytes, ${value.height}px frame)`
  const issues = value.issues ?? []
  if (issues.length === 0) return `${base}; document check passed.`
  const shown = issues.slice(0, MAX_REPORTED_ISSUES)
  const hidden = issues.length - shown.length
  const list = shown.map(issue => `- ${issue}`).join('\n')
  const tail = hidden > 0 ? `\n- …and ${hidden} more` : ''
  return `${base}; ${issues.length} document issue(s) — fix and re-render the corrected document in this turn:\n${list}${tail}`
}

/**
 * Validate the configured module set at load: unknown ids and an empty set
 * are deployment mistakes, not runtime conditions.
 * @param requested - the raw `guideModules` config value.
 * @returns the enabled ids in roster order, duplicates collapsed.
 */
function validateGuideModules(requested: readonly string[]): GuideModule[] {
  const unknown = [...new Set(requested)].filter(id => !GUIDE_MODULE_IDS.includes(id as GuideModule))
  if (unknown.length > 0) {
    throw new Error(`config guideModules lists unknown artifact type(s) ${unknown.join(', ')}; known types: ${GUIDE_MODULE_IDS.join(', ')}`)
  }
  const enabled = GUIDE_MODULE_IDS.filter(id => requested.includes(id))
  if (enabled.length === 0) throw new Error('config guideModules must list at least one artifact type')
  return enabled
}

/**
 * Register the `visualizer` render tool, the `visualizer_guide` spec-pull
 * tool, and the prompt guidance they share.
 * @param ctx - Cordis context carrying the tools registry.
 * @param config - resolved plugin configuration.
 */
export function apply(ctx: Context, config: ResolvedConfig): void {
  const modules = validateGuideModules(config.guideModules)
  ctx.systemPrompt.section({
    name: 'tool:visualizer',
    order: 100,
    text: composeGuideText(modules, config.guideTool),
  })

  ctx.tools.register(defineTool({
    name: 'visualizer',
    description: 'Render one self-contained HTML document inline in the chat window, streamed live as you write. '
      + 'Pass the complete document — styles and scripts inline or from public CDNs — as the html argument, with html as the LAST parameter so the preview can stream while you write; do not write the document to a file first. '
      + 'It is displayed in a sandboxed frame on the tool card. '
      + 'Use this to present a UI mockup, chart, or interactive artifact. '
      + 'The result carries a static document check; when it lists issues, fix them and re-render the corrected document before finishing your turn.',
    parameters: {
      title: { type: 'string', description: 'Panel title shown on the card.' },
      height: {
        type: 'number',
        description: `Opening frame height in pixels (${MIN_FRAME_HEIGHT_PX}–${MAX_FRAME_HEIGHT_PX}); the frame then grows with its content. Defaults to ${DEFAULT_FRAME_HEIGHT_PX}.`,
      },
      loadingMessages: {
        type: 'array',
        items: { type: 'string' },
        description: '1–4 messages (~5 words each, in the user\'s language) shown while the document streams; the tool card cycles through them on a fixed dwell. Plain messages for serious topics (illness, war, grief — if you have to ask, it is), playful ones otherwise. Write them in the guide\'s loading-messages contract.',
      },
      html: {
        type: 'string',
        required: true,
        description: 'The complete HTML document, placed last in the call so it streams into the preview while you write. '
          + 'The transparent-canvas and streaming-order rules are in the visualizer guide.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          title: { type: 'string', required: true },
          bytes: { type: 'number', required: true },
          height: { type: 'number', required: true },
          issues: { type: 'array', items: { type: 'string' } },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: renderResultText(value as RenderHtmlResult),
      }],
    },
    execute(args): Promise<RenderHtmlResult> {
      const title = deriveTitle(args.title)
      const height = args.height ?? DEFAULT_FRAME_HEIGHT_PX
      if (args.loadingMessages !== undefined
        && (!Array.isArray(args.loadingMessages) || args.loadingMessages.length < 1 || args.loadingMessages.length > MAX_LOADING_MESSAGES
          || args.loadingMessages.some(m => typeof m !== 'string' || m.trim().length === 0))) {
        throw new Error(`loadingMessages must be 1-${MAX_LOADING_MESSAGES} non-empty strings`)
      }
      if (!Number.isInteger(height) || height < MIN_FRAME_HEIGHT_PX || height > MAX_FRAME_HEIGHT_PX) {
        throw new Error(`height must be an integer between ${MIN_FRAME_HEIGHT_PX} and ${MAX_FRAME_HEIGHT_PX}`)
      }
      if (typeof args.html !== 'string' || args.html.trim().length === 0) {
        throw new Error('html must be a non-empty document')
      }
      const bytes = encoder.encode(args.html).byteLength
      if (bytes > config.maxHtmlBytes) {
        throw new Error(`the document is ${bytes} bytes, over the ${config.maxHtmlBytes}-byte render limit`)
      }
      const issues = inspectDocument(args.html).issues
        .map(issue => `line ${issue.line}: ${issue.message}`)
      return Promise.resolve({ title, bytes, height, issues })
    },
  }))

  if (!config.guideTool) return

  ctx.tools.register(defineTool({
    name: 'visualizer_guide',
    description: 'Pull the detailed authoring recipe for one or more visualizer artifact types '
      + `(${modules.join(', ')}) just before you render one. `
      + 'The system prompt carries the gate rules, the universal contract, and the one-line roster; this returns the deeper per-type recipe. '
      + 'Call it once per document, when you have chosen the type.',
    parameters: {
      modules: {
        type: 'array',
        items: { type: 'string', enum: [...modules] },
        required: true,
        description: 'Artifact types to pull the recipe for; at least one.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          modules: { type: 'array', items: { type: 'string' }, required: true },
          text: { type: 'string', required: true },
        },
      },
      render: (_args, value) => [{ type: 'text', text: (value as GuideResult).text }],
    },
    execute(args): Promise<GuideResult> {
      const requested = args.modules
      if (!Array.isArray(requested) || requested.length === 0 || requested.some(m => typeof m !== 'string')) {
        throw new Error('modules must be a non-empty array of artifact types')
      }
      return Promise.resolve({ modules: requested, text: composeModuleDetail(requested, modules) })
    },
  }))
}
