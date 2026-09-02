// @vitest-environment node
import { mkdtemp, readFile, readdir, rm, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context, Service } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as visualizer from '../src/index.ts'
import { PARTIAL_WRITE_INTERVAL_MS } from '../src/export-fanout.ts'
import { EXPORTS_BOOT_GLOBAL, EXPORTS_ROUTE_PATH, exportFileBase, exportShareName, partialFileName } from '../src/shared/export-name.ts'

/**
 * Minimal stand-in for the harness web server's route registry: the same
 * `register` contract `@deepseek-ai/dsh-host-webserver` provides, collecting
 * routes for direct handler tests instead of binding a socket.
 */
class FakeWebServer extends Service {
  readonly routes: { kind: string; path: string; handler: (req: IncomingMessage, res: ServerResponse) => unknown }[] = []

  constructor(ctx: Context) {
    super(ctx, 'webServer')
  }

  register(route: { kind: string; path: string; handler: (req: IncomingMessage, res: ServerResponse) => unknown }): () => void {
    this.routes.push(route)
    return () => {
      const at = this.routes.indexOf(route as FakeWebServer['routes'][number])
      if (at >= 0) this.routes.splice(at, 1)
    }
  }
}

/** One mounted fanout's handles. */
interface Harness {
  ctx: Context
  dir: string
  server: FakeWebServer
}

async function setup(config: Record<string, unknown> = {}): Promise<Harness> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-visualizer-exports-'))
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(FakeWebServer)
  await ctx.plugin(visualizer, { artifactDir: dir, ...config })
  const server = ctx.get('webServer') as FakeWebServer
  // The webServer-injected sub-fiber activates on its own microtask chain;
  // a disabled feature registers no route to wait for.
  if (config.shareArtifacts !== false) {
    for (let i = 0; i < 100 && server.routes.length === 0; i++) {
      await new Promise(resolve => { setTimeout(resolve, 2) })
    }
  } else {
    await new Promise(resolve => { setTimeout(resolve, 10) })
  }
  return { ctx, dir, server }
}

afterEach(async () => {
  vi.useRealTimers()
})

/** The session object the fanout keys its per-session state by; one identity for the whole suite, as in the harness. */
const session = { id: 's1' }

/** Loose-typed emit: the session firehose's typed declaration lives in dsh-session. */
function emitSession(ctx: Context, event: unknown): void {
  ;(ctx as unknown as { emit: (name: string, ...args: unknown[]) => void }).emit('session/event', session, event)
}

/** Let the fanout's serialized file chains drain. */
/** Let the fanout's serialized file chains drain: both event-loop phases, repeatedly. */
async function flush(): Promise<void> {
  for (let i = 0; i < 25; i++) {
    await new Promise(resolve => { setImmediate(resolve) })
    await new Promise(resolve => { setTimeout(resolve, 0) })
  }
}

function chunkEvent(chunk: unknown, turn = 1, step = 1): unknown {
  return { type: 'assistant/chunk', data: { turn, step, chunk } }
}

function delta(args: string, name?: string, callId = 'c1', index = 0): unknown {
  return chunkEvent({ type: 'tool-call-delta', index, id: callId, name, argumentsDelta: args })
}

function toolCallEvent(callId: unknown, name: string, args: string): unknown {
  return { type: 'tool/call', data: { turn: 1, step: 1, callId, name, arguments: args } }
}

function toolResultEvent(callId: string, error?: { name: string; code: string }): unknown {
  return {
    type: 'tool/result',
    data: { message: { content: [{ toolCallId: callId }] }, ...(error !== undefined ? { error } : {}) },
  }
}

/**
 * Split one call's complete argument JSON into stream-order delta fragments:
 * the head through the `html` value's opening quote, the escaped body in
 * chunks, then the closing quote and brace — the shape the model streams.
 */
