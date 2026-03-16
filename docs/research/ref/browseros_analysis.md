# browseros-ai/BrowserOS 深度调研报告

## 1. 宏观信息
- **仓库地址**: [browseros-ai/BrowserOS](https://github.com/browseros-ai/BrowserOS)
- **Stars**: ~10k
- **定位**: 直接修改底层源码构建的“Agent 化网页浏览器”，对标企业级的 Perplexity、ChatGPT Atlas。
- **核心技术栈**: Chromium (C++ Custom Build), Go (Server Sidecar), Bun + React (Agent Extension)。

## 2. 核心架构与底层机制 (Browser as OS)
如果说其他方案是“写一个外部脚本去遥控 Chrome”，那 BrowserOS 则是“把 Chrome 拆了，把 Agent 塞进引擎里”。其强悍的融合体现在其独特的三层架构设计：

### 2.1 铁三角协同架构
1. **Agent Component**: 由一个 Bun HTTP 服务器和一个高特权级的 React Chrome 扩展组成。
2. **BrowserOS Server (Sidecar)**: 一个由 Go 编写的独立二进制守护进程，用来运行 MCP (Model Context Protocol) Tools 服务端。
3. **Custom Chromium Core (魔改内核)**: 修改了 C++ 源码的 Chromium。在启动时，底层的 `BrowserOSServerManager` 单例会直接管理并唤起上方的 Go Sidecar 进程，并通过一套 Ephemeral (临时) 内部端口与暴露在外面的稳定代理端口 (默认 9000/9100) 做隐式路由绑定。

### 2.2 绕过 CDP 延迟的混合通讯流
不同于传统方案重度依赖 WebSocket CDP (如 Puppeteer)，BrowserOS 采用混合方案降低数据往返延迟：
- 魔改过的内核赋予了其内置扩展史无前例的 `chrome.*` API 直接访问特权（甚至是私有 API 和虚假 URL `chrome://browseros/*` 的拦截权）。
- 扩展只需通过极速的浏览器内 `chrome.runtime.sendMessage` 通信截取页面上下文，并打包通过 HTTP `POST /agent/task` 发给本地 Bun 服务器供大模型推理。只有当需要触发复杂底层渲染动作时，才经由预热保活的 9100 CDP 稳定端点切入。

## 3. "Agent Per Tab" 与本地记忆系统
BrowserOS 将“标签页 (Tab)”和“Agent 实例”进行了沙盒级的 1v1 绑定：

### 3.1 标签页即 Agent (Agent Per Tab 分离机制)
普通自动化工具往往一个进程控死一个浏览器实例。BrowserOS 修改了底层的 `Browser.pdl`，引入了实验性的 `TabID` 和 `TabInfo` 补充结构。
- 在 `browser_os_api.cc` 层级，注入了 `BrowserOSClickFunction` 等独立 API。
- AI 发出的控制信令会被 `GetTabFromOptionalId` 拦截并路由，确保每个 Agent 只能操作和感知自己被分配的那个 `tab_id` 的 WebContents。从而完美实现了“左边标签页在自动做报表，右侧标签页在自动买机票”的高级并发隔离能力。

### 3.2 纯本地全生命周期记忆 (Memory System)
针对隐私焦虑，它的记忆不走云存储或 Vector DB 检索服务器，而是直接回归最原始粗暴的本地 Markdown 管理方案，由两层构成：
1. **核心记忆 (`CORE.md`)**: 绝对落地的持久化存储（用户偏好、密码、习惯）。不可自动删除。
2. **日常快照 (Daily Notes)**: 以 `YYYY-MM-DD.md` 命名的日志碎片。具有 30 天滑动销毁特性。
- **机制**: Agent 每次提问前，都会通过检索将这按时间轴排布的 md 直接塞给 LLM 作为 Background Prompt。如果模型在日常笔记中发现某条信息被高频使用，会主动触发升级机制将其提权挪入 `CORE.md`。

## 4. 总结与借鉴价值
BrowserOS 代表了极客对“浏览器级深度融合”的极致追求，是解决复杂网页操作“不稳定”的终极大招：**“如果解决不了环境不稳定，就把环境自己做了”**。
但也因为修改了 Chromium 的 C++ 源码，其维护跟进官方 Chromium 主线的成本极高。
对于 WebEnvoy 项目，我们可能无法（或不需要）去维护一条重度魔改的 Chromium 发行版分支。但其 **"Agent Per Tab" 通过扩展底层 ID 进行软隔离并行的思路**，以及极简、高度用户可读的 **`CORE.md` 结合时效笔记的本地双层记忆管理库**，是非常具有复制和落地价值的产品设计哲学。
