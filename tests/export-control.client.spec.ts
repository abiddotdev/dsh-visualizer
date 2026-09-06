// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, renderHook, waitFor } from '@testing-library/react'
import { EXPORT_FAILURE_REVERT_MS, useExportControl } from '../src/client/export-control.ts'
import { ARTIFACT_CHANGED_EVENT } from '../src/client/share.ts'
import { EXPORTS_BOOT_GLOBAL, EXPORTS_ROUTE_PATH, exportShareName } from '../src/shared/export-name.ts'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

const TITLE = 'Dash'
const HTML = '<p>revenue</p>'
const NAME = exportShareName(TITLE, HTML)

/** A minimally valid listing entry for one name — the reconciliation check only ever looks at `name`, but `fetchArtifactList` drops anything failing its full shape check. */
function listingEntry(name: string): { name: string; title: string; kind: 'html'; bytes: number; mtimeMs: number } {
  return { name, title: 'Dash', kind: 'html', bytes: 42, mtimeMs: 1_700_000_000_000 }
}

/**
 * Stubs the boot token and a fetch mock that answers the listing `GET` (the
 * mount-time reconciliation check, shared across cards via
 * `fetchArtifactListOnce`), a `POST` (an explicit `ensure()`), and a
 * `DELETE` independently, so a test can drive each path without the others
 * silently satisfying it.
 */
function stubFetch(handlers: { listing?: readonly string[]; post?: (body: unknown) => { name?: string } | null; delete?: boolean }): ReturnType<typeof vi.fn> {
  vi.stubGlobal(EXPORTS_BOOT_GLOBAL, 'test-token')
  const fetchSpy = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
    if (init?.method === 'DELETE') return Promise.resolve({ ok: handlers.delete ?? false })
    if (init?.method === 'POST') {
      const body: unknown = JSON.parse(String(init.body))
      const result = handlers.post?.(body) ?? null
      return Promise.resolve(result === null ? { ok: false, status: 404 } : { ok: true, json: () => Promise.resolve(result) })
    }
    // The listing GET, addressed at the route's own root with no method set.
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ entries: (handlers.listing ?? []).map(listingEntry) }) })
  })
  vi.stubGlobal('fetch', fetchSpy)
  return fetchSpy
}

describe('useExportControl mount-time reconciliation', () => {
  it('recognizes an export that already exists — e.g. from before a page reload', async () => {
    stubFetch({ listing: [NAME] })
    const { result } = renderHook(() => useExportControl('call-1', TITLE, HTML))

    expect(result.current.status).toBe('idle')
    await waitFor(() => { expect(result.current.status).toBe('exported') })
    expect(result.current.name).toBe(NAME)
  })

  it('stays idle when no matching export exists yet', async () => {
    stubFetch({ listing: [] })
    const { result } = renderHook(() => useExportControl('call-1', TITLE, HTML))

    await act(async () => { await Promise.resolve() })
    expect(result.current.status).toBe('idle')
  })

  it('checks the exact name both planes derive from title and html, not an arbitrary one', async () => {
    stubFetch({ listing: [NAME] })
    const { result } = renderHook(() => useExportControl('call-1', TITLE, HTML))

    await waitFor(() => { expect(result.current.status).toBe('exported') })
    expect(result.current.name).toBe(NAME)
  })

  it('shares one listing request across every card reconciling at the same moment', async () => {
    const fetchSpy = stubFetch({ listing: [NAME] })
    renderHook(() => useExportControl('call-1', TITLE, HTML))
    renderHook(() => useExportControl('call-2', TITLE, HTML))
    renderHook(() => useExportControl('call-3', TITLE, HTML))

    await act(async () => { await Promise.resolve() })
    const listingCalls = fetchSpy.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === undefined)
    expect(listingCalls).toHaveLength(1)
  })

  it('never checks without a callId — nothing to reconcile', () => {
    const fetchSpy = stubFetch({ listing: [NAME] })
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
    let resolveListing!: (value: { ok: boolean; json: () => Promise<unknown> }) => void
    vi.stubGlobal(EXPORTS_BOOT_GLOBAL, 'test-token')
    const fetchSpy = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
      if (init?.method === 'POST') {
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ name: `${exportShareName(TITLE, HTML)}-clicked` }) })
      }
      // The listing reconciliation hangs until the test releases it.
      return new Promise(resolve => { resolveListing = resolve })
    })
    vi.stubGlobal('fetch', fetchSpy)

    const { result } = renderHook(() => useExportControl('call-1', TITLE, HTML))
    await act(async () => { await result.current.ensure() })
    expect(result.current.status).toBe('exported')
    const clickedName = result.current.name

    // The slow reconciliation now resolves "already exists" — it must not
    // clobber the click's own, already-settled result.
    await act(async () => { resolveListing({ ok: true, json: () => Promise.resolve({ entries: [listingEntry(NAME)] }) }) })
    expect(result.current.status).toBe('exported')
    expect(result.current.name).toBe(clickedName)
  })
})

