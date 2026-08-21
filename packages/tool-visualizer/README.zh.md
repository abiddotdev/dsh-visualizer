# dsh-tool-visualizer

[English](README.md) | 中文

模型可见的 `visualizer` 工具：内联 HTML 呈现的参数流式半边。模型把完整自包含文档作为 `html` 参数直接传入（schema 中排在最后），浏览器卡片（`dsh-client-ui-visualizer`）在模型还在书写时就对不断增长的调用参数前缀做解码，绘出实时预览。全程不触碰工作区：文档的持久载体就是记录在案的 `tool/call` 参数本身。

**文档即调用。** `execute` 只校验参数携带的内容——非空文档、可配置的 `maxHtmlBytes` 上限（默认 256 KiB，按 UTF-8 字节计）、50–2000 px 的整数开画高度（帧随后随内容增长）、非空白的显式标题——并返回一行规范结果（`Rendered <title> (<bytes> bytes, <height>px frame)`）。不注入文件系统服务，不投影呈现元数据：落定后的卡片读取的是同一份已记录参数。

**schema 顺序即流式契约。** `title` 与 `height` 排在 `html` 之前，使二者在文档开引号前即可解码；`html` 排在最后，意味着参数 JSON 的每个流式前缀都终止在文档字符串内部——这正是前缀预览可行的原因。工具描述明确写出这一顺序，让模型遵守。

**token 成本是明知的取舍。** 文档字节随模型可见的调用参数进入请求并在后续轮次重放，与同尺寸 `write` 调用的内容代价相同；该流程省去了单独的一次写盘往返。必须在工作区留存的文档请改用 `write` 加 `show_html`——提示词指引已写明。

## Model Experience

### 系统提示词指引（`tool:visualizer`）

#### 模型看到什么

一个教授"直接调用"工作流的提示词小节，与各工具指引小节一同排序。

##### 逐字文本

```markdown
To present an HTML page in the chat, call visualizer with the complete self-contained document as the html argument, html last; the document streams into a sandboxed frame while you write. Use write plus show_html instead when the document must persist as a workspace file.
```

#### Token 影响

固定：一个小节，挂载该工具即始终存在。

#### KV Cache 影响

稳定重复前缀；小节文本静态，不会使既有前缀失效。

### `visualizer` 工具 schema

#### 模型看到什么

三个原始参数——`title`（可选字符串）、`height`（可选整数）、`html`（必填字符串，声明在最后）——以及生成的[工具目录](../../../docs/tool-catalog.md#deepseek-aidsh-tool-visualizer)里的描述。

#### Token 影响

条件出现：仅在挂载该工具的会话中出现；每次调用的参数携带完整文档，成本随文档大小增长，上限为 `maxHtmlBytes`。

#### KV Cache 影响

只追加：每次调用的参数追加在既有前缀之后；不替换、不改写更早的请求 token。

## Known Limitations and Deferred Work

- **文档消耗上下文**——字节存在于模型可见的调用参数中，压缩前每轮重放；超大的或需要留存的产物应走 `write` + `show_html` 流程。
- **乱序 schema 会让预览退化**——若模型把 `html` 放在前面，前缀解码器读不到已落定的 `title`/`height`，卡片在调用完成前回退到默认值；描述与提示词指引固定了顺序，但无法强制。
- **height 参数只是开画提示**——帧随内容自动增长并在 4000 px 钳制，`height` 值不约束卡片呈现的内容范围；模型不应依赖它做精确取景。
