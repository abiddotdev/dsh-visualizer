// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
// Pulls this package's LocaleNamespaceMap merge into the program so the
// composed props type carries the `t` seat (the merge lives in the entry).
import type {} from '../src/client/index.ts'
import { ArtifactGallery, type ArtifactGalleryProps } from '../src/client/ArtifactGallery.tsx'
import { EXPORTS_BOOT_GLOBAL, EXPORTS_ROUTE_PATH } from '../src/shared/export-name.ts'
import { COPY_FEEDBACK_MS } from '../src/client/download.ts'
import { en } from '../src/client/locales.ts'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

/** Locale seat over the package dictionary; interpolates `{name}` params. */
const t = ((key: keyof typeof en, params?: Record<string, string | number>) =>
  en[key].replace(/\{(\w+)\}/g, (_m, name: string) => String(params?.[name] ?? ''))) as ArtifactGalleryProps['t']

/** The gallery reads only `t` off the composed conversation.view props; the
 * rest (owner focus-request plumbing, session standard-kit hooks) has no
 * effect on a host-global listing, so a same-shaped cast stands in for it. */
function renderGallery(): void {
  render(<ArtifactGallery {...({ t } as unknown as ArtifactGalleryProps)} />)
}

const ENTRY = { name: 'dash-abc1234567890f.html', title: 'Dash', kind: 'html' as const, bytes: 12_620, mtimeMs: 1_700_000_000_000 }
const OTHER = { name: 'q3-revenue-1234567890abcdef.svg', title: 'Q3 revenue', kind: 'svg' as const, bytes: 900, mtimeMs: 1_699_000_000_000 }

function stubFetch(handler: () => unknown): void {
  vi.stubGlobal(EXPORTS_BOOT_GLOBAL, 'test-token')
  vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(handler())))
}

/** The `<li>` row for one entry's title, scoped so per-row queries never bleed into other rows or the filter chips. */
function rowFor(title: string): HTMLElement {
  return screen.getByText(title).closest('li')!
}