describe('useExportControl live cross-surface sync', () => {
  it('drops back to idle when the same name is unshared elsewhere (e.g. the gallery\'s Delete)', async () => {
    stubFetch({ listing: [NAME] })
    const { result } = renderHook(() => useExportControl('call-1', TITLE, HTML))
    await waitFor(() => { expect(result.current.status).toBe('exported') })

    act(() => { window.dispatchEvent(new CustomEvent(ARTIFACT_CHANGED_EVENT, { detail: { name: NAME, exported: false } })) })
    expect(result.current.status).toBe('idle')
    expect(result.current.name).toBeNull()
  })

  it('flips to exported when the same name is exported elsewhere', async () => {
    stubFetch({ listing: [] })
    const { result } = renderHook(() => useExportControl('call-1', TITLE, HTML))
    await act(async () => { await Promise.resolve() })
    expect(result.current.status).toBe('idle')

    act(() => { window.dispatchEvent(new CustomEvent(ARTIFACT_CHANGED_EVENT, { detail: { name: NAME, exported: true } })) })
    expect(result.current.status).toBe('exported')
    expect(result.current.name).toBe(NAME)
  })

  it('ignores a broadcast for an unrelated name', async () => {
    stubFetch({ listing: [NAME] })
    const { result } = renderHook(() => useExportControl('call-1', TITLE, HTML))
    await waitFor(() => { expect(result.current.status).toBe('exported') })

    act(() => { window.dispatchEvent(new CustomEvent(ARTIFACT_CHANGED_EVENT, { detail: { name: 'some-other-name', exported: false } })) })
    expect(result.current.status).toBe('exported')
    expect(result.current.name).toBe(NAME)
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

describe('useExportControl unshare()', () => {
  it('is a no-op when nothing is exported yet', async () => {
    const fetchSpy = stubFetch({ listing: [] })
    const { result } = renderHook(() => useExportControl('call-1', TITLE, HTML))
    await expect(result.current.unshare()).resolves.toBe(false)
    expect(fetchSpy).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ method: 'DELETE' }))
  })

  it('deletes the named export and returns the control all the way to idle, not just forgotten locally', async () => {
    const fetchSpy = stubFetch({ post: () => ({ name: NAME }), delete: true })
    const { result } = renderHook(() => useExportControl('call-1', TITLE, HTML))
    await act(async () => { await result.current.ensure() })
    expect(result.current.status).toBe('exported')

    let ok = false
    await act(async () => { ok = await result.current.unshare() })
    expect(ok).toBe(true)
    expect(fetchSpy).toHaveBeenCalledWith(
      `${window.location.origin}${EXPORTS_ROUTE_PATH}/${encodeURIComponent(NAME)}?k=test-token`,
      { method: 'DELETE' },
    )
    expect(result.current.status).toBe('idle')
    expect(result.current.name).toBeNull()
  })

  it('leaves the control exported when the host refuses the delete', async () => {
    const fetchSpy = stubFetch({ post: () => ({ name: NAME }), delete: false })
    const { result } = renderHook(() => useExportControl('call-1', TITLE, HTML))
    await act(async () => { await result.current.ensure() })

    let ok = true
    await act(async () => { ok = await result.current.unshare() })
    expect(ok).toBe(false)
    expect(result.current.status).toBe('exported')
    expect(result.current.name).toBe(NAME)
    expect(fetchSpy).toHaveBeenCalled()
  })
})
