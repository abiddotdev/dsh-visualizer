/**
 * Announcements this plugin pushes onto the web UI's boot table — the
 * `webserver/index-inject` rows a served page applies as `globalThis`
 * values, the one host→client channel. Rows are read fresh at every page
 * emit, so each announcement lives exactly as long as its feature's config:
 * toggling config and reloading flips the client half's behavior.
 * @module dsh-visualizer/boot-table
 */

import type { Context } from '@deepseek-ai/cordis'
import { CHAT_PREVIEW_BOOT_GLOBAL } from './shared/chat-preview.ts'
import type { LooseOn } from './export-fanout.ts'

/**
 * Announce the settled-preview feature: wherever a web server mounts, the
 * served page gets the boot global the client half probes to decide whether
 * settled `visualizer` calls render their own chat node. Independent of the
 * export fanout — the preview needs no serve route, only the announcement.
 * @param ctx - context carrying the `webServer` service when one exists.
 */
export function announceChatPreview(ctx: Context): void {
  ctx.inject(['webServer'], webCtx => {
    const on = (webCtx as unknown as { on: LooseOn }).on
    on('webserver/index-inject', (table: unknown) => {
      if (Array.isArray(table)) {
        table.push({ kind: 'global', name: CHAT_PREVIEW_BOOT_GLOBAL, value: '1' })
      }
    })
  })
}
