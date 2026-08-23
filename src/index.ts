/**
 * Model-facing Consumer of the streaming inline HTML presentation: the
 * `visualizer` tool renders one self-contained document two ways. Inline
 * mode passes the complete document as the `html` argument — last in the
 * schema, so this package's browser half (`./client`) can decode a growing
 * prefix of the streamed call arguments and paint a live preview while the
 * model is still writing; the document's durable home is the logged
 * `tool/call` arguments themselves, so a replayed transcript re-renders the
 * panel without re-running anything. File mode passes a workspace file's
 * `path` instead: the tool loads it back through the harness filesystem
 * service — resolved lazily at call time, so a deployment that mounts no fs
 * service still gets inline streaming, and a path call there fails per call
 * with the html fallback named in the message. The loaded bytes return in
 * the result, whose presentation meta is the browser card's only logged
 * copy. Both modes settle with the same static document check, and the
 * settled card offers a client-side download either way.
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
  /**
   * File mode only: the display path the document loaded from and the bytes
   * themselves. The call arguments carry just the path, so the result's
   * presentation meta is the browser card's only logged copy of the
   * document; inline mode omits both fields because the streamed arguments
   * already hold it and a second copy would double every call's log cost.
   */
  path?: string
  html?: string
}

/**
 * Structural slice of the harness filesystem service (`ctx.fs`) that file
 * mode reads through, declared locally so this standalone plugin keeps no
 * build-time dependency on the fs capability package.
 */
interface FsTarget {
  /** Backend-rendered display form of the resolved path, used in results and errors. */
  displayPath: string
}

/** Structural slice of the metadata `fs.stat` returns. */
interface FsInfo {
  /** Target kind; file mode accepts only `'file'`. */
  type: string
}

/** Structural slice of the filesystem service this plugin consumes. */
interface FilesystemService {
  resolve(path: string, opts?: { cwd?: string; signal?: AbortSignal }): Promise<FsTarget>
  stat(target: FsTarget, signal?: AbortSignal): Promise<FsInfo | undefined>
  readText(target: FsTarget, signal?: AbortSignal): Promise<string>
}

/** Result of one guide lookup; `text` is the model-visible recipe. */
interface GuideResult {
  modules: string[]
  text: string
}

/** Most inspection findings listed in one result; the rest collapse to a count. */
const MAX_REPORTED_ISSUES = 6

/**
 * Panel title for a document: the explicit `title` argument, else the file
 * name without its `.html`/`.htm` suffix in file mode, else a fixed generic
 * name — an inline call has no path to derive a name from.
 * @param explicitTitle - the call's optional `title` argument.
 * @param rawPath - the call's `path` argument, when file mode.
 * @returns the panel title.
 */
function deriveTitle(explicitTitle: string | undefined, rawPath?: string): string {
  if (explicitTitle === undefined && rawPath !== undefined) {
    const base = rawPath.split(/[\\/]/).pop() ?? ''
    return base.replace(/\.html?$/i, '') || 'HTML'
  }
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
  const base = value.path !== undefined
    ? `Rendered ${value.title} (${value.bytes} bytes from ${value.path}, ${value.height}px frame)`
    : `Rendered ${value.title} (${value.bytes} bytes, ${value.height}px frame)`
  const issues = value.issues ?? []
  if (issues.length === 0) return `${base}; document check passed.`
  const shown = issues.slice(0, MAX_REPORTED_ISSUES)
  const hidden = issues.length - shown.length
  const list = shown.map(issue => `- ${issue}`).join('\n')
  const tail = hidden > 0 ? `\n- …and ${hidden} more` : ''
  return `${base}; ${issues.length} document issue(s) — fix and re-render the corrected document in this turn:\n${list}${tail}`
}

/**
 * Validate one document against the byte budget and run the settle-time
 * check, assembling the canonical result.
 * @param html - the complete document text.
 * @param title - the panel title.
 * @param height - the validated opening frame height.
 * @param maxBytes - the configured per-call render limit.
 * @param path - file mode's source path, carried into the result and meta.
 * @returns the canonical result.
 */
function checkedResult(
  html: string,
  title: string,
  height: number,
  maxBytes: number,
  path?: string,
): RenderHtmlResult {
  const bytes = encoder.encode(html).byteLength
  if (bytes > maxBytes) {
    throw new Error(`${path !== undefined ? `"${path}" is` : 'the document is'} ${bytes} bytes, over the ${maxBytes}-byte render limit`)
  }
  const issues = inspectDocument(html).issues
    .map(issue => `line ${issue.line}: ${issue.message}`)
  return path === undefined
    ? { title, bytes, height, issues }
    : { title, bytes, height, issues, path, html }
}

