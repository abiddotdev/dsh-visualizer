// @vitest-environment node
import { mkdtemp, readdir, readFile, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context, Service } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { Session } from '@deepseek-ai/dsh-session'
import { createToolResultMessage } from '@deepseek-ai/dsh-llm'
import * as visualizer from '../src/index.ts'
import { EXPORT_RATE_LIMIT } from '../src/export-fanout.ts'
import { EXPORTS_BOOT_GLOBAL, EXPORTS_ROUTE_PATH, exportShareName } from '../src/shared/export-name.ts'

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

/**
 * Minimal stand-in for the real `SessionStore`: a plain map of live sessions
 * a test seeds directly with real `Session` instances (see {@link seedCall}),
 * satisfying the exact `.get`/`.list` contract `resolveCallDocument` reads.
 */
class FakeSessions extends Service {
  readonly byId = new Map<string, Session>()

  constructor(ctx: Context) {
    super(ctx, 'sessions')
  }

  get(id: unknown): Session | undefined {
    return this.byId.get(String(id))
  }

  list(): Session[] {
    return [...this.byId.values()]
  }
}

/** One mounted route's handles. */
interface Harness {
  ctx: Context
  dir: string
  server: FakeWebServer
  sessions: FakeSessions
}

async function setup(config: Record<string, unknown> = {}): Promise<Harness> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-visualizer-exports-'))
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(FakeWebServer)
  await ctx.plugin(FakeSessions)
  await ctx.plugin(visualizer, { artifactDir: dir, ...config })
  const server = ctx.get('webServer') as FakeWebServer
  const sessions = ctx.get('sessions') as FakeSessions
  // The webServer/sessions-injected sub-fiber activates on its own microtask
  // chain; a disabled feature registers no route to wait for.
  if (config.shareArtifacts !== false) {
    for (let i = 0; i < 100 && server.routes.length === 0; i++) {
      await new Promise(resolve => { setTimeout(resolve, 2) })
    }
  } else {
    await new Promise(resolve => { setTimeout(resolve, 10) })
  }
  return { ctx, dir, server, sessions }
}

afterEach(async () => {
  vi.useRealTimers()
})

/**
 * Seed one settled `visualizer` call into a fresh live session — the exact
 * durable shape `resolveCallDocument` reads (see `export-fanout.ts`), built
 * with the real `Session.create` and `createToolResultMessage` rather than a
 * hand-rolled structural guess, so a shape drift in the real package would
 * fail these tests instead of silently passing against a stale mirror.
 * @param harness - the route harness whose fake session store to seed into.
 * @param callId - the call's identity.
 * @param name - the tool name; only `'visualizer'` calls resolve.
 * @param args - the raw JSON arguments string the call carried, or undefined
 * to seed the `tool/call` alone (an unsettled call, for negative tests).
 * @param error - when present, the call settled as this error instead of ok.
 */
function seedCall(
  harness: Harness, callId: string, name: string, args: string | undefined, error?: { name: string; code: string },
): void {
  const events: unknown[] = [
    { type: 'tool/call', seq: 0, time: 1, data: { turn: 1, step: 1, callId, name, arguments: args ?? '{}' } },
  ]
  if (args !== undefined) {
    const message = createToolResultMessage({
      callId: callId as never,
      content: [{ type: 'text', text: error !== undefined ? 'failed' : 'ok' }],
      isError: error !== undefined,
    })
    events.push({
      type: 'tool/result', seq: 1, time: 2, surfaceOp: 'append',
      data: { turn: 1, step: 1, message, ...(error !== undefined ? { error } : {}) },
    })
  }
  const sessionId = `session-${callId}`
  harness.sessions.byId.set(sessionId, Session.create(sessionId as never, events as never))
}

