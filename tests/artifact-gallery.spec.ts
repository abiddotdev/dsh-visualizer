// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { deleteArtifact, fetchArtifactList, formatArtifactSize, formatArtifactTime, matchesDateFilter } from '../src/client/artifact-gallery.ts'
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

describe('deleteArtifact', () => {
  it('resolves false without a request where sharing is not announced', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    await expect(deleteArtifact(ENTRY.name)).resolves.toBe(false)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('sends DELETE to the entry\'s own token-gated URL', async () => {
    vi.stubGlobal(EXPORTS_BOOT_GLOBAL, 'test-token')
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetchSpy)

    await expect(deleteArtifact(ENTRY.name)).resolves.toBe(true)
    expect(fetchSpy).toHaveBeenCalledWith(
      `${window.location.origin}${EXPORTS_ROUTE_PATH}/${encodeURIComponent(ENTRY.name)}?k=test-token`,
      { method: 'DELETE' },
    )
  })

  it('resolves false when the host refuses the delete', async () => {
    vi.stubGlobal(EXPORTS_BOOT_GLOBAL, 'test-token')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }))
    await expect(deleteArtifact(ENTRY.name)).resolves.toBe(false)
  })
})

describe('matchesDateFilter', () => {
  // Built with the local Date constructor, not Date.UTC: "today" is a local
  // calendar-day concept by design, so the fixtures must move with whatever
  // timezone the suite runs under, the same way the function itself does.
  const NOW = new Date(2023, 10, 20, 15, 0, 0).getTime()

  it('accepts everything under the all-time bucket', () => {
    expect(matchesDateFilter(0, 'all', NOW)).toBe(true)
    expect(matchesDateFilter(NOW, 'all', NOW)).toBe(true)
  })

  it('scopes today to the local calendar day, not a rolling 24 hours', () => {
    const earlierToday = new Date(2023, 10, 20, 0, 30, 0).getTime()
    const yesterday = new Date(2023, 10, 19, 23, 30, 0).getTime()
    expect(matchesDateFilter(earlierToday, 'today', NOW)).toBe(true)
    expect(matchesDateFilter(yesterday, 'today', NOW)).toBe(false)
  })

  it('scopes this week to a rolling seven days', () => {
    const sixDaysAgo = NOW - 6 * 86_400_000
    const eightDaysAgo = NOW - 8 * 86_400_000
    expect(matchesDateFilter(sixDaysAgo, 'week', NOW)).toBe(true)
    expect(matchesDateFilter(eightDaysAgo, 'week', NOW)).toBe(false)
  })

  it('defaults its clock to the real one when none is injected', () => {
    expect(matchesDateFilter(Date.now(), 'today')).toBe(true)
  })
})
