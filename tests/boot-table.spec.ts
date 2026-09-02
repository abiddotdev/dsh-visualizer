// @vitest-environment node
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { describe, expect, it } from 'vitest'
import { Context, Service } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as visualizer from '../src/index.ts'
import { CHAT_PREVIEW_BOOT_GLOBAL } from '../src/shared/chat-preview.ts'

/**
 * Minimal stand-in for the harness web server's route registry, mirroring
 * the one in export-fanout.spec.ts — this spec only needs the
 * `webserver/index-inject` emit, never a registered route.
 */
class FakeWebServer extends Service {
  constructor(ctx: Context) {
    super(ctx, 'webServer')
  }

  register(_route: { kind: string; path: string; handler: (req: IncomingMessage, res: ServerResponse) => unknown }): () => void {
    return () => {}
  }
}

async function setup(config: Record<string, unknown> = {}): Promise<Context> {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-visualizer-boot-table-'))
  const ctx = new Context()
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(FakeWebServer)
  await ctx.plugin(visualizer, { artifactDir: dir, shareArtifacts: false, ...config })
  // The webServer-injected sub-fiber activates on its own microtask chain.
  await new Promise(resolve => { setTimeout(resolve, 10) })
  return ctx
}

function injectTable(ctx: Context): unknown[] {
  const table: unknown[] = []
  ;(ctx as unknown as { emit: (name: string, ...args: unknown[]) => void }).emit('webserver/index-inject', table)
  return table
}

describe('chat-preview boot announcement', () => {
  it('announces the feature flag while chatPreview is enabled (the default)', async () => {
    const ctx = await setup()
    const table = injectTable(ctx)
    expect(table).toEqual([{ kind: 'global', name: CHAT_PREVIEW_BOOT_GLOBAL, value: '1' }])
  })

  it('announces nothing once chatPreview is disabled', async () => {
    const ctx = await setup({ chatPreview: false })
    expect(injectTable(ctx)).toEqual([])
  })
})
