/**
 * Model-facing Consumer of the streaming inline HTML presentation: the
 * `visualizer` tool. The model passes the complete self-contained document
 * as the `html` argument — last in the schema, so the browser card
 * (`@deepseek-ai/dsh-client-ui-generativeui`) can decode a growing prefix of
 * the streamed call arguments and paint a live preview while the model is
 * still writing. Nothing touches the workspace: the document's durable home
 * is the logged `tool/call` arguments themselves, so a replayed transcript
 * re-renders the panel without re-running anything, and the card offers a
 * client-side download of the settled document. A document that must persist
 * as a workspace file uses `write` plus `show_html` instead.
 *
 * @module @deepseek-ai/dsh-tool-generativeui
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'tool-generativeui'
export const inject = ['tools', 'systemPrompt']

/* jscpd:ignore-start — the frame bounds and Config surface are the shared
   show_html presentation constants; the tools differ in carriage, not limits. */
/** Byte length of one rendered document; bounds session-log growth per call. */
const DEFAULT_MAX_HTML_BYTES = 262_144
/** Frame viewport bounds and default, in pixels; presentation invariants, not deployment choices. */
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
    text: 'To present an HTML page in the chat, call visualizer with the complete self-contained document as the html argument, html last; the document streams into a sandboxed frame while you write. Use write plus show_html instead when the document must persist as a workspace file.',
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
          + 'The frame renders on a transparent canvas over the chat background, so the page feels inline in the conversation: do not set page or body backgrounds unless the user asks for a specific background or theme.',
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
}
