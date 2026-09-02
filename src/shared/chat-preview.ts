/**
 * Plane-neutral announcement of the chat-preview feature, shared by both
 * planes. The host half pushes the global onto the web server's index-inject
 * table while the `chatPreview` config is live, and the browser half probes
 * it to decide whether settled calls render their own chat node — a
 * deployment with the feature off never sets it, and both surfaces keep the
 * pre-chat-node presentation. The node half may import this module (it is
 * pure), but nothing here may import either plane.
 * @module dsh-visualizer/shared/chat-preview
 */

/**
 * `globalThis` property the host sets through the web server's index-inject
 * table while settled previews render as chat nodes. Same channel as
 * {@link EXPORTS_BOOT_GLOBAL} in `./export-name.ts`: announced through the
 * boot table, read through a `globalThis` probe. Absent means the deployment
 * disabled the feature (`chatPreview: false`), and the tool row keeps the
 * settled frame instead.
 */
export const CHAT_PREVIEW_BOOT_GLOBAL = '__DSH_VISUALIZER_CHAT_PREVIEW__'