/** Seed and export one settled `visualizer` call in a single step, for tests whose focus is what happens after landing. */
async function exportSettled(harness: Harness, callId: string, title: string | null, html: string): Promise<ReturnType<typeof fakeResponse>> {
  seedCall(harness, callId, 'visualizer', JSON.stringify({ ...(title !== null ? { title } : {}), html }))
  return requestTokened(harness, 'POST', EXPORTS_ROUTE_PATH, { callId })
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

/**
 * A minimal `IncomingMessage` stand-in: `method`/`url` plus a readable-stream
 * face over an optional JSON body, delivered asynchronously like a real
 * socket so the route's own `req.on('data'|'end', …)` body reader exercises
 * unchanged.
 */
function fakeRequest(method: string, url: string, jsonBody?: unknown): IncomingMessage {
  const bytes = jsonBody === undefined ? Buffer.alloc(0) : Buffer.from(JSON.stringify(jsonBody), 'utf8')
  const listeners: Record<string, ((chunk?: Buffer) => void)[]> = {}
  const req = {
    method,
    url,
    on(event: string, cb: (chunk?: Buffer) => void) {
      (listeners[event] ??= []).push(cb)
      return req
    },
    destroy() { /* the fake never needs to abort mid-stream */ },
  }
  queueMicrotask(() => {
    for (const cb of listeners.data ?? []) cb(bytes)
    for (const cb of listeners.end ?? []) cb()
  })
  return req as unknown as IncomingMessage
}

async function request(harness: Harness, method: string, url: string, jsonBody?: unknown): Promise<ReturnType<typeof fakeResponse>> {
  const route = harness.server.routes.find(entry => entry.path === EXPORTS_ROUTE_PATH)
  if (route === undefined) throw new Error('exports route was not registered')
  const res = fakeResponse()
  await route.handler(fakeRequest(method, url, jsonBody), res)
  return res
}

/**
 * The request helper appends the capability token, learned the way the
 * browser half learns it: off the index-inject announcement the route
 * pushes at every emit.
 */
async function requestTokened(harness: Harness, method: string, url: string, jsonBody?: unknown): Promise<ReturnType<typeof fakeResponse>> {
  const table: unknown[] = []
  ;(harness.ctx as unknown as { emit: (name: string, ...args: unknown[]) => void })
    .emit('webserver/index-inject', table)
  const token = (table[0] as { value: string }).value
  const joiner = url.includes('?') ? '&' : '?'
  return request(harness, method, `${url}${joiner}k=${encodeURIComponent(token)}`, jsonBody)
}

const DOC = '<!DOCTYPE html><html><body><h1>Revenue</h1></body></html>'

describe('export request (POST)', () => {
  async function landed(title: string, html: string, extra: Record<string, unknown> = {}): Promise<Harness> {
    const harness = await setup(extra)
    const res = await exportSettled(harness, 'c1', title, html)
    if (res.status !== 200) throw new Error(`export request failed: ${res.status} ${res.body}`)
    return harness
  }

  it('writes the document from the session\'s own durable log — the request body never carries html', async () => {
    const harness = await setup()
    seedCall(harness, 'c1', 'visualizer', JSON.stringify({ title: 'Dash', html: DOC }))
    const res = await requestTokened(harness, 'POST', EXPORTS_ROUTE_PATH, { callId: 'c1' })
    expect(res.status).toBe(200)
    expect(res.headerMap['content-type']).toBe('application/json; charset=utf-8')
    expect(JSON.parse(res.body)).toEqual({ name: exportShareName('Dash', DOC) })
    expect(await readFileOrNull(join(harness.dir, exportShareName('Dash', DOC)))).toBe(DOC)
  })

  it('writes an untitled document under the fallback name', async () => {
    const harness = await setup()
    const res = await exportSettled(harness, 'c1', null, DOC)
    expect(res.status).toBe(200)
    expect(await readFileOrNull(join(harness.dir, exportShareName(null, DOC)))).toBe(DOC)
  })

  it('finalizes a bare SVG document under .svg', async () => {
    const svg = '<svg viewBox="0 0 10 10"><rect width="4" height="4"/></svg>'
    const harness = await landed('Flow', svg)
    expect(await readFileOrNull(join(harness.dir, exportShareName('Flow', svg)))).toBe(svg)
  })

  it('is idempotent: exporting the same call twice reproduces the same file', async () => {
    const harness = await setup()
    const first = await exportSettled(harness, 'c1', 'Dash', DOC)
    seedCall(harness, 'c1', 'visualizer', JSON.stringify({ title: 'Dash', html: DOC }))
    const second = await requestTokened(harness, 'POST', EXPORTS_ROUTE_PATH, { callId: 'c1' })
    expect(first.body).toBe(second.body)
    expect(await readFileOrNull(join(harness.dir, exportShareName('Dash', DOC)))).toBe(DOC)
  })

  it('resolves the call from whichever live session logged it, not a session named in the request', async () => {
    const harness = await setup()
    // Two live sessions; the call lives in the second one. The request names
    // only the call — there is no sessionId field to get right or wrong.
    const other = 'session-other'
    harness.sessions.byId.set(other, Session.create(other as never, [
      { type: 'tool/call', seq: 0, time: 1, data: { turn: 1, step: 1, callId: 'unrelated', name: 'bash', arguments: '{}' } },
    ] as never))
    seedCall(harness, 'c1', 'visualizer', JSON.stringify({ title: 'Dash', html: DOC }))
    const res = await requestTokened(harness, 'POST', EXPORTS_ROUTE_PATH, { callId: 'c1' })
    expect(res.status).toBe(200)
  })

  it('refuses a call id no live session ever logged', async () => {
    const harness = await setup()
    const res = await requestTokened(harness, 'POST', EXPORTS_ROUTE_PATH, { callId: 'ghost' })
    expect(res.status).toBe(404)
  })

  it('refuses a call that belongs to a different tool', async () => {
    const harness = await setup()
    seedCall(harness, 'c1', 'bash', JSON.stringify({ command: 'ls' }))
    const res = await requestTokened(harness, 'POST', EXPORTS_ROUTE_PATH, { callId: 'c1' })
    expect(res.status).toBe(404)
    expect(await readdir(harness.dir)).toEqual([])
  })

  it('refuses a call that never settled', async () => {
    const harness = await setup()
    seedCall(harness, 'c1', 'visualizer', undefined)
    const res = await requestTokened(harness, 'POST', EXPORTS_ROUTE_PATH, { callId: 'c1' })
    expect(res.status).toBe(404)
  })

  it('refuses a call that settled as an error', async () => {
    const harness = await setup()
    seedCall(harness, 'c1', 'visualizer', JSON.stringify({ title: 'Dash', html: DOC }), { name: 'Error', code: 'E_TOOL' })
    const res = await requestTokened(harness, 'POST', EXPORTS_ROUTE_PATH, { callId: 'c1' })
    expect(res.status).toBe(404)
    expect(await readdir(harness.dir)).toEqual([])
  })

  it('refuses a request whose html would exceed the configured cap', async () => {
    const harness = await setup({ maxArtifactBytes: 8 })
    seedCall(harness, 'c1', 'visualizer', JSON.stringify({ title: 'Big', html: DOC }))
    const res = await requestTokened(harness, 'POST', EXPORTS_ROUTE_PATH, { callId: 'c1' })
    expect(res.status).toBe(404)
    expect(await readdir(harness.dir)).toEqual([])
  })

  it('answers 400 for a missing or malformed callId, without touching disk', async () => {
    const harness = await setup()
    for (const body of [{}, { callId: '' }, { callId: 42 }, { notCallId: 'c1' }]) {
      const res = await requestTokened(harness, 'POST', EXPORTS_ROUTE_PATH, body)
      expect(res.status, JSON.stringify(body)).toBe(400)
    }
    expect(await readdir(harness.dir)).toEqual([])
  })

  it('refuses without the capability token, identically to any other failure', async () => {
    const harness = await setup()
    seedCall(harness, 'c1', 'visualizer', JSON.stringify({ title: 'Dash', html: DOC }))
    const res = await request(harness, 'POST', EXPORTS_ROUTE_PATH, { callId: 'c1' })
    expect(res.status).toBe(404)
    expect(res.body).toContain('No exported visualizer document')
    expect(await readdir(harness.dir)).toEqual([])
  })

  it('rate-limits repeated export requests within the window', async () => {
    const harness = await setup()
    seedCall(harness, 'c1', 'visualizer', JSON.stringify({ title: 'Dash', html: DOC }))
    let last: ReturnType<typeof fakeResponse> | undefined
    for (let i = 0; i < EXPORT_RATE_LIMIT; i++) {
      last = await requestTokened(harness, 'POST', EXPORTS_ROUTE_PATH, { callId: 'c1' })
      expect(last.status, `request ${i}`).toBe(200)
    }
    const overLimit = await requestTokened(harness, 'POST', EXPORTS_ROUTE_PATH, { callId: 'c1' })
    expect(overLimit.status).toBe(429)
    expect(overLimit.headerMap['retry-after']).toBeDefined()
  })
})

describe('exports serve route', () => {
  async function landed(title: string, html: string, extra: Record<string, unknown> = {}): Promise<Harness> {
    const harness = await setup(extra)
    const res = await exportSettled(harness, 'c1', title, html)
    if (res.status !== 200) throw new Error(`export request failed: ${res.status} ${res.body}`)
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
      await requestTokened(harness, 'PATCH', `${EXPORTS_ROUTE_PATH}/Dash.html`),
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
    expect(answers[2]!.headerMap.allow).toBe('GET, HEAD, POST, DELETE')
  })

  it('refuses a symlink planted in the exports directory like any unknown name', async () => {
    const harness = await setup()
    const { symlink, writeFile: writeFileRaw } = await import('node:fs/promises')
    await writeFileRaw(join(harness.dir, 'outside-secret.txt'), 'stolen bytes')
    await symlink(join(harness.dir, 'outside-secret.txt'), join(harness.dir, 'Planted.html'))
    await exportSettled(harness, 'c1', 'Real', DOC)
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
    const url = `${EXPORTS_ROUTE_PATH}/${encodeURIComponent(exportShareName('Flow', SVG_DOC))}`
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
      `${EXPORTS_ROUTE_PATH}/Dash.txt`,
    ]
    for (const url of urls) {
      const res = await requestTokened(harness, 'GET', url)
      expect(res.status, url).toBe(404)
      expect(res.headerMap['content-type']).toBe('text/html; charset=utf-8')
    }
  })

  describe('artifact gallery listing', () => {
    it('lists a finalized export at the route root, newest first', async () => {
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(1_000_000)
      const harness = await landed('Dash', DOC)
      vi.setSystemTime(2_000_000)
      await exportSettled(harness, 'c2', 'Later chart', '<svg><rect/></svg>')
      vi.useRealTimers()

      const res = await requestTokened(harness, 'GET', `${EXPORTS_ROUTE_PATH}/`)
      expect(res.status).toBe(200)
      expect(res.headerMap['content-type']).toBe('application/json; charset=utf-8')
      expect(res.headerMap['cache-control']).toBe('no-store')
      const body = JSON.parse(res.body) as { entries: { name: string; title: string; kind: string; bytes: number; mtimeMs: number }[] }
      expect(body.entries).toHaveLength(2)
      // Newest first: the SVG landed after the HTML document.
      expect(body.entries[0]!.title).toBe('Later chart')
      expect(body.entries[0]!.kind).toBe('svg')
      expect(body.entries[0]!.name).toBe(exportShareName('Later chart', '<svg><rect/></svg>'))
      expect(body.entries[1]!.title).toBe('Dash')
      expect(body.entries[1]!.kind).toBe('html')
      expect(body.entries[1]!.bytes).toBe(Buffer.byteLength(DOC, 'utf8'))
    })

    it('answers an empty list before anything has ever been exported', async () => {
      const harness = await setup()
      const res = await requestTokened(harness, 'GET', `${EXPORTS_ROUTE_PATH}/`)
      expect(res.status).toBe(200)
      expect(JSON.parse(res.body)).toEqual({ entries: [] })
    })

    it('refuses the listing without the capability token, identically to a bad name', async () => {
      const harness = await landed('Dash', DOC)
      const res = await request(harness, 'GET', `${EXPORTS_ROUTE_PATH}/`)
      expect(res.status).toBe(404)
      expect(res.headerMap['content-type']).toBe('text/html; charset=utf-8')
    })

    it('answers the same listing whether the request carries a trailing slash or not', async () => {
      const harness = await landed('Dash', DOC)
      const withSlash = await requestTokened(harness, 'GET', `${EXPORTS_ROUTE_PATH}/`)
      const withoutSlash = await requestTokened(harness, 'GET', EXPORTS_ROUTE_PATH)
      expect(withSlash.body).toBe(withoutSlash.body)
      expect(withoutSlash.status).toBe(200)
    })

    it('answers no body on HEAD but keeps the 200 and headers', async () => {
      const harness = await landed('Dash', DOC)
      const res = await requestTokened(harness, 'HEAD', `${EXPORTS_ROUTE_PATH}/`)
      expect(res.status).toBe(200)
      expect(res.headerMap['content-type']).toBe('application/json; charset=utf-8')
      expect(res.body).toBe('')
    })
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

  it('stays entirely dormant when the config disables exports', async () => {
    const harness = await setup({ shareArtifacts: false })
    // No route serves anything: one flag gates the whole feature.
    expect(harness.server.routes).toEqual([])
    expect(await readdir(harness.dir)).toEqual([])
  })

  it('sweeps artifacts past the retention window at activation and keeps fresh ones', async () => {
    // The sweep runs once when the route mounts, so the files must exist
    // before the plugin does: age two entries (one servable, one stray) and
    // leave one fresh, then mount and read the survivors.
    const dir = await mkdtemp(join(tmpdir(), 'dsh-visualizer-exports-'))
    const aged = new Date(Date.now() - 40 * 86_400_000)
    await writeFile(join(dir, 'aged-dash.html'), '<p>old</p>')
    await writeFile(join(dir, 'fresh-dash.html'), '<p>new</p>')
    await writeFile(join(dir, 'aged.partial'), '<p>stray</p>')
    await utimes(join(dir, 'aged-dash.html'), aged, aged)
    await utimes(join(dir, 'aged.partial'), aged, aged)

    await setup({ artifactDir: dir, artifactRetentionDays: 30 })
    // The sweep is a fire-and-forget async IIFE kicked off at registration;
    // give its microtasks a turn before reading survivors.
    await new Promise(resolve => { setTimeout(resolve, 20) })
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
    await exportSettled(reborn, 'c1', 'Dash', DOC)
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

  it('answers 405 with the method table for anything but GET, HEAD, POST, and DELETE', async () => {
    const harness = await landed('Dash', DOC)
    const res = await requestTokened(harness, 'PATCH', `${EXPORTS_ROUTE_PATH}/${encodeURIComponent(exportShareName('Dash', DOC))}`)
    expect(res.status).toBe(405)
    expect(res.headerMap.allow).toBe('GET, HEAD, POST, DELETE')
  })

  describe('artifact gallery delete', () => {
    it('removes a finalized export from disk and answers 204', async () => {
      const harness = await landed('Dash', DOC)
      const name = exportShareName('Dash', DOC)
      expect(await readFileOrNull(join(harness.dir, name))).not.toBeNull()

      const res = await requestTokened(harness, 'DELETE', `${EXPORTS_ROUTE_PATH}/${encodeURIComponent(name)}`)
      expect(res.status).toBe(204)
      expect(res.body).toBe('')
      expect(await readFileOrNull(join(harness.dir, name))).toBeNull()
    })

    it('drops it from a subsequent listing', async () => {
      const harness = await landed('Dash', DOC)
      const name = exportShareName('Dash', DOC)
      await requestTokened(harness, 'DELETE', `${EXPORTS_ROUTE_PATH}/${encodeURIComponent(name)}`)

      const res = await requestTokened(harness, 'GET', `${EXPORTS_ROUTE_PATH}/`)
      expect(JSON.parse(res.body)).toEqual({ entries: [] })
    })

    it('refuses without the capability token, identically to a bad name', async () => {
      const harness = await landed('Dash', DOC)
      const name = exportShareName('Dash', DOC)
      const res = await request(harness, 'DELETE', `${EXPORTS_ROUTE_PATH}/${encodeURIComponent(name)}`)
      expect(res.status).toBe(404)
      expect(await readFileOrNull(join(harness.dir, name))).not.toBeNull()
    })

    it('answers 404 for a missing name, the route root, and a traversal attempt, deleting nothing', async () => {
      const harness = await landed('Dash', DOC)
      const urls = [
        `${EXPORTS_ROUTE_PATH}/missing.html`,
        `${EXPORTS_ROUTE_PATH}/`,
        `${EXPORTS_ROUTE_PATH}/..%2Fsecret.html`,
        `${EXPORTS_ROUTE_PATH}/Dash.partial`,
      ]
      for (const url of urls) {
        const res = await requestTokened(harness, 'DELETE', url)
        expect(res.status, url).toBe(404)
      }
      expect(await readFileOrNull(join(harness.dir, exportShareName('Dash', DOC)))).not.toBeNull()
    })

    it('refuses a symlink planted under a servable name, like the read path does', async () => {
      const harness = await setup()
      const { symlink, writeFile: write } = await import('node:fs/promises')
      const real = join(harness.dir, 'real.html')
      await write(real, '<p>real</p>', 'utf8')
      const planted = join(harness.dir, 'planted-1234567890abcdef.html')
      await symlink(real, planted)

      const res = await requestTokened(harness, 'DELETE', `${EXPORTS_ROUTE_PATH}/planted-1234567890abcdef.html`)
      expect(res.status).toBe(404)
      expect(await readFileOrNull(real)).not.toBeNull()
    })
  })
})
