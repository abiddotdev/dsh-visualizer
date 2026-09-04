// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, render, screen } from '@testing-library/react'
// Pulls this package's LocaleNamespaceMap merge into the program so the
// composed props type carries the `t` seat (the merge lives in the entry).
import type {} from '../src/client/index.ts'
import { TurnTailCard, type TurnTailCardProps } from '../src/client/TurnTailCard.tsx'
import type { ChatSettingsSection } from '../src/client/transcript-view.ts'
import type { VisualizerTurnCard } from '../src/client/turn-tail.ts'
import { en } from '../src/client/locales.ts'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

/** Locale seat over the package dictionary; interpolates the single numeric param. */
const t = ((key: keyof typeof en, params?: Record<string, string | number>) =>
  en[key].replace(/\{(\w+)\}/g, (_m, name: string) => String(params?.[name] ?? ''))) as TurnTailCardProps['t']

const DOC = '<!DOCTYPE html><html><body><p>revenue</p></body></html>'

function card(argsRaw: string, callId = 'c1'): VisualizerTurnCard {
  return { callId, seq: 2, argsRaw }
}

function noopActions(): TurnTailCardProps['inputActions'] {
  return { setDraft: () => { throw new Error('unused') }, submit: () => { throw new Error('unused') } }
}

/** Test stub for the synthesized `useTranscriptView` selector Hook, fixed to one mode. */
function transcriptViewStub(transcriptView: ChatSettingsSection['transcriptView']): TurnTailCardProps['useTranscriptView'] {
  return selector => selector({ value: { transcriptView } })
}

describe('TurnTailCard', () => {
  it('renders one document per settled call, in order, when transcript view is compact', () => {
    render(<TurnTailCard matched={[
      card(JSON.stringify({ title: 'First', html: DOC }), 'c1'),
      card(JSON.stringify({ title: 'Second', html: DOC }), 'c2'),
    ]} t={t} inputActions={noopActions()} useTranscriptView={transcriptViewStub('compact')} />)

    const titles = [...document.querySelectorAll('[class*="_title_"]')].map(el => el.textContent)
    expect(titles).toEqual(['First', 'Second'])
    expect(document.querySelectorAll('iframe')).toHaveLength(2)
  })

  it('renders nothing when transcript view is normal — the in-place row already shows it', () => {
    const { container } = render(<TurnTailCard matched={[
      card(JSON.stringify({ title: 'Dash', html: DOC })),
    ]} t={t} inputActions={noopActions()} useTranscriptView={transcriptViewStub('normal')} />)

    expect(container.firstChild).toBeNull()
    expect(document.querySelector('iframe')).toBeNull()
  })

  it('renders as compact (the fail-safe default) when the setting has not loaded yet', () => {
    render(<TurnTailCard matched={[card(JSON.stringify({ title: 'Dash', html: DOC }))]} t={t} inputActions={noopActions()}
      useTranscriptView={selector => selector({ value: undefined })} />)
    expect(document.querySelector('iframe')).not.toBeNull()
  })

  it('forwards a submitted widget prompt as one tagged turn', () => {
    const setDraft = vi.fn()
    const submit = vi.fn()
    render(<TurnTailCard matched={[card(JSON.stringify({ title: 'Dash', html: DOC }))]} t={t}
      inputActions={{ setDraft, submit }} useTranscriptView={transcriptViewStub('compact')} />)
    const frame = document.querySelector('iframe')
    if (frame === null) throw new Error('frame not rendered')

    window.dispatchEvent(new MessageEvent('message', {
      data: { __dshGui: true, type: 'sendPrompt', text: 'break down Q3 by region' },
      source: frame.contentWindow,
    }))
    expect(setDraft).toHaveBeenCalledWith('[widget] break down Q3 by region')
    expect(submit).toHaveBeenCalledTimes(1)
  })

  it('renders nothing for an empty turn', () => {
    const { container } = render(<TurnTailCard matched={[]} t={t} inputActions={noopActions()} useTranscriptView={transcriptViewStub('compact')} />)
    expect(container.querySelector('[class*="card"]')).toBeNull()
  })

  it('skips a call whose arguments carry no document without breaking its siblings', () => {
    render(<TurnTailCard matched={[
      card('{}', 'c1'),
      card(JSON.stringify({ title: 'Second', html: DOC }), 'c2'),
    ]} t={t} inputActions={noopActions()} useTranscriptView={transcriptViewStub('compact')} />)
    expect(screen.getByText('Second')).toBeTruthy()
    expect(document.querySelectorAll('iframe')).toHaveLength(1)
  })
})
