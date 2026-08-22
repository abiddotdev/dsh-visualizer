/**
 * Model-facing Consumer of the streaming inline HTML presentation: the
 * `visualizer` tool. The model passes the complete self-contained document
 * as the `html` argument — last in the schema, so this package's browser
 * half (`./client`) can decode a growing prefix of
 * the streamed call arguments and paint a live preview while the model is
 * still writing. Nothing touches the workspace: the document's durable home
 * is the logged `tool/call` arguments themselves, so a replayed transcript
 * re-renders the panel without re-running anything, and the card offers a
 * client-side download of the settled document. A document that must persist
 * as a workspace file uses `write` plus `show_html` instead.
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

export const name = 'visualizer'
export const inject = ['tools', 'systemPrompt']

/* jscpd:ignore-start — the frame bounds and Config surface are the shared
   show_html presentation constants; the tools differ in carriage, not limits. */
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
}

export const Config: z<Config> = z.object({
  maxHtmlBytes: z.number().default(DEFAULT_MAX_HTML_BYTES),
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
}

/** Result of one guide lookup; `text` is the model-visible recipe. */
interface GuideResult {
  modules: string[]
  text: string
}

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
 * Register the `visualizer` tool and its prompt guidance.
 * @param ctx - Cordis context carrying the tools registry.
 * @param config - resolved plugin configuration.
 */
export function apply(ctx: Context, config: ResolvedConfig): void {
  ctx.systemPrompt.section({
    name: 'tool:visualizer',
    order: 100,
    text: composeGuideText(),
  })

  ctx.tools.register(defineTool({
    name: 'visualizer',
    description: 'Render one self-contained HTML document inline in the chat window, streamed live as you write. '
      + 'Pass the complete document — styles and scripts inline or from public CDNs — as the html argument, with html as the LAST parameter so the preview can stream while you write; do not write the document to a file first. '
      + 'It is displayed in a sandboxed frame on the tool card. '
      + 'Use this to present a UI mockup, chart, or interactive artifact.',
    parameters: {
      title: { type: 'string', description: 'Panel title shown on the card.' },
      height: {
        type: 'number',
        description: `Opening frame height in pixels (${MIN_FRAME_HEIGHT_PX}–${MAX_FRAME_HEIGHT_PX}); the frame then grows with its content. Defaults to ${DEFAULT_FRAME_HEIGHT_PX}.`,
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
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `Rendered ${value.title} (${value.bytes} bytes, ${value.height}px frame)`,
      }],
    },
    execute(args): Promise<RenderHtmlResult> {
      const title = deriveTitle(args.title)
      const height = args.height ?? DEFAULT_FRAME_HEIGHT_PX
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
      return Promise.resolve({ title, bytes, height })
    },
  }))

  ctx.tools.register(defineTool({
    name: 'visualizer_guide',
    description: 'Pull the detailed authoring recipe for one or more visualizer artifact types '
      + `(${GUIDE_MODULE_IDS.join(', ')}) just before you render one. `
      + 'The system prompt carries the gate rules, the universal contract, and the one-line roster; this returns the deeper per-type recipe. '
      + 'Call it once per document, when you have chosen the type.',
    parameters: {
      modules: {
        type: 'array',
        items: { type: 'string', enum: [...GUIDE_MODULE_IDS] },
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
      const modules = args.modules
      if (!Array.isArray(modules) || modules.length === 0 || modules.some(m => typeof m !== 'string')) {
        throw new Error('modules must be a non-empty array of artifact types')
      }
      return Promise.resolve({ modules, text: composeModuleDetail(modules) })
    },
  }))
}
