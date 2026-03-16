# 调研报告：bb-browser 架构与实现机制深度拆解

> 版本：v1.3
> 状态：完工（已集成 DeepWiki 深度分析）
> 目标：深度解析 `bb-browser` (BadBoy Browser) 的实现机制、架构设计及技术优劣势。

---

## 一、 项目定位与核心哲学分析

`bb-browser` 提出了 **"Your browser is the API"** 的核心理念，通过技术手段抹平了 Web 页面与结构化 API 之间的鸿沟。

### 1.1 核心设计思想
*   **范式转移**：从"让网站适配爬虫"转变为"让工具学习人的操作"。
*   **寄生模式 (Parasitic Execution)**：直接复用用户现有浏览器的登录态（Cookies）、Session 以及复杂的验证环境，规避了传统自动化工具在环境初始化上的巨大成本。
*   **Agent 优先**：数据输出高度结构化（JSON/MCP），通过简化 DOM 树（Accessibility Tree）来节省语言模型的上下文消耗。

---

## 二、 技术架构体系

`bb-browser` 采用五层架构设计，实现了 UI 展现、命令分发、状态管理与底层自动化的解耦。

### 2.1 链路组成
`CLI Client <-> Daemon (Node.js) <-> Server-Sent Events (SSE) <-> Chrome Extension <-> chrome.debugger (CDP)`

### 2.2 组件协同机制
1.  **CLI 层 (`packages/cli`)**：解析用户指令，管理 Daemon 生命周期，通过 HTTP POST 向 Daemon 发送 JSON 命令。
2.  **Daemon 层 (`packages/daemon`)**：作为中间件运行 HTTP 服务（默认 19824 端口），使用 `SSEManager` 将命令推送到扩展，并利用 `RequestManager` 异步关联请求与结果。
3.  **Extension 层 (`packages/extension`)**：核心后台进程。
    *   **SSEClient**：维持与 Daemon 的长连接。
    *   **CommandHandler**：分发指令，调用 `CDPService` 执行底层操作。
    *   **CDP 注入**：直接利用 `chrome.debugger` API 进行网络截获和脚本注入，结果异步回传。

---

## 三、 "10分钟 CLI 化"的实现路径

该项目通过一套专为 AI 设计的"侦察与验证"原语，将逆向周期缩短至分钟级：

### 3.1 侦察工具链 (Recon Tools)
*   **语义树转换 (`snapshot -i`)**：
    *   底层调用 `Accessibility.getFullAXTree`。
    *   通过 `ax-tree-formatter.ts` 执行降噪算法，仅保留带 `ref`、文本、URL 或有名称的交互节点，过滤掉 90% 的布局噪音，极度适配 LLM 上下文。
*   **流量实时监控 (`network`)**：利用 CDP `Network` 域监听 `requestWillBeSent` 等事件，捕获包括请求体在内的全量流量。

### 3.2 站点适配器分层 (Tiered Adapters)
适配器按照逆向深度分为三级，AI 会按此顺序尝试闭环：

| 级别 | 技术路径 | 实现原理 |
| :--- | :--- | :--- |
| **Tier 1 (Public)** | Fetch / HTML | 直接在 Console 运行 `fetch`，复用 Cookie。 |
| **Tier 2 (Session)** | Session API | 捕获 API 流量中的 Bearer / CSRF Token 并模拟。 |
| **Tier 3 (Internal)** | **Internal State** | 使用 `Runtime.evaluate` 访问 `window.__INITIAL_STATE__`、Webpack 容器或挂载在全局的 Store (Pinia/Redux)。 |

### 3.3 重要修正：Tier 不存在自动降级逻辑（深度调研关键发现）

> 通过对源码和 Wiki 的深度验证，Tier 1/2/3 **并不是一个运行时自动执行的降级机制**，而是一个**指导 AI Agent 兴建适配器的复杂度分类**。没有任何自动触发条件的代码。

各 Tier 的实际操作路径如下：

- **Tier 1 尝试路径**：AI 先发起 `bb-browser eval "fetch('/api/...', {credentials:'include'}).then(r=>r.json())"`，测试是否可以直接带 Cookie 拿数据。
- **Tier 2 尝试路径**：先用 `bb-browser network requests --with-body --json` 抓包，AI **手动解析** JSON，然后提取 `Authorization` Header 中的 Token，用 `bb-browser fetch <url> --headers '{"Authorization":"Bearer <token>"}'` 重放请求。具体实现在 `packages/cli/src/commands/fetch.ts` 的 `fetchCommand` 函数中，它将参数转换为浏览器 `fetch` 调用后通过 `Runtime.evaluate` 执行。
- **Tier 3 尝试路径**：AI 用 `bb-browser eval "JSON.stringify(window.__pinia.state.value)"` 等表达式直接抽取内存中的状态对象。

> **对 WebEnvoy 的关键启发**：这意味着我们自己在构建 PlatformAdapter 时，需要把 Tier 1→2→3 的探查决策逻辑**手动确定并硬编码**到每个平台的适配器中，而不能期望系统会自动判断。

---

## 四、 技术实现细节 (CDP 深度应用)

*   **Runtime 交互**：通过 `returnByValue: true` 选项，使 `Runtime.evaluate` 能够直接返回复杂的 JS 对象给 CLI。
*   **元素定位**：不使用 Content Script 注入，而是通过 `DOM.getBoxModel` 和 `DOM.querySelector` 这种 CDP 原生方式定位坐标，并调用 `Input.dispatchMouseEvent` 模拟点击。

---

## 五、 技术短板分析 (Anti-Bot Analysis)

### 5.1 协议特征暴露
*   **CDP 标记**：调用 `chrome.debugger.attach` 会触发系统级警告条，且易被反爬脚本通过检查 `navigator.webdriver` 或特定报错捕获指纹。
*   **缺乏 Stealth**：源码中未实现指纹对抗（如模拟随机 UA、WebRTC/Canvas 掩盖）。

### 5.2 行为模式风险
*   **路径"过直"**：点击坐标通常计算 Box 中心点后直接触发，缺乏人类交互时的随机偏移及贝塞尔移动曲线。
*   **节奏僵硬**：输入操作不支持模拟按键间隔形成的 Typing Fingerprint。

### 5.3 端口暴露风险
*   **服务探测**：本地 Daemon 端口（19824）对宿主环境下的所有网页可见，恶意站点可通过探测此端口识别用户是否安装了该自动化工具。

---

## 六、 结论：技术趋势参考

`bb-browser` 展示了一种高效的"浏览器内生自动化"思维。它成功的关键在于**将复杂的 CDP 原语封装为 AI Agent 可理解的"动作原子"**，并通过直接读取前端内存状态（Tier 3）大幅度绕过了接口层的加密。

**最终三个核心结论：**
1. **复用登录态的唯一正解就是寄生**：没有任何第三方工具能创造操作系统层面的 Cookie 隔离，不如直接运作在用户已登录的浏览器进程中。
2. **Tier 分类是开发论语，不是运行行为**：不要期望系统会自动判断该用哪个 Tier，这个准则需要在适配器开发阶段由人手动研究并写死。
3. **凭证管理是 AI Agent 自己的职责**：bb-browser 不保存任何 Token 和 Cookie，它只提供抓包工具和 JS 执行器，所有的凭证提取、管理和重放逻辑完全由上层 Agent 负责实现。WebEnvoy 必须在我们自己的适配器中建立这套凭证管理机制。
