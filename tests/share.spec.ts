// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { artifactListUrl, artifactPageUrlByName, exportPageUrl } from '../src/client/share.ts'
import { EXPORTS_BOOT_GLOBAL, EXPORTS_ROUTE_PATH } from '../src/shared/export-name.ts'

afterEach(() => {
  vi.unstubAllGlobals()
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

  it('addresses the exact served name the listing returned, encoded and token-gated', () => {
    vi.stubGlobal(EXPORTS_BOOT_GLOBAL, 'test-token')
    expect(artifactPageUrlByName('中文 图表-abc1234567890f.html')).toBe(
      `${window.location.origin}${EXPORTS_ROUTE_PATH}/${encodeURIComponent('中文 图表-abc1234567890f.html')}?k=test-token`,
    )
  })

  it('addresses the same URL exportPageUrl derives for the matching title and bytes', () => {
    vi.stubGlobal(EXPORTS_BOOT_GLOBAL, 'test-token')
    const html = '<p>revenue</p>'
    const byTitle = exportPageUrl('Dash', html)
    expect(byTitle).not.toBeNull()
    const name = byTitle!.split('/').pop()!.split('?')[0]!
    expect(artifactPageUrlByName(decodeURIComponent(name))).toBe(byTitle)
  })
})
