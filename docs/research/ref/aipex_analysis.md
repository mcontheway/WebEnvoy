# AIPexStudio/AIPex 深度调研报告

## 1. 宏观信息
- **仓库地址**: [AIPexStudio/AIPex](https://github.com/AIPexStudio/AIPex)
- **Stars**: ~1.1k
- **定位**: 强调“隐私至上”、“不迁徙数据”的浏览器本地 AI 自动化助手。对标 Manus Browser Operator, Claude Chrome 和 Agent Browser。
- **核心技术栈**: TypeScript, React, Chrome Extension API (v3)。由多个包（如 `@aipexstudio/aipex` Core, `@aipexstudio/aipex-react` 等）组成的 Monorepo。

## 2. 核心架构与底层机制 (Core Agent)

与其他独立的 Node.js / Python 自动化方案不同，AIPex 的核心逻辑在于打造一个在浏览器扩展中运行的 Agent 引擎封装。

### 2.1 底层模型调度层 (`AIPex` Core)
AIPex 内部封装了标准的 OpenAI Agent 逻辑，它的核心入口是 `AIPex.create()` 方法，支持注入三大拓展能力：
- **上下文系统 (Context System)**: 通过 `ContextManager` 处理外部传入的前端页面片段，将其格式化并注入到 LLM 的 Prompt 中（在 `ChatOptions` 中传入 `contexts`）。
- **插件系统 (Plugin System)**: 极其灵活的 `AgentPlugin` 架构。通过抛出钩子事件 (`beforeChat`, `afterResponse`, `onToolEvent`, `onMetrics`) 拦截或监听 Agent 运行时的各阶段。这些钩子带有错误隔离机制，以保证主线程安全。
- **工具系统 (Tool System)**: 采用 `FunctionTool` 抽象封装大模型工具调用。将底层 LLM 返回的 Stream Event 转译为 UI 友好的 `AgentEvent` 类型 (`tool_call_start`, `tool_call_complete`)，供 UI 层直接渲染状态展示。

## 3. "不迁徙数据" 特性的代码级实现
AIPex 最亮眼的口号是 "**No Migration**" (不迁徙用户数据) 和 "**Privacy First**"。这种体验上的“无感”完全依赖其对于 Chrome Extension API 和本地存储的深度利用：

### 3.1 纯本地状态管理
- **持久化配置**: 通过 `@aipexstudio/aipex-react` 暴露出的 `useChatConfig` hook 管理配置（如用户输入的 LLM API Token 等）。底层利用 `ChromeStorageAdapter` 类对接 `chrome.storage.local` 进行数据同步和劫持，完全无需后端账号体系。
- **会话存储 (Session Storage)**: 对话上下文和历史执行记录通过 `useBrowserStorage` 钩子，底层指向 **IndexedDB** 方案，彻底将对话数据锁定在用户本地电脑内。
- **BYOK (Bring Your Own Key)**: 不代理 LLM 请求，直接由扩展的 Background / Content 发起去往大模型厂商 API 的跨域请求，规避了数据中间商泄密风险。

### 3.2 浏览器扩展深度集成
- **React Hooks 驱动**: 提供了大量如 `useAgent`, `useBrowserModelFactory`, `useBrowserContextProviders`, `useBrowserTools` 等浏览器端的专用 Hook。例如 `useBrowserContextProviders` 封装了对当前标签页 (Tabs) 和书签 (Bookmarks) API 的访问权限，直接将其转化为大模型的输入 Context。
- **Background Script & Content Script**: UI 通过 Side Panel / Web 渲染完成，后台使用 background 脚本做全局驻留与 API 调用。当执行针对页面的 DOM 提取或点击时，消息总线经由 `@aipexstudio/aipex-react` 的 `ContentScript` 组件入口下发给指定 Web 页面里的 content js 执行。

## 4. 总结与借鉴价值
AIPex 项目并非像 `vercel-labs/agent-browser` 那样死磕 DOM 压缩算法，它的工程重点在于 **“把一个全功能的跨平台 Agent 生命周期完美地搬进 Chrome 扩展的沙盒容器内”**。
通过 `Context`, `Tool`, `Plugin` 三层解耦的模块化设计以及基于 IndexedDB + Chrome.storage 打造的全套 React 驱动基础设施。如果我们要为应用开发浏览器插件以吸引 B 端企业用户，参考其 `useBrowser*` 系列 Hooks 封装与 `ChromeStorageAdapter` 的无服务本地化部署理念是非常有利的，这可以直接打消企业对敏感办公数据外泄的疑虑。
