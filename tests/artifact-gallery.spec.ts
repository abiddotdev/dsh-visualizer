// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { fetchArtifactList, formatArtifactSize, formatArtifactTime } from '../src/client/artifact-gallery.ts'
import { EXPORTS_BOOT_GLOBAL, EXPORTS_ROUTE_PATH } from '../src/shared/export-name.ts'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const ENTRY = { name: 'dash-abc1234567890f.html', title: 'Dash', kind: 'html' as const, bytes: 42, mtimeMs: 1_700_000_000_000 }

describe('fetchArtifactList', () => {
  it('resolves to an empty list where sharing is not announced, without a request', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    await expect(fetchArtifactList()).resolves.toEqual([])
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('fetches the token-gated listing URL and returns validated entries', async () => {
    vi.stubGlobal(EXPORTS_BOOT_GLOBAL, 'test-token')
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ entries: [ENTRY] }) })
    vi.stubGlobal('fetch', fetchSpy)

    const entries = await fetchArtifactList()
    expect(entries).toEqual([ENTRY])
    expect(fetchSpy).toHaveBeenCalledWith(
      `${window.location.origin}${EXPORTS_ROUTE_PATH}/?k=test-token`,
      { cache: 'no-store' },
    )
  })

  it('drops malformed entries rather than trusting the network payload', async () => {
    vi.stubGlobal(EXPORTS_BOOT_GLOBAL, 'test-token')
    const entries = [
      ENTRY,
      { ...ENTRY, name: '' },
      { ...ENTRY, kind: 'pdf' },
      { ...ENTRY, bytes: 'big' },
      null,
      'not an object',
    ]
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ entries }) }))

    await expect(fetchArtifactList()).resolves.toEqual([ENTRY])
  })

  it('throws when the host refuses the request', async () => {
    vi.stubGlobal(EXPORTS_BOOT_GLOBAL, 'test-token')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404, json: () => Promise.resolve({}) }))
    await expect(fetchArtifactList()).rejects.toThrow('404')
  })

  it('throws when the response carries no entries array', async () => {
    vi.stubGlobal(EXPORTS_BOOT_GLOBAL, 'test-token')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ entries: 'nope' }) }))
    await expect(fetchArtifactList()).rejects.toThrow('malformed')
  })
})

describe('formatArtifactSize', () => {
  it('shows whole bytes below one kilobyte', () => {
    expect(formatArtifactSize(842)).toBe('842 B')
    expect(formatArtifactSize(0)).toBe('0 B')
  })

  it('shows one decimal place in kilobytes and megabytes', () => {
    expect(formatArtifactSize(12_620)).toBe('12.3 KB')
    expect(formatArtifactSize(5 * 1024 * 1024)).toBe('5.0 MB')
  })
})

describe('formatArtifactTime', () => {
  it('formats a timestamp through Intl rather than a fixed string', () => {
    const text = formatArtifactTime(1_700_000_000_000)
    expect(typeof text).toBe('string')
    expect(text.length).toBeGreaterThan(0)
  })
})
