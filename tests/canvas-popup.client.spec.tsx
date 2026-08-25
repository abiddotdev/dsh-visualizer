// @vitest-environment jsdom
/**
 * Client-side canvas popup specs: the scene reconstruction contract against
 * the DEPLOYED conversation snapshot shapes (ToolResultNode rows, running
 * calls, partial blocks) and the panel interaction loop (toggle open, draw,
 * release — the panel must stay open).
 */
import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { CanvasPopup, collectSceneSources, reconstructScene } from '../src/client/CanvasPopup.tsx'
import type { CanvasSessionView } from '../src/client/CanvasPopup.tsx'
import type { CanvasOp } from '../src/canvas/types.ts'

afterEach(cleanup)

const T = (_key: string): string => _key

const INPUT_ACTIONS = {
  setDraft: () => {},
  submit: () => {},
} as never

/** Deployed ToolResultNode shape: kind 'tool-result', call head under `call`. */
function toolResultNode(name: string, argsRaw: string): unknown {
  return {
    kind: 'tool-result',
    seq: 1,
    time: 0,
    callId: 'call-1',
    call: { name, argsRaw },
    content: [],
    isError: false,
    subCalls: [],
  }
}

function sessionWithNodes(nodes: readonly unknown[]): CanvasSessionView {
  const order = nodes.map((_, i) => `n${i}`)
  const map = new Map(order.map((key, i) => [key, nodes[i]]))
  return { chat: { order, nodes: { get: key => map.get(key) } } }
}

describe('collectSceneSources (deployed snapshot shapes)', () => {
  it('finds settled canvas_draw rows shaped as ToolResultNode', () => {
    const session = sessionWithNodes([
      toolResultNode('canvas_draw', '{"ops":[{"op":"rect","color":"ink","bounds":[0,0,9,9]}]}'),
      toolResultNode('visualizer', '{"html":"<p>x</p>"}'),
    ])
    const sources = collectSceneSources(session)
    expect(sources).toHaveLength(1)
    expect(sources[0]?.settled).toBe(true)
  })

  it('ignores non-canvas rows and rows without a paired call head', () => {
    const session = sessionWithNodes([
      toolResultNode('todo_write', '{"todos":[]}'),
      { kind: 'tool-result', call: null },
    ])
    expect(collectSceneSources(session)).toHaveLength(0)
  })
})

describe('reconstructScene', () => {
  it('folds the last settled whole-scene snapshot', () => {
    const scene: CanvasOp[] = [{ op: 'ellipse', color: 'accent', width: 3, bounds: [10, 10, 40, 40] }]
    const session = sessionWithNodes([
      toolResultNode('canvas_draw', JSON.stringify({ ops: scene })),
    ])
    expect(reconstructScene(session).ops).toEqual(scene)
  })

  it('prefers a newer settled row over an older one (whole-scene replace)', () => {
    const session = sessionWithNodes([
      toolResultNode('canvas_draw', '{"ops":[{"op":"stroke","color":"ink","points":[1,2,3,4]}]}'),
      toolResultNode('canvas_draw', '{"ops":[{"op":"text","color":"ink","text":"hi","at":[5,5]}]}'),
    ])
    expect(reconstructScene(session).ops).toEqual([
      { op: 'text', color: 'ink', size: 20, text: 'hi', at: [5, 5] },
    ])
  })

  it('surfaces a live preview while the call is still streaming', () => {
    const session: CanvasSessionView = {
      chat: { order: [], nodes: { get: () => undefined } },
      partial: {
        blocks: [{
          kind: 'tool-call',
          name: 'canvas_draw',
          argsRaw: '{"ops":[{"op":"stroke","color":"ink","width":3,"points":[0,0,50,50',
        }],
      },
    }
    const view = reconstructScene(session)
    expect(view.liveOps).toBeGreaterThan(0)
    expect(view.preview).not.toBeNull()
  })
})

describe('CanvasPopup panel', () => {
  it('shows the folded op count and stays open through a stroke release', () => {
    const scene: CanvasOp[] = [
      { op: 'rect', color: 'ink', width: 3, bounds: [10, 10, 60, 60] },
      { op: 'ellipse', color: 'accent', width: 2, bounds: [20, 20, 30, 30] },
    ]
    const session = sessionWithNodes([toolResultNode('canvas_draw', JSON.stringify({ ops: scene }))])
    render(<CanvasPopup t={T} inputActions={INPUT_ACTIONS} session={session} />)

    // Summary reflects the folded durable scene (the "always 0 ops" regression).
    expect(screen.getByText('2 op(s)').textContent).toBe('2 op(s)')

    // Open the panel.
    fireEvent.click(screen.getByRole('button', { expanded: false }))
    const overlay = screen.getByLabelText('canvas.overlay') as HTMLCanvasElement

    // Draw a stroke: down → move → up. The panel must stay open afterwards
    // ("I lose the canvas on release" regression), including a synthetic
    // click right after the release (touch engines fire one).
    const rect = overlay.getBoundingClientRect()
    fireEvent.pointerDown(overlay, { pointerId: 1, clientX: rect.left + 10, clientY: rect.top + 10 })
    fireEvent.pointerMove(overlay, { pointerId: 1, clientX: rect.left + 40, clientY: rect.top + 30 })
    fireEvent.pointerUp(overlay, { pointerId: 1, clientX: rect.left + 60, clientY: rect.top + 40 })
    fireEvent.click(overlay)
    expect(screen.getByLabelText('canvas.overlay')).toBeTruthy()
    expect(screen.getByRole('button', { expanded: true })).toBeTruthy()

    // The stroke committed into the store: summary unchanged, clear enabled.
    expect((screen.getByText('canvas.clearMine') as HTMLButtonElement).disabled).toBe(false)
  })

  it('degrades to the fallback pill when the projection hook throws for the canvas key', () => {
    const session = sessionWithNodes([toolResultNode('canvas_draw', '{"ops":[{"op":"rect","color":"ink","bounds":[0,0,9,9]}]}')])
    const throwing = (_key: string): unknown => {
      throw new Error('unknown projection key')
    }
    // The boundary contains the fault: the dock entry stays visible.
    render(<CanvasPopup t={T} inputActions={INPUT_ACTIONS} session={session} useProjection={throwing} />)
    expect(screen.getByTestId('canvas-popup-error')).toBeTruthy()
    expect(screen.getByText('canvas.title')).toBeTruthy()
  })
})
