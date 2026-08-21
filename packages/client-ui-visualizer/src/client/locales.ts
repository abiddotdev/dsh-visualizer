/** Streaming inline HTML card dictionaries. */

export const NS = 'generativeui'

/** Simplified Chinese streaming-HTML card messages. */
export const zh = {
  'card.title': 'HTML 预览',
  'card.streaming': '正在流式生成…',
  'card.chars': '{chars} 字符',
  'card.interrupted': '已中断，内容不完整',
  'row.title': 'HTML 预览',
  'row.running': '正在渲染…',
  'row.chars': '{chars} 字符',
  'row.missing': '调用参数中没有可渲染的 HTML',
  'row.download': '下载 HTML',
} as const

/** English streaming-HTML card messages. */
export const en = {
  'card.title': 'HTML preview',
  'card.streaming': 'Streaming…',
  'card.chars': '{chars} chars',
  'card.interrupted': 'Interrupted; document incomplete',
  'row.title': 'HTML preview',
  'row.running': 'Rendering…',
  'row.chars': '{chars} chars',
  'row.missing': 'Call arguments carry no renderable HTML',
  'row.download': 'Download HTML',
} as const

/** Dictionary keys of this namespace. */
export type GenerativeUiKey = keyof typeof en