function argumentDeltas(title: string | null, html: string, chunks: number): string[] {
  const doc = JSON.stringify({ ...(title !== null ? { title } : {}), html })
  const head = doc.slice(0, doc.indexOf(':"', doc.indexOf('"html"')) + 2)
  const body = doc.slice(head.length, doc.length - 2)
  const size = Math.max(1, Math.ceil(body.length / chunks))
  const parts: string[] = []
  for (let i = 0; i < body.length; i += size) parts.push(body.slice(i, i + size))
  return [head, ...parts, doc.slice(-2)]
}

async function readFileOrNull(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8')
  } catch {
    return null
  }
}

/** A minimal ServerResponse recording status, headers, and body. */
function fakeResponse(): ServerResponse & { status: number; headerMap: Record<string, string | number>; body: string } {
  const res = {
    status: 0,
    headerMap: {} as Record<string, string | number>,
    body: '',
    writeHead(code: number, headers?: Record<string, string | number>) {
      res.status = code
      Object.assign(res.headerMap, headers ?? {})
      return res
    },
    end(data?: unknown) {
      if (data !== undefined) res.body = typeof data === 'string' ? data : String(data)
      return res
    },
  }
  return res as unknown as ServerResponse & typeof res
}

async function request(harness: Harness, method: string, url: string): Promise<ReturnType<typeof fakeResponse>> {
  const route = harness.server.routes.find(entry => entry.path === EXPORTS_ROUTE_PATH)
  if (route === undefined) throw new Error('exports route was not registered')
  const res = fakeResponse()
  await route.handler({ method, url } as IncomingMessage, res)
  return res
}

/**
 * The request helper appends the capability token, learned the way the
 * browser half learns it: off the index-inject announcement the fanout
 * pushes at every emit.
 */
async function requestTokened(harness: Harness, method: string, url: string): Promise<ReturnType<typeof fakeResponse>> {
  const table: unknown[] = []
  ;(harness.ctx as unknown as { emit: (name: string, ...args: unknown[]) => void })
    .emit('webserver/index-inject', table)
  const token = (table[0] as { value: string }).value
  const joiner = url.includes('?') ? '&' : '?'
  return request(harness, method, `${url}${joiner}k=${encodeURIComponent(token)}`)
}

const DOC = '<!DOCTYPE html><html><body><h1>Revenue</h1></body></html>'

