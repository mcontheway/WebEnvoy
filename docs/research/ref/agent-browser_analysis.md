# vercel-labs/agent-browser 深度调研报告

## 1. 宏观信息
- **仓库**: vercel-labs/agent-browser
- **Stars**: 22k+
- **定位**: 专为 AI Agent 设计的浏览器自动化 CLI 工具。
- **更新活跃度**: 持续更新中（主分支活跃）。

## 2. 核心架构设计 (Client-Daemon 架构)
项目采用了巧妙的 **CLI-Daemon 分离架构**，以解决 Node.js 启动慢和浏览器实例保活的问题：
- **Rust CLI 客户端**: 负责极速启动、解析用户命令（如 `open`, `click`）并构建 JSON 协议栈发送给 Daemon。这是用户/LLM 直接交互的壳。
- **Daemon 守护进程**:
  - **Node.js (默认)**: 基于 Playwright。在首次执行命令时自动启动并驻留后台，通过 Unix Socket / TCP 监听 CLI 发来的指令。
  - **Native Rust (实验性)**: 彻底抛弃 Node.js 和 Playwright，直接通过纯 Rust 实现与 Chrome DevTools Protocol (CDP) 的通信，支持 Chromium 和 Safari (WebDriver)。
- **交互协议**: CLI 将命令参数化（例：`{"id": 1, "action": "navigate", "url": "..."}`），Daemon 收到后经过安全策略检查（Policy Enforcement），再分发给具体的 `handle_*` 路由执行。

## 3. 核心机制：Snapshot 与提纯算法
项目最大的亮点在于其极度精简的 DOM 提取层（Snapshot 机制），完美解决了 LLM 上下文溢出和幻觉问题：

### 3.1 `getEnhancedSnapshot` 生成流程
1. **基础提取**: 核心底层依赖 Playwright 的 `ariaSnapshot()` 获取页面的无障碍树（Accessibility Tree），而非原始 DOM HTML。
2. **过滤与浓缩 (`processAriaTree`)**:
   - **Interactive Roles (`-i`)**: 根据白名单仅保留具备交互语义的角色（如 `button`, `link`, `textbox` 等），摒弃一切纯视觉的 div/span 结构。
   - **Compact Mode (`-c`)**: `compactTree` 算法通过递归裁切，移除包含空文本或无交互 refs 的死区节点分支。
   - **Max Depth (`-d`)**: 限制树深度以防递归地狱。
3. **补充抓取 (`findCursorInteractiveElements`)**:
   - 针对大量前端框架未编写标准 ARIA 的情况，代码会主动寻找 CSS 样式为 `cursor: pointer`、带有 `onclick` 属性或 `tabindex` 的元素，将其强行补入可交互树中。

### 3.2 极短引用映射 (Ref Indexing)
为所有提纯出的交互节点分配极短的唯一引用 ID，极大降低 LLM 生成操作指令时的 Token 开销并避免输出复杂的选择器：
- 格式表现为 `@e1`, `@e2`... 由 `nextRef()` 全局计数器分配。
- **RefMap**: 内存中隐式维护一张映射表。每个 `@eN` ID 都绑定了一个复杂的内部对象，包含：
  - `selector`: Playwright 可执行的选择器路径。
  - `role`, `name`: 元素的角色与可访问名称。
  - `nth`: 针对同名、同角色元素的排障序号（仅当发生碰撞时才存在）。
- **执行流程**: LLM 输出 `click @e2`， CLI 将其打包，Daemon 解析时调用 `parseRef`，然后通过 `browser.getLocatorFromRef` 查阅 `RefMap`，直接转译为精确的 Playwright Locator 定位并点击。这确保了 100% 的准确性和低代码开销。

## 4. 防护与反反爬 (Anti-bot / Stealth)
该项目本身的重心在于 "Agent 可以看懂网页"，但在对抗方面也做了策略整合：
- **云浏览器外包战略**: 针对复杂的反爬限制，项目官方首推对接远端基础设施（如 Browserbase, Kernel）。在 `src/browser.ts` 的 `connectToKernel()` 逻辑中，默认向 API 传递 `stealth: true` 参数开启 stealth 模式。
- **指纹与会话持久化**: Kernel 云托管支持 `KERNEL_PROFILE_NAME` 注入，使得 session (Cookies/Local Storage) 能够持久化，从而养号、避免纯净净空的“僵尸特征”被封锁。Browserbase 则主打单次的阅后即焚隔离。
- **底层安全隔离 (Security Allowlist)**: 提供域名白名单 (`ensureDomainFilter`) 强行切断不可信子域的加载请求；通过 CSPRNG 随机数生成的内容边界标识符 (Boundary markers) 包裹网页文本输出，防止 LLM 被恶意网页的 Prompt 注入攻击 (Prompt Injection / Prompt Leaking)。

## 5. 总结与借鉴价值
`vercel-labs/agent-browser` 最大的启发意义在于 **"非可视化的极简状态获取"**。它并不通过截图交给 VLM (Vision LLM) 进行慢速推理，而是通过 `ariaSnapshot + 压缩算法` 将庞大杂乱的前端归一化成了具有序号 `@e1` 的扁平语义列表。
如果我们的项目面临 LLM token 昂贵且经常点偏的痛点，完全可以借鉴其 `RefMap` 和 `processAriaTree` 加 `cursor: pointer` 兜底的综合探知机制。
