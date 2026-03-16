# alibaba/page-agent 深度调研报告

## 1. 宏观信息
- **仓库地址**: [alibaba/page-agent](https://github.com/alibaba/page-agent)
- **Stars**: ~9.1k
- **定位**: 阿里巴巴开源的前端 JavaScript In-page GUI Web 自动化代理引擎，强调纯前端无头接入。
- **核心技术栈**: TypeScript, Frontend DOM Injected Script (不依赖 Puppeteer/CDP 后端架构)。

## 2. 核心架构与底层机制 (The In-Page Agent)
与其他自动化框架（如 Playwright 或 Selenium）强依赖一个运行在 Node/Python 环境下的 `Browser/Page` 控制器不同，PageAgent 最大的特点是**将整个智能体的大脑（Agent Loop）和感知器（Controller）作为一个巨大的 JS 闭包，直接注射到目标网页的 V8 上下文 (In-Page) 去执行**。

### 2.1 Re-act Loop (`PageAgentCore`)
它的核心是一个纯前端的异步有限状态机循环（Re-act Loop: Observe -> Think -> Act）：
- **Observe (感知)**: 每一轮探查，它调用自身的 `pageController.getBrowserState()` 提取当前快照，并将导航拦截、警告等系统级 `observation` 压入历史栈 `history`。
- **Think (思考 - MacroTool 机制)**: 为了防止 LLM 过快采取行动而导致操作变形，它独创了 `MacroTool` 打包器。它强制要求 LLM 在输出最终的工具调用 JSON 之前，必须先按预定义的结构输出反思（Reflection Fields: `evaluation_previous_goal`, `memory`, `next_goal`），相当于在底层强制植入了思维链 (Chain of Thought)。
- **Act (执行)**: LLM 解算出指令后，在纯前端调用 `PageController` 执行。

### 2.2 降维的页面控制器 (`PageController`)
它是大模型能够“看懂” Web 页面的关键转换器：
- **`FlatDomTree` 压缩算法**: 网页的真实 HTML 过于庞大且充满无效的嵌套、Script 和被遮挡的 DIV。算法会顺着 DOM 树进行降维遍历：剔除不可见节点，将叠在一起只有顶层响应点击的元素提纯，然后给所有**高优可交互元素（如按钮、输入框、A标签）**分配一个全局单调递增的“数字 Index 索引”，并在内存中维护起 `selectorMap` 映射表。
- **提取 `flatTreeToString`**: 将提纯后的 `FlatDomTree` 序列化为极简 HTML 喂给 LLM（从而极大节省 Token 消耗）。
- **Synthetic Events 注入**: 当 LLM 回复诸如 `clickElement(index: 5)` 时，通过 `selectorMap` 拿到真实 HTMLElement。之后，为了防风控和兼容 React/Vue，它并不仅仅调用 `.click()`，而是人造了一套完整的物理事件链 (`mouseenter` -> `mouseover` -> `mousedown` -> `mouseup` -> `click`) 派发给元素。

### 2.3 Shadow DOM 与 Iframe 穿透技术
`FlatDomTree` 通过 `buildDomTree` 函数实现深度递归穿透：
- **Shadow DOM 穿透**：当遇到具备 `shadowRoot` 的宿主元素时，脚本会递归遍历其子节点。即使是多层嵌套的 Closed Shadow DOM，只要脚本运行在页面同源上下文，即可通过 JS 引用强制遍历并将其内容扁平化合并到 `FlatDomTree` 中。
- **Iframe 穿透**：脚本尝试访问 `node.contentDocument`。若 Iframe 同源，则递归处理其内部子节点；若跨域，则在捕获异常后跳过，提示该区域无法感知。

### 2.4 天然绕过 CORS 限制
作为 **In-page 注入脚本**，PageAgent 运行在目标网页的原生源（Origin）上下文中。由于不发起独立的第三方 HTTP 请求，而是直接通过 DOM API 获取页面内容，因此天然不受同源策略（SOP）和 CORS 跨域资源共享限制的束缚。

## 3. 对 AI Agent 的友好性
- **“零安装”特性**: 因为它的核心只是一个 JS Context，它可以被极其轻易地打包进任意形式的宿主环境（Chrome Extension, 也可以是移动端 WebView 的 JSBridge 注入段，或者单纯的 Bookmarklet 书签脚本）。
- **隐私性好**: 用户无需将自己的 Cookie 交给任何云端服务器，所有 DOM 解析都在用户本地电脑的浏览器中运算，只向大模型发送最轻量的 Text 文本请求。

## 4. 总结与借鉴价值
PageAgent 提供了一套顶级的“面向大模型优化的前端 DOM 压缩范式”。
在 WebEnvoy 的设计中，当我们在遇到动态强交互型页面时：
- 我们不应该使用 Puppeteer 的 `.content()` 取下整个原始页面喂给大语言模型（极度低效）。
- 我们应该学习 `PageController`，写一个前置的 Content Script 注射进页面，洗出一个只带有 `[IndexId]` 的 `FlatDomTree` 字符串。LLM 只需要回答操作哪个 IndexId，然后我们再用 `Synthetic Events` 去触碰对应的底层 Node 即可。这是目前业界公认的最佳 Web 自动化大模型交互协议。