describe('export fanout', () => {
  it('mirrors the stream into a growing sidecar, then finalizes on tool/call', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(1_000_000)
    const harness = await setup()
    const args = JSON.stringify({ title: 'Dash', html: DOC })
    const [head, first, mid, last, tail] = argumentDeltas('Dash', DOC, 3)

    // The opening delta names the tool and carries the first body piece: the
    // sidecar appears with a partial document.
    emitSession(harness.ctx, delta((head ?? '') + (first ?? ''), 'visualizer'))
    await flush()
    let sidecar = await readFileOrNull(join(harness.dir, partialFileName('dash')))
    expect(sidecar).not.toBeNull()
    expect(sidecar!.length).toBeGreaterThan(0)
    expect(sidecar!.length).toBeLessThan(DOC.length)
    const afterFirst = sidecar!.length

    // A same-instant delta is coalesced by the throttle: content unchanged.
    emitSession(harness.ctx, delta(mid ?? ''))
    await flush()
    expect(await readFileOrNull(join(harness.dir, partialFileName('dash')))).toBe(sidecar)

    // Past the interval the next write grows the sidecar to the full document.
    vi.setSystemTime(Date.now() + PARTIAL_WRITE_INTERVAL_MS + 1)
    emitSession(harness.ctx, delta((last ?? '') + (tail ?? '')))
    await flush()
    sidecar = await readFileOrNull(join(harness.dir, partialFileName('dash')))
    expect(sidecar!.length).toBeGreaterThan(afterFirst)

    // The landed call finalizes: exact bytes under the final name, sidecar gone.
    emitSession(harness.ctx, toolCallEvent('c1', 'visualizer', args))
    await flush()
    expect(await readFileOrNull(join(harness.dir, exportShareName('Dash', DOC)))).toBe(DOC)
    expect(await readFileOrNull(join(harness.dir, partialFileName('dash')))).toBeNull()
  })

  it('writes an untitled document under the fallback name', async () => {
    const harness = await setup()
    emitSession(harness.ctx, toolCallEvent('c1', 'visualizer', JSON.stringify({ html: DOC })))
    await flush()
    expect(await readFileOrNull(join(harness.dir, exportShareName(null, DOC)))).toBe(DOC)
  })

  it('finalizes a bare SVG document under .svg', async () => {
    const harness = await setup()
    const svg = '<svg viewBox="0 0 10 10"><rect width="4" height="4"/></svg>'
    emitSession(harness.ctx, toolCallEvent('c1', 'visualizer', JSON.stringify({ title: 'Flow', html: svg })))
    await flush()
    expect(await readFileOrNull(join(harness.dir, exportShareName('Flow', svg)))).toBe(svg)
  })

  it('never finalizes an over-limit document', async () => {
    const harness = await setup({ maxArtifactBytes: 8 })
    emitSession(harness.ctx, toolCallEvent('c1', 'visualizer', JSON.stringify({ title: 'Big', html: DOC })))
    await flush()
    expect(await readFileOrNull(join(harness.dir, 'Big.html'))).toBeNull()
  })

  it('removes the export when the call errors', async () => {
    const harness = await setup()
    // A streamed sidecar of a failing call is removed by the error result.
    const [head, first] = argumentDeltas('Bad', DOC, 1)
    emitSession(harness.ctx, delta((head ?? '') + (first ?? ''), 'visualizer', 'c2'))
    await flush()
    expect(await readFileOrNull(join(harness.dir, partialFileName('bad')))).not.toBeNull()
    emitSession(harness.ctx, toolResultEvent('c2', { name: 'Error', code: 'E_TOOL' }))
    await flush()
    expect(await readFileOrNull(join(harness.dir, partialFileName('bad')))).toBeNull()

    // A landed call's finalized file is likewise removed by its error result.
    emitSession(harness.ctx, toolCallEvent('c1', 'visualizer', JSON.stringify({ title: 'Dash', html: DOC })))
    await flush()
    expect(await readFileOrNull(join(harness.dir, exportShareName('Dash', DOC)))).not.toBeNull()
    emitSession(harness.ctx, toolResultEvent('c1', { name: 'Error', code: 'E_TOOL' }))
    await flush()
    expect(await readFileOrNull(join(harness.dir, exportShareName('Dash', DOC)))).toBeNull()
  })

  it('keeps a later call\'s distinct export when an earlier same-title call errors', async () => {
    const harness = await setup()
    emitSession(harness.ctx, toolCallEvent('c1', 'visualizer', JSON.stringify({ title: 'Dash', html: DOC })))
    await flush()
    const rewritten = '<!DOCTYPE html><html><body><h1>v2</h1></body></html>'
    emitSession(harness.ctx, toolCallEvent('c2', 'visualizer', JSON.stringify({ title: 'Dash', html: rewritten })))
    await flush()
    // Digest-keyed names: different bytes land under different files, and
    // c1's late error removes only c1's own export, never c2's.
    emitSession(harness.ctx, toolResultEvent('c1', { name: 'Error', code: 'E_TOOL' }))
    await flush()
    expect(await readFileOrNull(join(harness.dir, exportShareName('Dash', DOC)))).toBeNull()
    expect(await readFileOrNull(join(harness.dir, exportShareName('Dash', rewritten)))).toBe(rewritten)
  })

  it('drops interrupted partials and resets cleanly on llm/retry', async () => {
    const harness = await setup()
    const [head, first] = argumentDeltas('Dash', DOC, 2)

    // An interrupted step never dispatches: its sidecar is residue and removed.
    emitSession(harness.ctx, delta((head ?? '') + (first ?? ''), 'visualizer'))
    await flush()
    expect(await readFileOrNull(join(harness.dir, partialFileName('dash')))).not.toBeNull()
    emitSession(harness.ctx, {
      type: 'assistant/message',
      data: { turn: 1, step: 1, message: { content: [] }, interrupted: true },
    })
    await flush()
    expect(await readFileOrNull(join(harness.dir, partialFileName('dash')))).toBeNull()

    // A retried request resets the step; the retry's stream and finalize work.
    emitSession(harness.ctx, delta((head ?? '') + (first ?? ''), 'visualizer'))
    await flush()
    expect(await readFileOrNull(join(harness.dir, partialFileName('dash')))).not.toBeNull()
    emitSession(harness.ctx, {
      type: 'llm/retry',
      data: { turn: 1, step: 1, retryId: 'r1', provider: 'p', mode: 'normal', policyKey: 'k', retry: 1, maxRetries: 3, delayMs: 10, failure: { name: 'Error', code: 'E_LLM' } },
    })
    await flush()
    expect(await readFileOrNull(join(harness.dir, partialFileName('dash')))).toBeNull()

    emitSession(harness.ctx, toolCallEvent('c9', 'visualizer', JSON.stringify({ title: 'Dash', html: DOC })))
    await flush()
    expect(await readFileOrNull(join(harness.dir, exportShareName('Dash', DOC)))).toBe(DOC)
  })

  it('ignores other tools entirely', async () => {
    const harness = await setup()
    emitSession(harness.ctx, delta('{"command":"ls"}', 'bash', 'c1'))
    emitSession(harness.ctx, toolCallEvent('c1', 'bash', '{"command":"ls"}'))
    await flush()
    expect(await readdir(harness.dir)).toEqual([])
  })

  it('stays entirely dormant when the config disables exports', async () => {
    const harness = await setup({ shareArtifacts: false })
    emitSession(harness.ctx, toolCallEvent('c1', 'visualizer', JSON.stringify({ title: 'Dash', html: DOC })))
    await flush()
    // No route serves anything and no file lands: one flag gates the feature.
    expect(harness.server.routes).toEqual([])
    expect(await readdir(harness.dir)).toEqual([])
  })

  it('announces the share page on the boot injection table, only while enabled', async () => {
    const enabled = await setup()
    const table: unknown[] = []
    ;(enabled.ctx as unknown as { emit: (name: string, ...args: unknown[]) => void })
      .emit('webserver/index-inject', table)
    // The announcement carries the boot capability token, not a bare flag.
    expect(table).toHaveLength(1)
    const row = table[0] as { kind: string; name: string; value: unknown }
    expect(row.kind).toBe('global')
    expect(row.name).toBe(EXPORTS_BOOT_GLOBAL)
    expect(typeof row.value).toBe('string')
    expect((row.value as string).length).toBeGreaterThan(15)

    const disabled = await setup({ shareArtifacts: false })
    const empty: unknown[] = []
    ;(disabled.ctx as unknown as { emit: (name: string, ...args: unknown[]) => void })
      .emit('webserver/index-inject', empty)
    expect(empty).toEqual([])
  })
})

