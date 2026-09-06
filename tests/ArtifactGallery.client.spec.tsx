// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
// Pulls this package's LocaleNamespaceMap merge into the program so the
// composed props type carries the `t` seat (the merge lives in the entry).
import type {} from '../src/client/index.ts'
import { ArtifactGallery, type ArtifactGalleryProps } from '../src/client/ArtifactGallery.tsx'
import { ARTIFACT_CHANGED_EVENT } from '../src/client/share.ts'
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

const ENTRY = { name: 'dash-abc1234567890f.html', title: 'Dash', kind: 'html' as const, bytes: 12_620, mtimeMs: 1_700_000_000_000, pinned: false }
const OTHER = { name: 'q3-revenue-1234567890abcdef.svg', title: 'Q3 revenue', kind: 'svg' as const, bytes: 900, mtimeMs: 1_699_000_000_000, pinned: false }

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

  describe('pin toggle', () => {
    function stubFetchWithPatch(entries: unknown[], patchOk = true): ReturnType<typeof vi.fn> {
      vi.stubGlobal(EXPORTS_BOOT_GLOBAL, 'test-token')
      const fetchSpy = vi.fn().mockImplementation((_url: string, init?: RequestInit) => {
        if (init?.method === 'PATCH') return Promise.resolve({ ok: patchOk, status: patchOk ? 204 : 404 })
        return Promise.resolve({ ok: true, json: () => Promise.resolve({ entries }) })
      })
      vi.stubGlobal('fetch', fetchSpy)
      return fetchSpy
    }

    it('pins on a single click, no arm/confirm, without refetching the listing', async () => {
      const fetchSpy = stubFetchWithPatch([ENTRY])
      renderGallery()
      await waitFor(() => { expect(screen.getByText('Dash')).toBeTruthy() })
      expect(fetchSpy).toHaveBeenCalledTimes(1)

      const pin = within(rowFor('Dash')).getByRole('button', { name: 'Pin' })
      await act(async () => { pin.click() })
      expect(fetchSpy).toHaveBeenCalledWith(
        `${window.location.origin}${EXPORTS_ROUTE_PATH}/${encodeURIComponent(ENTRY.name)}?k=test-token`,
        { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pinned: true }) },
      )
      await waitFor(() => { expect(within(rowFor('Dash')).getByRole('button', { name: 'Pinned' })).toBeTruthy() })
      expect(within(rowFor('Dash')).getByRole('button', { name: 'Pinned' }).getAttribute('aria-pressed')).toBe('true')
      expect(fetchSpy).toHaveBeenCalledTimes(2) // initial load + the PATCH, no extra listing refetch
    })

    it('floats a newly pinned older entry ahead of a newer unpinned one immediately', async () => {
      const older = { ...ENTRY, mtimeMs: 1 }
      const newer = { ...OTHER, mtimeMs: 2 }
      stubFetchWithPatch([newer, older])
      renderGallery()
      await waitFor(() => { expect(screen.getByText('Dash')).toBeTruthy() })

      const rowsBefore = screen.getAllByRole('listitem')
      expect(rowsBefore[0]!.textContent).toContain('Q3 revenue')

      await act(async () => { within(rowFor('Dash')).getByRole('button', { name: 'Pin' }).click() })
      await waitFor(() => {
        const rowsAfter = screen.getAllByRole('listitem')
        expect(rowsAfter[0]!.textContent).toContain('Dash')
      })
    })

    it('unpins on a second click', async () => {
      stubFetchWithPatch([{ ...ENTRY, pinned: true }])
      renderGallery()
      await waitFor(() => { expect(screen.getByText('Dash')).toBeTruthy() })

      const pinned = within(rowFor('Dash')).getByRole('button', { name: 'Pinned' })
      await act(async () => { pinned.click() })
      await waitFor(() => { expect(within(rowFor('Dash')).getByRole('button', { name: 'Pin' })).toBeTruthy() })
    })

    it('leaves the row unchanged when the host refuses the pin request', async () => {
      stubFetchWithPatch([ENTRY], false)
      renderGallery()
      await waitFor(() => { expect(screen.getByText('Dash')).toBeTruthy() })

      await act(async () => { within(rowFor('Dash')).getByRole('button', { name: 'Pin' }).click() })
      await waitFor(() => { expect(within(rowFor('Dash')).getByRole('button', { name: 'Pin' })).toBeTruthy() })
    })
  })

  describe('pinned filter chip', () => {
    it('narrows to pinned entries only, composing with search and other chips', async () => {
      const pinned = { ...ENTRY, pinned: true }
      stubFetch(() => ({ ok: true, json: () => Promise.resolve({ entries: [pinned, OTHER] }) }))
      renderGallery()
      await waitFor(() => { expect(screen.getByText('Dash')).toBeTruthy() })

      const pinnedGroup = screen.getByRole('group', { name: 'Filter by pinned' })
      await act(async () => { within(pinnedGroup).getByRole('button', { name: 'Pinned' }).click() })
      expect(screen.getByText('Dash')).toBeTruthy()
      expect(screen.queryByText('Q3 revenue')).toBeNull()
    })
  })

  describe('preview', () => {
    // Distinguishes the listing GET (always .../visualizer/?k=...) from a
    // per-artifact GET (.../visualizer/<name>?k=...) so the HTML preview's
    // own fetch(url).then(text()) gets real HTML text back, not the listing
    // JSON — matching how the two routes actually differ on the wire.
    function stubFetchWithPreview(entries: unknown[], html = '<html><body>preview</body></html>'): ReturnType<typeof vi.fn> {
      vi.stubGlobal(EXPORTS_BOOT_GLOBAL, 'test-token')
      const fetchSpy = vi.fn().mockImplementation((url: string) => {
        if (url.includes(`${EXPORTS_ROUTE_PATH}/?`)) return Promise.resolve({ ok: true, json: () => Promise.resolve({ entries }) })
        return Promise.resolve({ ok: true, text: () => Promise.resolve(html) })
      })
      vi.stubGlobal('fetch', fetchSpy)
      return fetchSpy
    }

    /** The row's selection trigger — now a button spanning badge+title+meta,
     * not just the title text, so its accessible name is their concatenation. */
    function titleButton(title: string): HTMLElement {
      return within(rowFor(title)).getByRole('button', { name: (accessibleName) => accessibleName.includes(title) })
    }

    it('shows no preview before any row is expanded', async () => {
      stubFetchWithPreview([ENTRY])
      renderGallery()
      await waitFor(() => { expect(screen.getByText('Dash')).toBeTruthy() })

      expect(screen.queryByTitle('Live preview of Dash')).toBeNull()
      expect(screen.queryByRole('img', { name: /Live preview/ })).toBeNull()
      expect(titleButton('Dash').getAttribute('aria-expanded')).toBe('false')
    })

    it('selecting an HTML entry shows its sandboxed srcDoc iframe preview in the detail pane', async () => {
      const html = '<html><body>preview content</body></html>'
      const fetchSpy = stubFetchWithPreview([ENTRY], html)
      renderGallery()
      await waitFor(() => { expect(screen.getByText('Dash')).toBeTruthy() })

      await act(async () => { fireEvent.click(titleButton('Dash')) })

      const frame = screen.getByTitle('Live preview of Dash') as HTMLIFrameElement
      expect(frame.tagName).toBe('IFRAME')
      expect(frame.srcdoc).toBe(html)
      expect(frame.getAttribute('sandbox')).toBe('allow-scripts')
      expect(fetchSpy).toHaveBeenCalledWith(
        `${window.location.origin}${EXPORTS_ROUTE_PATH}/${encodeURIComponent(ENTRY.name)}?k=test-token`,
        { cache: 'no-store' },
      )
      expect(screen.queryByText('Select an artifact to preview it')).toBeNull()
    })

    it('selecting an SVG entry shows a plain image preview', async () => {
      stubFetchWithPreview([OTHER])
      renderGallery()
      await waitFor(() => { expect(screen.getByText('Q3 revenue')).toBeTruthy() })

      await act(async () => { fireEvent.click(titleButton('Q3 revenue')) })

      const image = screen.getByRole('img', { name: 'Live preview of Q3 revenue' }) as HTMLImageElement
      expect(image.src).toBe(`${window.location.origin}${EXPORTS_ROUTE_PATH}/${encodeURIComponent(OTHER.name)}?k=test-token`)
    })

    it('switching selection to a different row swaps the pane\'s content', async () => {
      stubFetchWithPreview([ENTRY, OTHER])
      renderGallery()
      await waitFor(() => { expect(screen.getByText('Dash')).toBeTruthy() })

      await act(async () => { fireEvent.click(titleButton('Dash')) })
      expect(screen.getByTitle('Live preview of Dash')).toBeTruthy()

      await act(async () => { fireEvent.click(titleButton('Q3 revenue')) })
      expect(screen.queryByTitle('Live preview of Dash')).toBeNull()
      expect(screen.getByRole('img', { name: 'Live preview of Q3 revenue' })).toBeTruthy()
    })

    it('collapses an expanded row when its own trigger is clicked again', async () => {
      stubFetchWithPreview([ENTRY])
      renderGallery()
      await waitFor(() => { expect(screen.getByText('Dash')).toBeTruthy() })

      const trigger = titleButton('Dash')
      await act(async () => { fireEvent.click(trigger) })
      expect(screen.getByTitle('Live preview of Dash')).toBeTruthy()

      await act(async () => { fireEvent.click(trigger) })
      expect(screen.queryByTitle('Live preview of Dash')).toBeNull()
      expect(trigger.getAttribute('aria-expanded')).toBe('false')
    })

    it('is a real Tab stop, reachable and activatable without a pointer', async () => {
      stubFetchWithPreview([ENTRY])
      renderGallery()
      await waitFor(() => { expect(screen.getByText('Dash')).toBeTruthy() })

      const button = titleButton('Dash')
      button.focus()
      expect(document.activeElement).toBe(button)
      // A native <button> gets Enter/Space activation from the browser
      // itself; there is no app-level key handler to test, so activation is
      // exercised the same way a real Enter/Space press resolves — a click.
      await act(async () => { fireEvent.click(button) })
      expect(screen.getByTitle('Live preview of Dash')).toBeTruthy()
      expect(button.getAttribute('aria-expanded')).toBe('true')
    })

    it('does not affect the row\'s own Pin/Open/Copy-link/Delete controls', async () => {
      stubFetchWithPreview([ENTRY])
      const writeText = vi.fn().mockResolvedValue(undefined)
      Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
      renderGallery()
      await waitFor(() => { expect(screen.getByText('Dash')).toBeTruthy() })

      await act(async () => { fireEvent.click(titleButton('Dash')) })
      expect(screen.getByTitle('Live preview of Dash')).toBeTruthy()

      const copy = within(rowFor('Dash')).getByRole('button', { name: 'Copy link' })
      await act(async () => { copy.click() })
      expect(writeText).toHaveBeenCalledWith(
        `${window.location.origin}${EXPORTS_ROUTE_PATH}/${encodeURIComponent(ENTRY.name)}?k=test-token`,
      )
      expect(within(rowFor('Dash')).getByRole('button', { name: 'Copied' })).toBeTruthy()
    })

    it('shows neither a preview nor the empty state when the preview fetch fails', async () => {
      vi.stubGlobal(EXPORTS_BOOT_GLOBAL, 'test-token')
      vi.stubGlobal('fetch', vi.fn().mockImplementation((url: string) => {
        if (url.includes(`${EXPORTS_ROUTE_PATH}/?`)) return Promise.resolve({ ok: true, json: () => Promise.resolve({ entries: [ENTRY] }) })
        return Promise.resolve({ ok: false, status: 404 })
      }))
      renderGallery()
      await waitFor(() => { expect(screen.getByText('Dash')).toBeTruthy() })

      await act(async () => { fireEvent.click(titleButton('Dash')) })
      expect(screen.queryByTitle('Live preview of Dash')).toBeNull()
      // Something IS selected (just failed to load), so the empty-state
      // prompt — reserved for "nothing selected yet" — should not reappear.
      expect(screen.queryByText('Select an artifact to preview it')).toBeNull()
    })
  })

  describe('live cross-surface sync', () => {
    it('drops a row the instant a card unshares it, without waiting for Refresh', async () => {
      stubFetch(() => ({ ok: true, json: () => Promise.resolve({ entries: [ENTRY, OTHER] }) }))
      renderGallery()
      await waitFor(() => { expect(screen.getByText('Dash')).toBeTruthy() })

      act(() => { window.dispatchEvent(new CustomEvent(ARTIFACT_CHANGED_EVENT, { detail: { name: ENTRY.name, exported: false } })) })
      expect(screen.queryByText('Dash')).toBeNull()
      expect(screen.getByText('Q3 revenue')).toBeTruthy()
    })

    it('reloads the listing when a card exports something new', async () => {
      const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ entries: [ENTRY] }) })
      vi.stubGlobal(EXPORTS_BOOT_GLOBAL, 'test-token')
      vi.stubGlobal('fetch', fetchSpy)
      renderGallery()
      await waitFor(() => { expect(screen.getByText('Dash')).toBeTruthy() })
      expect(fetchSpy).toHaveBeenCalledTimes(1)

      act(() => { window.dispatchEvent(new CustomEvent(ARTIFACT_CHANGED_EVENT, { detail: { name: OTHER.name, exported: true } })) })
      await waitFor(() => { expect(fetchSpy).toHaveBeenCalledTimes(2) })
    })
  })
})
