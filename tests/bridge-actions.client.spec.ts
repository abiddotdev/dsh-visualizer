// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { openWidgetLink, submitWidgetPrompt, WIDGET_PROMPT_PREFIX } from '../src/client/bridge-actions.ts'

afterEach(() => {
  vi.restoreAllMocks()
})

describe('submitWidgetPrompt', () => {
  it('writes the tagged draft and submits the turn', () => {
    const setDraft = vi.fn()
    const submit = vi.fn()
    submitWidgetPrompt({ setDraft, submit }, 'why the spike')
    expect(setDraft).toHaveBeenCalledWith(`${WIDGET_PROMPT_PREFIX}why the spike`)
    expect(submit).toHaveBeenCalledTimes(1)
  })
})

describe('openWidgetLink', () => {
  it('opens an http(s) URL in a new tab without an opener handle', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    openWidgetLink('https://example.com/report')
    expect(open).toHaveBeenCalledWith('https://example.com/report', '_blank', 'noopener,noreferrer')
  })

  it('drops every other scheme without opening anything', () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null)
    for (const url of ['javascript:alert(1)', 'data:text/html,hi', 'file:///etc/passwd', 'vbscript:x', 'example.com', '']) {
      openWidgetLink(url)
    }
    expect(open).not.toHaveBeenCalled()
  })
})
