import { describe, expect, it } from 'vitest'
import { normalTranscriptView } from '../src/client/transcript-view.ts'

describe('normalTranscriptView', () => {
  it('reads true only for an explicit normal value', () => {
    expect(normalTranscriptView({ value: { transcriptView: 'normal' } })).toBe(true)
  })

  it('reads false for compact', () => {
    expect(normalTranscriptView({ value: { transcriptView: 'compact' } })).toBe(false)
  })

  it('defaults to false (compact) before the section has loaded', () => {
    expect(normalTranscriptView({ value: undefined })).toBe(false)
  })

  it('defaults to false (compact) when the field is absent from an otherwise-loaded section', () => {
    expect(normalTranscriptView({ value: {} })).toBe(false)
  })
})