/**
 * Load one workspace document through the filesystem service and render it.
 * Resolve under the session working directory, require a regular non-empty
 * file inside the byte budget, then assemble the canonical result carrying
 * the bytes.
 * @param fs - the filesystem service from the context.
 * @param requestedPath - the call's trimmed `path` argument.
 * @param title - the panel title, already derived with `requestedPath`.
 * @param height - the validated opening frame height.
 * @param opts - session working directory and cancellation signal.
 * @param config - resolved plugin configuration.
 * @returns the canonical result including `path` and `html`.
 */
async function renderFromPath(
  fs: FilesystemService,
  requestedPath: string,
  title: string,
  height: number,
  opts: { cwd?: string; signal?: AbortSignal },
  config: ResolvedConfig,
): Promise<RenderHtmlResult> {
  const target = await fs.resolve(requestedPath, {
    ...(opts.cwd !== undefined ? { cwd: opts.cwd } : {}),
    ...(opts.signal !== undefined ? { signal: opts.signal } : {}),
  })
  const info = await fs.stat(target, opts.signal)
  if (info === undefined) throw new Error(`cannot render "${target.displayPath}": not found`)
  if (info.type !== 'file') throw new Error(`cannot render "${target.displayPath}": not a regular file`)
  const html = await fs.readText(target, opts.signal)
  if (html.length === 0) throw new Error(`cannot render "${target.displayPath}": the document is empty`)
  return checkedResult(html, title, height, config.maxHtmlBytes, target.displayPath)
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
    description: 'Render one self-contained HTML document inline in the chat window. '
      + 'Supply it one of two ways: pass the complete document — styles and scripts inline or from public CDNs — as the html argument, placed LAST so the preview streams live while you write; '
      + 'or first write the document to a workspace file with the write tool, then pass its path argument to load it from disk. '
      + 'Pass exactly one of html and path. '
      + 'It is displayed in a sandboxed frame on the tool card. '
      + 'Use this to present a UI mockup, chart, or interactive artifact. '
      + 'The result carries a static document check; when it lists issues, fix them and re-render the corrected document before finishing your turn.',
    parameters: {
      title: { type: 'string', description: 'Panel title shown on the card.' },
      height: {
        type: 'number',
        description: `Opening frame height in pixels (${MIN_FRAME_HEIGHT_PX}–${MAX_FRAME_HEIGHT_PX}); the frame then grows with its content. Defaults to ${DEFAULT_FRAME_HEIGHT_PX}.`,
      },
      path: {
        type: 'string',
        description: 'Workspace path of a complete .html document to load instead of streaming html, resolved by the filesystem backend.',
      },
      html: {
        type: 'string',
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
          path: { type: 'string' },
          html: { type: 'string' },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: renderResultText(value as RenderHtmlResult),
      }],
      // File mode only: the result is the browser card's only logged copy of
      // the document, so it projects onto the settled event's presentation
      // meta. Inline mode projects null — the streamed arguments already
      // carry the document, and a second copy would double every call's log
      // cost.
      presentationMeta: (_args, value) => {
        const v = value as RenderHtmlResult
        return v.html !== undefined && v.html.length > 0
          ? { title: v.title, html: v.html, height: v.height }
          : null
      },
    },
    execute(args, exec): Promise<RenderHtmlResult> {
      const height = args.height ?? DEFAULT_FRAME_HEIGHT_PX
      if (!Number.isInteger(height) || height < MIN_FRAME_HEIGHT_PX || height > MAX_FRAME_HEIGHT_PX) {
        throw new Error(`height must be an integer between ${MIN_FRAME_HEIGHT_PX} and ${MAX_FRAME_HEIGHT_PX}`)
      }
      const hasHtml = typeof args.html === 'string' && args.html.trim().length > 0
      const hasPath = typeof args.path === 'string' && args.path.trim().length > 0
      if (hasHtml && hasPath) throw new Error('pass either html or path, not both')
      if (!hasHtml && !hasPath) throw new Error('pass exactly one of html or path')
      if (hasPath) {
        const requestedPath = (args.path as string).trim()
        // Lazy by design: the plugin mounts on any deployment, and only a
        // path call on an fs-less one fails here — with the html fallback in
        // the message, so the turn recovers instead of the tool vanishing.
        let fs: FilesystemService | undefined
        try {
          fs = (ctx as Context & { fs?: FilesystemService }).fs
        } catch {
          // Cordis throws on reading a service nothing provides; that throw
          // IS this deployment's "absent", not an error to propagate.
          fs = undefined
        }
        if (fs === undefined) {
          throw new Error('no filesystem service is available in this deployment; pass the document as html instead of path')
        }
        return renderFromPath(fs, requestedPath, deriveTitle(args.title, requestedPath), height, {
          cwd: exec.agent?.session.header.cwd,
          signal: exec.signal,
        }, config)
      }
      return Promise.resolve(checkedResult(args.html as string, deriveTitle(args.title), height, config.maxHtmlBytes))
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
