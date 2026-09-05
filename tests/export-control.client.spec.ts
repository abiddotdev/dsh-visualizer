// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { EXPORT_FAILURE_REVERT_MS, useExportControl } from '../src/client/export-control.ts'
import { EXPORTS_BOOT_GLOBAL, EXPORTS_ROUTE_PATH, exportShareName } from '../src/shared/export-name.ts'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

const TITLE = 'Dash'
const HTML = '<p>revenue</p>'
const NAME = exportShareName(TITLE, HTML)

/**
 * Stubs the boot token and a fetch mock that answers a `HEAD` request (the
 * mount-time reconciliation check) and a `POST` request (an explicit
 * `ensure()`) independently, so a test can drive each path without the
 * other silently satisfying it.
 */
function stubFetch(handlers: { head?: boolean; post?: (body: unknown) => { name?: string } | null }): ReturnType<typeof vi.fn> {
  vi.stubGlobal(EXPORTS_BOOT_GLOBAL, 'test-token')
  const fetchSpy = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
    if (init?.method === 'HEAD') return Promise.resolve({ ok: handlers.head ?? false })
    if (init?.method === 'POST') {
      const body: unknown = JSON.parse(String(init.body))
      const result = handlers.post?.(body) ?? null
      return Promise.resolve(result === null ? { ok: false, status: 404 } : { ok: true, json: () => Promise.resolve(result) })
    }
    return Promise.reject(new Error(`unexpected method ${String(init?.method)}`))
  })
  vi.stubGlobal('fetch', fetchSpy)
  return fetchSpy
}

describe('useExportControl mount-time reconciliation', () => {
  it('recognizes an export that already exists — e.g. from before a page reload', async () => {
    stubFetch({ head: true })
    const { result } = renderHook(() => useExportControl('call-1', TITLE, HTML))

    expect(result.current.status).toBe('idle')
    await waitFor(() => { expect(result.current.status).toBe('exported') })
    expect(result.current.name).toBe(NAME)
  })

  it('stays idle when no matching export exists yet', async () => {
    stubFetch({ head: false })
    const { result } = renderHook(() => useExportControl('call-1', TITLE, HTML))

    await act(async () => { await Promise.resolve() })
    expect(result.current.status).toBe('idle')
  })

  it('checks the exact name both planes derive from title and html, not an arbitrary one', async () => {
    const fetchSpy = stubFetch({ head: true })
    renderHook(() => useExportControl('call-1', TITLE, HTML))

    await waitFor(() => { expect(fetchSpy).toHaveBeenCalled() })
    const [url] = fetchSpy.mock.calls[0] as [string]
    expect(url).toBe(`${window.location.origin}${EXPORTS_ROUTE_PATH}/${encodeURIComponent(NAME)}?k=test-token`)
  })

  it('never checks without a callId — nothing to reconcile', () => {
    const fetchSpy = stubFetch({ head: true })
    renderHook(() => useExportControl(null, TITLE, HTML))
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('never checks where sharing is not announced', () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    renderHook(() => useExportControl('call-1', TITLE, HTML))
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('a user\'s own click always wins over a slower reconciliation response', async () => {
    let resolveHead!: (value: { ok: boolean }) => void
    vi.stubGlobal(EXPORTS_BOOT_GLOBAL, 'test-token')
    const fetchSpy = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ name: `${exportShareName(TITLE, HTML)}-clicked` }) })
      }
      // The HEAD reconciliation hangs until the test releases it.
      return new Promise(resolve => { resolveHead = resolve })
    })
    vi.stubGlobal('fetch', fetchSpy)

    const { result } = renderHook(() => useExportControl('call-1', TITLE, HTML))
    await act(async () => { await result.current.ensure() })
    expect(result.current.status).toBe('exported')
    const clickedName = result.current.name

    // The slow reconciliation now resolves "already exists" — it must not
    // clobber the click's own, already-settled result.
    await act(async () => { resolveHead({ ok: true }) })
    expect(result.current.status).toBe('exported')
    expect(result.current.name).toBe(clickedName)
  })
})

describe('useExportControl ensure()', () => {
  it('POSTs only the callId and resolves the confirmed name', async () => {
    const fetchSpy = stubFetch({ post: body => (body as { callId: string }).callId === 'call-1' ? { name: NAME } : null })
    const { result } = renderHook(() => useExportControl('call-1', TITLE, HTML))

    let resolved: string | null = null
    await act(async () => { resolved = await result.current.ensure() })
    expect(resolved!).toBe(NAME)
    expect(result.current.status).toBe('exported')
    const postCall = fetchSpy.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === 'POST')
    expect(JSON.parse(String((postCall![1] as RequestInit).body))).toEqual({ callId: 'call-1' })
  })

  it('joins an in-flight request rather than starting a second one', async () => {
    const fetchSpy = stubFetch({ post: () => ({ name: NAME }) })
    const { result } = renderHook(() => useExportControl('call-1', TITLE, HTML))

    let a: string | null = null
    let b: string | null = null
    await act(async () => {
      const first = result.current.ensure()
      const second = result.current.ensure()
      ;[a, b] = await Promise.all([first, second])
    })
    expect(a!).toBe(NAME)
    expect(b!).toBe(NAME)
    const postCalls = fetchSpy.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === 'POST')
    expect(postCalls).toHaveLength(1)
  })

  it('reverts a failed export to idle after the failure window, offering a retry', async () => {
    vi.useFakeTimers()
    stubFetch({ post: () => null })
    const { result } = renderHook(() => useExportControl('call-1', TITLE, HTML))

    await act(async () => { await result.current.ensure() })
    expect(result.current.status).toBe('failed')
    act(() => { vi.advanceTimersByTime(EXPORT_FAILURE_REVERT_MS) })
    expect(result.current.status).toBe('idle')
  })

  it('resolves null without a request when there is no callId', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    const { result } = renderHook(() => useExportControl(null, TITLE, HTML))
    await expect(result.current.ensure()).resolves.toBeNull()
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
