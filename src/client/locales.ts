/** Streaming inline HTML card dictionaries. */

export const NS = 'visualizer'

/** Simplified Chinese streaming-HTML card messages. */
export const zh = {
  'card.title': 'HTML 预览',
  'card.thinking': '正在构思文档',
  'card.streaming': '正在流式生成',
  'card.chars': '{chars} 字符',
  'card.interrupted': '已中断，内容不完整',
  'card.copy': '复制 HTML',
  'card.copied': '已复制',
  'card.fullscreen': '全屏',
  'card.exitFullscreen': '退出全屏',
  'card.share': '打开独立页面',
  'card.scriptError': '库加载失败，交互可能不可用',
  'card.runtimeError': '脚本错误：',
  'row.title': 'HTML 预览',
  'row.running': '正在渲染…',
  'row.chars': '{chars} 字符',
  'row.missing': '调用参数中没有可渲染的 HTML',
  'row.download': '下载 HTML',
  'row.copy': '复制 HTML',
  'row.copied': '已复制',
  'row.fullscreen': '全屏',
  'row.exitFullscreen': '退出全屏',
  'row.share': '打开独立页面',
  'row.scriptError': '库加载失败，交互可能不可用',
  'row.runtimeError': '脚本错误：',
} as const

/** English streaming-HTML card messages. */
export const en = {
  'card.title': 'HTML preview',
  'card.thinking': 'Composing the document',
  'card.streaming': 'Streaming...',
  'card.chars': '{chars} chars',
  'card.interrupted': 'Interrupted; document incomplete',
  'card.copy': 'Copy HTML',
  'card.copied': 'Copied',
  'card.fullscreen': 'Fullscreen',
  'card.exitFullscreen': 'Exit fullscreen',
  'card.share': 'Open standalone page',
  'card.scriptError': 'A library failed to load; interactivity may be unavailable',
  'card.runtimeError': 'Script error: ',
  'row.title': 'HTML preview',
  'row.running': 'Rendering…',
  'row.chars': '{chars} chars',
  'row.missing': 'Call arguments carry no renderable HTML',
  'row.download': 'Download HTML',
  'row.copy': 'Copy HTML',
  'row.copied': 'Copied',
  'row.fullscreen': 'Fullscreen',
  'row.exitFullscreen': 'Exit fullscreen',
  'row.share': 'Open standalone page',
  'row.scriptError': 'A library failed to load; interactivity may be unavailable',
  'row.runtimeError': 'Script error: ',
} as const

/** Dictionary keys of this namespace. */
export type GenerativeUiKey = keyof typeof en
