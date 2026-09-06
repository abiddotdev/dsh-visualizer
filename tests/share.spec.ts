// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ARTIFACT_CHANGED_EVENT, type ArtifactChangedDetail, artifactListUrl, artifactPageUrlByName, copyArtifactLink, exportCall, openArtifactPage } from '../src/client/share.ts'
import { EXPORTS_BOOT_GLOBAL, EXPORTS_ROUTE_PATH } from '../src/shared/export-name.ts'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('artifactListUrl', () => {
  it('is null where the host never announced the exports route', () => {
    expect(artifactListUrl()).toBeNull()
  })

  it('addresses the route root, carrying the announced token', () => {
    vi.stubGlobal(EXPORTS_BOOT_GLOBAL, 'test-token')
    expect(artifactListUrl()).toBe(`${window.location.origin}${EXPORTS_ROUTE_PATH}/?k=test-token`)
  })
})

describe('artifactPageUrlByName', () => {
  it('is null where the host never announced the exports route', () => {
    expect(artifactPageUrlByName('dash-abc1234567890f.html')).toBeNull()
  })

  it('addresses the exact served name, encoded and token-gated', () => {
    vi.stubGlobal(EXPORTS_BOOT_GLOBAL, 'test-token')
    expect(artifactPageUrlByName('中文 图表-abc1234567890f.html')).toBe(
      `${window.location.origin}${EXPORTS_ROUTE_PATH}/${encodeURIComponent('中文 图表-abc1234567890f.html')}?k=test-token`,
    )
  })
})

describe('exportCall', () => {
  it('resolves null without a request where sharing is not announced', async () => {
    const fetchSpy = vi.fn()
    vi.stubGlobal('fetch', fetchSpy)
    await expect(exportCall('call-1')).resolves.toBeNull()
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('posts only the call id — never document bytes — to the token-gated route root', async () => {
    vi.stubGlobal(EXPORTS_BOOT_GLOBAL, 'test-token')
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ name: 'dash-abc1234567890f.html' }) })
    vi.stubGlobal('fetch', fetchSpy)

    await expect(exportCall('call-1')).resolves.toBe('dash-abc1234567890f.html')
    expect(fetchSpy).toHaveBeenCalledWith(
      `${window.location.origin}${EXPORTS_ROUTE_PATH}/?k=test-token`,
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ callId: 'call-1' }) },
    )
  })

  it('resolves null when the host refuses the request', async () => {
    vi.stubGlobal(EXPORTS_BOOT_GLOBAL, 'test-token')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }))
    await expect(exportCall('call-1')).resolves.toBeNull()
  })

  it('resolves null when the response carries no usable name', async () => {
    vi.stubGlobal(EXPORTS_BOOT_GLOBAL, 'test-token')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ name: '' }) }))
    await expect(exportCall('call-1')).resolves.toBeNull()
  })

  it('resolves null when the request throws', async () => {
    vi.stubGlobal(EXPORTS_BOOT_GLOBAL, 'test-token')
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network down')))
    await expect(exportCall('call-1')).resolves.toBeNull()
  })

  it('broadcasts the confirmed name so every other surface can reconcile live', async () => {
    vi.stubGlobal(EXPORTS_BOOT_GLOBAL, 'test-token')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: () => Promise.resolve({ name: 'dash-abc1234567890f.html' }) }))
    const onChanged = vi.fn()
    window.addEventListener(ARTIFACT_CHANGED_EVENT, onChanged)
    try {
      await exportCall('call-1')
      expect(onChanged).toHaveBeenCalledTimes(1)
      const detail = (onChanged.mock.calls[0][0] as CustomEvent<ArtifactChangedDetail>).detail
      expect(detail).toEqual({ name: 'dash-abc1234567890f.html', exported: true })
    } finally {
      window.removeEventListener(ARTIFACT_CHANGED_EVENT, onChanged)
    }
  })

  it('does not broadcast when the request fails', async () => {
    vi.stubGlobal(EXPORTS_BOOT_GLOBAL, 'test-token')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 404 }))
    const onChanged = vi.fn()
    window.addEventListener(ARTIFACT_CHANGED_EVENT, onChanged)
    try {
      await exportCall('call-1')
      expect(onChanged).not.toHaveBeenCalled()
    } finally {
      window.removeEventListener(ARTIFACT_CHANGED_EVENT, onChanged)
    }
  })
})

describe('openArtifactPage', () => {
  it('does nothing where sharing is not announced', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    expect(openArtifactPage('dash-abc1234567890f.html')).toBe(false)
    expect(open).not.toHaveBeenCalled()
  })

  it('opens the exact URL a caller already confirmed exists', () => {
    vi.stubGlobal(EXPORTS_BOOT_GLOBAL, 'test-token')
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    expect(openArtifactPage('dash-abc1234567890f.html')).toBe(true)
    expect(open).toHaveBeenCalledWith(
      `${window.location.origin}${EXPORTS_ROUTE_PATH}/dash-abc1234567890f.html?k=test-token`,
      '_blank',
      'noopener,noreferrer',
    )
  })
})

describe('copyArtifactLink', () => {
  it('resolves false where sharing is not announced', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    await expect(copyArtifactLink('dash-abc1234567890f.html')).resolves.toBe(false)
    expect(writeText).not.toHaveBeenCalled()
  })

  it('copies the exact URL a caller already confirmed exists', async () => {
    vi.stubGlobal(EXPORTS_BOOT_GLOBAL, 'test-token')
    const writeText = vi.fn().mockResolvedValue(undefined)
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    await expect(copyArtifactLink('dash-abc1234567890f.html')).resolves.toBe(true)
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}${EXPORTS_ROUTE_PATH}/dash-abc1234567890f.html?k=test-token`)
  })
})