describe('exports serve route', () => {
  async function landed(title: string, html: string, extra: Record<string, unknown> = {}): Promise<Harness> {
    const harness = await setup(extra)
    emitSession(harness.ctx, toolCallEvent('c1', 'visualizer', JSON.stringify({ title, html })))
    await flush()
    return harness
  }

  it('serves a finalized export with the shell CSP and hardening headers', async () => {
    const harness = await landed('Dash', DOC)
    const res = await requestTokened(harness, 'GET', `${EXPORTS_ROUTE_PATH}/${encodeURIComponent(exportShareName('Dash', DOC))}`)
    expect(res.status).toBe(200)
    expect(res.headerMap['content-type']).toBe('text/html; charset=utf-8')
    // The wrapper embeds the document verbatim (once-attribute-escaped), and
    // frames it sandboxed: generated scripts run in an opaque origin.
    expect(res.body).toContain('sandbox="allow-scripts"')
    expect(res.body).toContain(`srcdoc="${DOC.replaceAll('&', '&amp;')}`.slice(0, 60))
    expect(res.body).toContain(`<title>${exportShareName('Dash', DOC).slice(0, -'.html'.length)}</title>`)
    expect(res.headerMap['x-content-type-options']).toBe('nosniff')
    // The page content mutates under one name (latest wins), so never cached:
    expect(res.headerMap['cache-control']).toBe('no-store')
    const csp = String(res.headerMap['content-security-policy'])
    expect(csp).toContain('esm.sh')
    expect(csp).toContain("object-src 'none'")
    expect(res.headerMap['referrer-policy']).toBe('no-referrer')
    expect(res.headerMap['x-frame-options']).toBe('DENY')
    expect(res.headerMap['cross-origin-resource-policy']).toBe('same-origin')
    expect(String(res.headerMap['permissions-policy'])).toContain('camera=()')
  })

  it('wraps a document whose bytes carry quotes and ampersands, escaping once', async () => {
    const doc = '<!DOCTYPE html><html><body data-x="a&amp;b">42</body></html>'
    const harness = await landed('Tick & Tock', doc)
    const res = await requestTokened(harness, 'GET', `${EXPORTS_ROUTE_PATH}/${encodeURIComponent(exportShareName('Tick & Tock', doc))}`)
    expect(res.status).toBe(200)
    // `&` → `&amp;`, `"` → `&quot;`: attribute-safe exactly one level deep,
    // the srcdoc parser undoes it into the original bytes.
    expect(res.body).toContain(`<title>${exportShareName('Tick & Tock', doc).slice(0, -'.html'.length).replaceAll('&', '&amp;')}</title>`)
    expect(res.body).toContain(`srcdoc="${doc.replaceAll('&', '&amp;').replaceAll('"', '&quot;')}"`)
  })

  it('keeps the hardening headers on every answer class', async () => {
    const harness = await landed('Dash', DOC)
    const answers = [
      await requestTokened(harness, 'GET', `${EXPORTS_ROUTE_PATH}/${encodeURIComponent(exportShareName('Dash', DOC))}`),
      await requestTokened(harness, 'GET', `${EXPORTS_ROUTE_PATH}/missing.html`),
      await requestTokened(harness, 'POST', `${EXPORTS_ROUTE_PATH}/Dash.html`),
    ]
    for (const res of answers) {
      expect(res.headerMap['cache-control']).toBe('no-store')
      expect(res.headerMap['x-content-type-options']).toBe('nosniff')
      expect(res.headerMap['referrer-policy']).toBe('no-referrer')
      expect(res.headerMap['x-frame-options']).toBe('DENY')
      expect(res.headerMap['cross-origin-resource-policy']).toBe('same-origin')
      expect(res.headerMap['permissions-policy']).toBeDefined()
      expect(res.headerMap['content-security-policy']).toBeDefined()
    }
    // The hardening fields are byte-identical across status classes; only
    // status, allow, content-type, and length vary.
    const hardened = (res: ReturnType<typeof fakeResponse>): string =>
      JSON.stringify({ csp: res.headerMap['content-security-policy'], cc: res.headerMap['cache-control'], nosniff: res.headerMap['x-content-type-options'], rp: res.headerMap['referrer-policy'], xfo: res.headerMap['x-frame-options'], corp: res.headerMap['cross-origin-resource-policy'], pp: res.headerMap['permissions-policy'] })
    expect(hardened(answers[0]!)).toBe(hardened(answers[1]!))
    expect(hardened(answers[1]!)).toBe(hardened(answers[2]!))
    expect(answers[2]!.headerMap.allow).toBe('GET, HEAD')
  })

  it('refuses a symlink planted in the exports directory like any unknown name', async () => {
    const harness = await setup()
    const { symlink, writeFile: writeFileRaw } = await import('node:fs/promises')
    await writeFileRaw(join(harness.dir, 'outside-secret.txt'), 'stolen bytes')
    await symlink(join(harness.dir, 'outside-secret.txt'), join(harness.dir, 'Planted.html'))
    emitSession(harness.ctx, toolCallEvent('c1', 'visualizer', JSON.stringify({ title: 'Real', html: DOC })))
    await flush()
    const res = await requestTokened(harness, 'GET', `${EXPORTS_ROUTE_PATH}/Planted.html`)
    expect(res.status).toBe(404)
    expect(res.body).not.toContain('stolen bytes')
    expect(res.body).toContain('No exported visualizer document')
  })

  it('serves a unicode title under its encoded name', async () => {
    const harness = await landed('中文 图表', DOC)
    const res = await requestTokened(harness, 'GET', `${EXPORTS_ROUTE_PATH}/${encodeURIComponent(exportShareName('中文 图表', DOC))}`)
    expect(res.status).toBe(200)
    // HTML answers are the wrapper page; the document rides inside escaped.
    expect(res.body).toContain(`srcdoc="${DOC.replaceAll('&', '&amp;')}`.slice(0, 60))
    expect(res.body).toContain(`<title>${exportShareName('中文 图表', DOC).slice(0, -'.html'.length)}</title>`)
  })

  it('serves a bare SVG raw with scripting stripped from its policy', async () => {
    const SVG_DOC = '<svg viewBox="0 0 10 10"><rect/></svg>'
    const harness = await landed('Flow', SVG_DOC)
    const url = `${EXPORTS_ROUTE_PATH}/${encodeURIComponent(exportShareName('Flow', '<svg viewBox="0 0 10 10"><rect/></svg>'))}`
    // Raw bytes stay hotlinkable as an image; the policy alone drops script.
    const res = await requestTokened(harness, 'GET', url)
    expect(res.status).toBe(200)
    expect(res.headerMap['content-type']).toBe('image/svg+xml')
    expect(res.body).toBe(SVG_DOC)
    const csp = String(res.headerMap['content-security-policy'])
    expect(csp).toContain("script-src 'none'")
    // Script sources are gone; the fetch directives stay for image/data use.
    expect(csp).not.toMatch(/script-src[^;]*esm\.sh/)
    expect(csp).toContain("object-src 'none'")
    // HEAD keeps the same headers with an empty body.
    const head = await requestTokened(harness, 'HEAD', url)
    expect(head.headerMap['content-type']).toBe('image/svg+xml')
    expect(head.body).toBe('')
  })

  it('answers 404 for missing, partial, and traversal names', async () => {
    const harness = await landed('Dash', DOC)
    const urls = [
      `${EXPORTS_ROUTE_PATH}/missing.html`,
      `${EXPORTS_ROUTE_PATH}/Dash.partial`,
      `${EXPORTS_ROUTE_PATH}/..%2Fsecret.html`,
      `${EXPORTS_ROUTE_PATH}/nested/Dash.html`,
      `${EXPORTS_ROUTE_PATH}/`,
      `${EXPORTS_ROUTE_PATH}/Dash.txt`,
    ]
    for (const url of urls) {
      const res = await requestTokened(harness, 'GET', url)
      expect(res.status, url).toBe(404)
      expect(res.headerMap['content-type']).toBe('text/html; charset=utf-8')
    }
  })

  it('refuses requests without or with a wrong capability token', async () => {
    const harness = await landed('Dash', DOC)
    const url = `${EXPORTS_ROUTE_PATH}/${encodeURIComponent(exportShareName('Dash', DOC))}`
    for (const bad of [url, `${url}?k=wrong`, `${url}?k=`]) {
      const res = await request(harness, 'GET', bad)
      expect(res.status, bad).toBe(404)
      // The gate never distinguishes a bad token from a missing file.
      expect(res.body).toContain('No exported visualizer document')
    }
    const good = await requestTokened(harness, 'GET', url)
    expect(good.status).toBe(200)
  })

  it('announces a fresh token each boot, so old links stop working', async () => {
    const first = await setup()
    const second = await setup()
    const read = (harness: Harness): string => {
      const table: unknown[] = []
      ;(harness.ctx as unknown as { emit: (name: string, ...args: unknown[]) => void })
        .emit('webserver/index-inject', table)
      return (table[0] as { value: string }).value
    }
    const a = read(first)
    const b = read(second)
    expect(a).not.toBe(b)
  })

  it('sweeps artifacts past the retention window at activation and keeps fresh ones', async () => {
    // The sweep runs once when the fanout mounts, so the files must exist
    // before the plugin does: age two entries (one servable, one stray) and
    // leave one fresh, then mount and read the survivors.
    const dir = await mkdtemp(join(tmpdir(), 'dsh-visualizer-exports-'))
    const aged = new Date(Date.now() - 40 * 86_400_000)
    await writeFile(join(dir, 'aged-dash.html'), '<p>old</p>')
    await writeFile(join(dir, 'fresh-dash.html'), '<p>new</p>')
    await writeFile(join(dir, 'aged.partial'), '<p>stray</p>')
    await utimes(join(dir, 'aged-dash.html'), aged, aged)
    await utimes(join(dir, 'aged.partial'), aged, aged)

    const harness = await setup({ artifactDir: dir, artifactRetentionDays: 30 })
    await flush()
    expect(await readFileOrNull(join(dir, 'aged-dash.html'))).toBeNull()
    expect(await readFileOrNull(join(dir, 'fresh-dash.html'))).toBe('<p>new</p>')
    // Sidecars never pass the servable-name check; the sweep leaves them.
    expect(await readFileOrNull(join(dir, 'aged.partial'))).toBe('<p>stray</p>')
  })

  it('pins the announced key to a configured shareKey and serves under it', async () => {
    const harness = await setup({ shareKey: 'my-stable-shared-key-01' })
    const table: unknown[] = []
    ;(harness.ctx as unknown as { emit: (name: string, ...args: unknown[]) => void })
      .emit('webserver/index-inject', table)
    expect((table[0] as { value: string }).value).toBe('my-stable-shared-key-01')

    // A link from "before the restart" — a second mount with the same key —
    // keeps working: same key, same name, still served.
    const reborn = await setup({ shareKey: 'my-stable-shared-key-01' })
    emitSession(reborn.ctx, toolCallEvent('c1', 'visualizer', JSON.stringify({ title: 'Dash', html: DOC })))
    await flush()
    const route = reborn.server.routes.find(entry => entry.path === EXPORTS_ROUTE_PATH)
    if (route === undefined) throw new Error('exports route was not registered')
    const res = fakeResponse()
    await route.handler({
      method: 'GET',
      url: `${EXPORTS_ROUTE_PATH}/${encodeURIComponent(exportShareName('Dash', DOC))}?k=${encodeURIComponent('my-stable-shared-key-01')}`,
    } as IncomingMessage, res)
    expect(res.status).toBe(200)
    expect(res.body).toContain('sandbox="allow-scripts"')
  })

  it('answers 405 with the method table for anything but GET and HEAD', async () => {
    const harness = await landed('Dash', DOC)
    const res = await requestTokened(harness, 'POST', `${EXPORTS_ROUTE_PATH}/${encodeURIComponent(exportShareName('Dash', DOC))}`)
    expect(res.status).toBe(405)
    expect(res.headerMap.allow).toBe('GET, HEAD')
  })
})

// Keep rm referenced for suite-local cleanup of a setup dir when needed.
void rm
