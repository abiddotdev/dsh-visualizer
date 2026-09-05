// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
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

/** Locale seat over the package dictionary. */
const t = ((key: keyof typeof en) => en[key]) as ArtifactGalleryProps['t']

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

describe('ArtifactGallery', () => {
  it('lists every finalized export, newest first, with size and open/copy actions', async () => {
    stubFetch(() => ({ ok: true, json: () => Promise.resolve({ entries: [ENTRY] }) }))
    renderGallery()

    expect(screen.getByText('Loading…')).toBeTruthy()
    await waitFor(() => { expect(screen.getByText('Dash')).toBeTruthy() })
    expect(screen.getByText('HTML')).toBeTruthy()
    expect(screen.getByText(/12\.3 KB/)).toBeTruthy()

    const open = screen.getByRole('link', { name: 'Open' })
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

  it('hides the search box when there is nothing to search', async () => {
    stubFetch(() => ({ ok: true, json: () => Promise.resolve({ entries: [] }) }))
    renderGallery()
    await waitFor(() => { expect(screen.getByText('Nothing shared yet — renders appear here once a visualizer call settles')).toBeTruthy() })
    expect(screen.queryByRole('searchbox')).toBeNull()
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
    await act(async () => { screen.getByRole('button', { name: 'Copy link' }).click() })
    expect(writeText).toHaveBeenCalledWith(
      `${window.location.origin}${EXPORTS_ROUTE_PATH}/${encodeURIComponent(ENTRY.name)}?k=test-token`,
    )
    expect(screen.getByRole('button', { name: 'Copied' })).toBeTruthy()
    act(() => { vi.advanceTimersByTime(COPY_FEEDBACK_MS) })
    expect(screen.getByRole('button', { name: 'Copy link' })).toBeTruthy()
  })
})