describe('ArtifactGallery', () => {
  it('lists every finalized export, newest first, with size and open/copy actions', async () => {
    stubFetch(() => ({ ok: true, json: () => Promise.resolve({ entries: [ENTRY] }) }))
    renderGallery()

    expect(screen.getByText('Loading…')).toBeTruthy()
    await waitFor(() => { expect(screen.getByText('Dash')).toBeTruthy() })
    const row = rowFor('Dash')
    expect(within(row).getByText('HTML')).toBeTruthy()
    expect(within(row).getByText(/12\.3 KB/)).toBeTruthy()

    const open = within(row).getByRole('link', { name: 'Open' })
    expect(open.getAttribute('href')).toBe(
      `${window.location.origin}${EXPORTS_ROUTE_PATH}/${encodeURIComponent(ENTRY.name)}?k=test-token`,
    )
    expect(open.getAttribute('target')).toBe('_blank')
  })

  it('filters the list to titles matching the search box, case-insensitively', async () => {
    stubFetch(() => ({ ok: true, json: () => Promise.resolve({ entries: [ENTRY, OTHER] }) }))
    renderGallery()
    await waitFor(() => { expect(screen.getByText('Dash')).toBeTruthy() })
    expect(screen.getByText('Q3 revenue')).toBeTruthy()

    const search = screen.getByRole('searchbox', { name: 'Search artifacts…' })
    await act(async () => { fireEvent.change(search, { target: { value: 'rev' } }) })
    expect(screen.queryByText('Dash')).toBeNull()
    expect(screen.getByText('Q3 revenue')).toBeTruthy()
  })

  it('shows the no-matches state distinctly from the nothing-shared-yet state', async () => {
    stubFetch(() => ({ ok: true, json: () => Promise.resolve({ entries: [ENTRY] }) }))
    renderGallery()
    await waitFor(() => { expect(screen.getByText('Dash')).toBeTruthy() })

    const search = screen.getByRole('searchbox', { name: 'Search artifacts…' })
    await act(async () => { fireEvent.change(search, { target: { value: 'nonexistent' } }) })
    expect(screen.getByText('No artifacts match your search')).toBeTruthy()
    expect(screen.queryByText('Nothing shared yet — renders appear here once a visualizer call settles')).toBeNull()
  })

  it('hides the search box, count, and filters when there is nothing to search', async () => {
    stubFetch(() => ({ ok: true, json: () => Promise.resolve({ entries: [] }) }))
    renderGallery()
    await waitFor(() => { expect(screen.getByText('Nothing shared yet — renders appear here once a visualizer call settles')).toBeTruthy() })
    expect(screen.queryByRole('searchbox')).toBeNull()
    expect(screen.queryByRole('group')).toBeNull()
  })

  it('shows the empty state once loaded with nothing shared yet', async () => {
    stubFetch(() => ({ ok: true, json: () => Promise.resolve({ entries: [] }) }))
    renderGallery()
    await waitFor(() => {
      expect(screen.getByText('Nothing shared yet — renders appear here once a visualizer call settles')).toBeTruthy()
    })
  })

  it('shows an error state when the listing request fails', async () => {
    stubFetch(() => ({ ok: false, status: 500, json: () => Promise.resolve({}) }))
    renderGallery()
    await waitFor(() => { expect(screen.getByText('Could not load the artifact list')).toBeTruthy() })
  })

  it('refetches on the refresh control', async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ entries: [ENTRY] }) })
    vi.stubGlobal(EXPORTS_BOOT_GLOBAL, 'test-token')
    vi.stubGlobal('fetch', fetchSpy)
    renderGallery()

    await waitFor(() => { expect(screen.getByText('Dash')).toBeTruthy() })
    expect(fetchSpy).toHaveBeenCalledTimes(1)
    await act(async () => { screen.getByRole('button', { name: 'Refresh' }).click() })
    expect(fetchSpy).toHaveBeenCalledTimes(2)
  })

  it('copies the entry link and confirms briefly', async () => {
    stubFetch(() => ({ ok: true, json: () => Promise.resolve({ entries: [ENTRY] }) }))
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    vi.useFakeTimers()
    renderGallery()

    await vi.waitFor(() => { expect(screen.getByText('Dash')).toBeTruthy() }, { timeout: 5000 })
    const copy = within(rowFor('Dash')).getByRole('button', { name: 'Copy link' })
    await act(async () => { copy.click() })
    expect(writeText).toHaveBeenCalledWith(
      `${window.location.origin}${EXPORTS_ROUTE_PATH}/${encodeURIComponent(ENTRY.name)}?k=test-token`,
    )
    expect(within(rowFor('Dash')).getByRole('button', { name: 'Copied' })).toBeTruthy()
    act(() => { vi.advanceTimersByTime(COPY_FEEDBACK_MS) })
    expect(within(rowFor('Dash')).getByRole('button', { name: 'Copy link' })).toBeTruthy()
  })

  describe('count', () => {
    it('shows the plain total with no filter active', async () => {
      stubFetch(() => ({ ok: true, json: () => Promise.resolve({ entries: [ENTRY, OTHER] }) }))
      renderGallery()
      await waitFor(() => { expect(screen.getByText('2 artifacts')).toBeTruthy() })
    })

    it('switches to shown-of-total once a search narrows the list', async () => {
      stubFetch(() => ({ ok: true, json: () => Promise.resolve({ entries: [ENTRY, OTHER] }) }))
      renderGallery()
      await waitFor(() => { expect(screen.getByText('2 artifacts')).toBeTruthy() })

      const search = screen.getByRole('searchbox', { name: 'Search artifacts…' })
      await act(async () => { fireEvent.change(search, { target: { value: 'dash' } }) })
      expect(screen.getByText('1 of 2')).toBeTruthy()
    })
  })

  describe('kind and date filter chips', () => {
    it('narrows to one kind on a chip click, single-select within the group', async () => {
      stubFetch(() => ({ ok: true, json: () => Promise.resolve({ entries: [ENTRY, OTHER] }) }))
      renderGallery()
      await waitFor(() => { expect(screen.getByText('Dash')).toBeTruthy() })

      const kindGroup = screen.getByRole('group', { name: 'Filter by kind' })
      await act(async () => { within(kindGroup).getByRole('button', { name: 'SVG' }).click() })
      expect(screen.queryByText('Dash')).toBeNull()
      expect(screen.getByText('Q3 revenue')).toBeTruthy()
      expect(within(kindGroup).getByRole('button', { name: 'SVG' }).getAttribute('aria-pressed')).toBe('true')
      expect(within(kindGroup).getByRole('button', { name: 'All' }).getAttribute('aria-pressed')).toBe('false')
    })

    it('combines the date filter with search and kind, all three narrowing together', async () => {
      // Local Date, not Date.UTC: "today" is a local calendar-day concept,
      // so the fixture must move with whatever timezone the suite runs under.
      const now = new Date(2023, 10, 20, 12, 0, 0).getTime()
      vi.useFakeTimers({ toFake: ['Date'] })
      vi.setSystemTime(now)
      const today = { ...ENTRY, name: 'today.html', title: 'Today doc', mtimeMs: now - 1_000 }
      const old = { ...ENTRY, name: 'old.html', title: 'Old doc', mtimeMs: now - 30 * 86_400_000 }
      stubFetch(() => ({ ok: true, json: () => Promise.resolve({ entries: [today, old] }) }))
      renderGallery()
      await vi.waitFor(() => { expect(screen.getByText('Today doc')).toBeTruthy() }, { timeout: 5000 })
      expect(screen.getByText('Old doc')).toBeTruthy()

      const dateGroup = screen.getByRole('group', { name: 'Filter by date' })
      await act(async () => { within(dateGroup).getByRole('button', { name: 'Today' }).click() })
      expect(screen.getByText('Today doc')).toBeTruthy()
      expect(screen.queryByText('Old doc')).toBeNull()
    })
  })

  describe('delete', () => {
    function stubFetchWithDelete(entries: unknown[], deleteOk = true): ReturnType<typeof vi.fn> {
      vi.stubGlobal(EXPORTS_BOOT_GLOBAL, 'test-token')
      const fetchSpy = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
        if (init?.method === 'DELETE') return Promise.resolve({ ok: deleteOk, status: deleteOk ? 204 : 404 })
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ entries }) })
      })
      vi.stubGlobal('fetch', fetchSpy)
      return fetchSpy
    }

    it('arms on the first click and only deletes on a second click while armed', async () => {
      const fetchSpy = stubFetchWithDelete([ENTRY])
      renderGallery()
      await waitFor(() => { expect(screen.getByText('Dash')).toBeTruthy() })

      const del = within(rowFor('Dash')).getByRole('button', { name: 'Delete' })
      await act(async () => { del.click() })
      expect(within(rowFor('Dash')).getByRole('button', { name: 'Click again to confirm delete' })).toBeTruthy()
      expect(fetchSpy).not.toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ method: 'DELETE' }))

      await act(async () => { screen.getByRole('button', { name: 'Click again to confirm delete' }).click() })
      await waitFor(() => { expect(screen.queryByText('Dash')).toBeNull() })
      expect(fetchSpy).toHaveBeenCalledWith(
        `${window.location.origin}${EXPORTS_ROUTE_PATH}/${encodeURIComponent(ENTRY.name)}?k=test-token`,
        { method: 'DELETE' },
      )
    })

    it('reverts the armed state on its own after the confirm window elapses', async () => {
      vi.useFakeTimers()
      stubFetchWithDelete([ENTRY])
      renderGallery()
      await vi.waitFor(() => { expect(screen.getByText('Dash')).toBeTruthy() }, { timeout: 5000 })

      await act(async () => { screen.getByRole('button', { name: 'Delete' }).click() })
      expect(screen.getByRole('button', { name: 'Click again to confirm delete' })).toBeTruthy()
      act(() => { vi.advanceTimersByTime(3_000) })
      expect(screen.getByRole('button', { name: 'Delete' })).toBeTruthy()
    })

    it('reverts the armed state on blur, so a stray click elsewhere never leaves it primed', async () => {
      stubFetchWithDelete([ENTRY])
      renderGallery()
      await waitFor(() => { expect(screen.getByText('Dash')).toBeTruthy() })

      const del = screen.getByRole('button', { name: 'Delete' })
      await act(async () => { del.click() })
      expect(screen.getByRole('button', { name: 'Click again to confirm delete' })).toBeTruthy()
      await act(async () => { fireEvent.blur(screen.getByRole('button', { name: 'Click again to confirm delete' })) })
      expect(screen.getByRole('button', { name: 'Delete' })).toBeTruthy()
    })

    it('leaves the row in place when the host refuses the delete', async () => {
      stubFetchWithDelete([ENTRY], false)
      renderGallery()
      await waitFor(() => { expect(screen.getByText('Dash')).toBeTruthy() })

      await act(async () => { screen.getByRole('button', { name: 'Delete' }).click() })
      await act(async () => { screen.getByRole('button', { name: 'Click again to confirm delete' }).click() })
      await waitFor(() => { expect(screen.getByRole('button', { name: 'Delete' })).toBeTruthy() })
      expect(screen.getByText('Dash')).toBeTruthy()
    })
  })
})
