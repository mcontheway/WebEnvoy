# nanobrowser/nanobrowser 深度调研报告

## 1. 宏观信息
- **仓库地址**: [nanobrowser/nanobrowser](https://github.com/nanobrowser/nanobrowser)
- **Stars**: ~12.4k
- **定位**: OpenAI Operator 的开源替代品。一个以 Chrome 扩展形式运行的多 Agent Web 自动化流程引擎，支持 BYOK (自带 API Key)。
- **核心技术栈**: TypeScript, Chrome Extension (MV3), Puppeteer (Extension 版), Zod, LLM Orchestration。

## 2. 核心架构与底层机制 (Multi-Agent System)
作为在插件内直接跑 AI 的先驱，它并没有采用传统的单一全能大模型不断单步猜测的模式，而是构建了一个名为 `Executor` 的双子双轴协作引擎：

### 2.1 战略指挥官 (Planner Agent)
- 它是一个继承自 `BaseAgent` 且挂载了严格的 JSON Zod Schema (`plannerOutputSchema`) 的高级规划模型（例如推理能力更强的 o3-mini）。
- **运行周期**: 它的调用频率较低 (`planningInterval`)，主要负责从宏观上审视历史步骤、截图和当前网页进度，总结出 `challenges` 和高级别的 `web_task`（下一步目标），而不是直接输出鼠标点击哪里的低级指令。

### 2.2 战术执行者 (Navigator Agent)
- 这是一个更轻巧的模型（如 gpt-4o 或 claude-3-5-haiku），主要依靠执行者上下文的 `AgentContext`（共享的历史记录 `MessageManager`）。
- **执行逻辑**: 它获取到 Planner 设定的目标后，解析当前页面的所有 DOM 树和截图，然后从预定义好的 `NavigatorActionRegistry` 中挑选具体的函数（如 `click_element(index: 3)`, `input_text(xpath...)`）交由底层执行器。

### 2.3 Token 成本控制机制
- **`maxInputTokens` 限制**：默认上限为 128,000 Token。
- **截断策略**：文本按字符数估算（基于字符长度的 `_countTextTokens`），**图像固定计为 800 Token/张**。当总 Token 超标时，通过 `cutMessages` 算法优先从最后的消息开始剔除图片，其次按比例裁减文本，确保不超限。
- **局限性**：目前缺乏明确的 API 速率限制或全局金额预算管理。

### 2.4 Planner 视觉感知深度洞察
- **Base64 直传**：Planner Agent 在审视屏幕时，系统会直接将整张 Base64 编码的截图添加为 `image_url` 喂给 LLM。
- **无预处理**：源码中未见图像切片、分辨率压缩或视觉降噪等预处理逻辑。
- **配置驱动**：通过 `useVision` 和 `useVisionForPlanner` 开关控制。关闭后者可让 Planner 仅依赖解析后的文本状态，将昂贵的图像 Token 集中给 Navigator 使用。

## 3. Extension 版的自动化引擎与防反爬 (Browser Automation)
要在 Chrome 扩展内跑爬虫逻辑，不能像 Node 环境那样直接启子进程，而是有着专有的实现流：

### 3.1 跨端版的 Puppeteer (ExtensionTransport)
- 它的 `Page` 类底层并不是通过 ws 连接一个独立浏览器，而是使用了修改版的 Puppeteer Core 搭配自定义的 `ExtensionTransport`。
- 底层实际上是桥接调用了 Chrome 扩展的 `chrome.debugger` API 来实现与普通开发者工具完全相同的 CDP 通信信道，从而实现在不启动新浏览器实例的情况下，直接接管用户当前浏览器的活动 Tab 组。

### 3.2 强悍的前置反指纹注入 (Anti-Detection)
在每次新页面加载时，系统不仅靠大模型找按钮，还前置了极深的特征剥离注入 (`evaluateOnNewDocument`)：
1. **隐藏无头标识**: `navigator.webdriver = undefined`。
2. **重构 Chrome 上下文**: 伪造 `window.chrome = { runtime: {} }`，欺骗网站。
3. **最暴力的 ShadowDOM 破解**: Agent 最怕遇到隔离的自闭合 ShadowDOM（会导致外层节点探寻无法溯源到真实按钮）。Nanobrowser 篡改了底层的 JS API `Element.prototype.attachShadow`，将其强制始终返回并应用 `mode: "open"`。这使得全网所有基于 Closed ShadowDOM 隐藏真实结构的反爬系统在其面前集体裸奔。

## 4. 总结与借鉴价值
Nanobrowser 完美演示了 WebEnvoy 应当如何构建未来最理想的 Agent Orchestrator：
1. **大小脑分离 (`Planner` + `Navigator`)**: 让智商最高的慢模型做战略判断，让多模态快模型做 UI 坐标拾取和操作翻译，能在此类复杂页面自动化任务中压低延迟并极大地节省 Token 成本。
2. **强拆 ShadowDOM**: 这种极为流氓但也极其有效的防御降维打击（改写 `attachShadow` 原型），是 WebEnvoy 在设计网页元素特征嗅探脚本必须学习的顶级 Tricks。
