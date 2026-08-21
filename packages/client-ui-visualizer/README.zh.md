# dsh-client-ui-visualizer

[English](README.md) | 中文

流式内联 HTML 卡片，浏览器半边：模型书写 `visualizer` 调用时实时预览的 `visualizer-stream` 聊天节点，以及调用派发后接管呈现的按工具名键控的 `visualizer` 工具行。

**实时预览解码流式参数。** 工具调用参数增量在会话引擎中累积；节点 State 保留本步骤的 `visualizer` 块（无关工具在参数累积前即被丢弃），字符串感知的前缀扫描器（`partial-args.ts`）解码不断增长的 `html` 字符串值——反转义 JSON 转义、丢弃悬置转义、被截断的 `\u` 序列与被截断的代理对——同时读出先落定的 `title` 与 `height`。重放已记录的会话会重建完全一致的卡片序列，因为每个输入都是会话事件。

**实时帧从不重载。** 每张卡片把一份 shell 文档（`shell.ts`：默认白色页面画布、带公共 CDN 白名单的 CSP、流式冻结与 `postMessage` 桥）载入 `sandbox="allow-scripts"` 的空源 iframe，经 `StreamFrameController` 喂入标记——单动画帧 latest-wins 合并、50 ms 最小间隔、shell `load` 前缓冲消息。桥以惰性标记应用前缀（`innerHTML` 不执行 `<script>`；事件处理器属性只在空源帧内触发），整个流式阶段剥离动画，并在唯一的终态 `commit` 上解除冻结、通过克隆每个 `<script>` 节点让文档脚本恰好执行一次。被中断的流保留最后绘制的部分画面，且永不执行脚本。

**帧高随内容自适应。** 两张卡片都以短高开画——流式卡为聊天行高度，落定行为调用中的 `height` 参数——桥把测得的内容高度回报宿主（`size` 消息加 `ResizeObserver`，按帧自身窗口匹配并在宿主侧钳制到 24–4000 px），卡片因此像聊天文本一样随文档增长，仅在超过上限后滚动。

**落定工具行经同一 shell 重放。** 执行器记录 `tool/call` 后，流式节点隐藏，键控的 `tool.call.toolview` 行把完整参数一次性 commit 进共享 shell 帧——单次 commit、脚本执行一次。其下载控件在客户端把同一份字节物化为 Blob 并以净化后的文件名保存；只在落定成功的调用上出现，因为不完整的下载按定义就是损坏的。

**没有它的工具，两行都是惰性的。** 卡片注册在开放的键域下（`conversation.chat.node` 键 `visualizer-stream`、`tool.call.toolview` 键 `visualizer`）；标准 agent preset 挂载了 `dsh-tool-visualizer`，未挂载它的预设的会话不会产生此类调用。本包自身也不组合任何 host 行为。

`/client` 导出面是插件主体（`apply`/`inject`）与组合 props 类型。

## Model Experience

无：本包不新增提示词内容，不暴露模型可见面，也不写会话事件；它渲染的是另一个包产生的流式与落定调用参数，交互状态（展开/折叠标志）为组件局部。

#### KV Cache 影响

无：没有任何提示词输入源于此处；卡片的流式、展开或下载不会改变任何模型请求。

## Known Limitations and Deferred Work

- **脚本只在 commit 执行**——实时预览绘制惰性标记；行为依赖脚本的文档在调用完成前不显示任何交互性，这是有意为之（部分 DOM 加运行中的脚本既不正确，也是 pi_generative_ui 用实验证明过的风险）。
- **commit 后的布局变化可能不再回报**——高度回报依附于每次 render/commit 与根元素 `ResizeObserver`；commit 后才增高的内容（晚到的图片、异步脚本）在下一条消息到来前可能超出帧高。
- **参数乱序会让实时卡片退化**——若模型把 `html` 放在 `title`/`height` 之前，扫描器读不到二者，卡片在调用完成前回退默认值；工具描述固定了顺序，但客户端无法强制。
- **CDN 可达性是文档自身的问题**——shell CSP 允许与落定文档相同的四个公共 CDN；引用其他来源的产物只能部分加载，卡片层无诊断信息。
