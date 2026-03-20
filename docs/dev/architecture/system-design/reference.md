# 参考资料：需求映射 · Spike 任务 · L2 占位 · ADR

> 所属文档：[系统设计（战术层）](../system-design.md) › 参考章节

---

## 需求与技术实现映射

| 需求 | 技术实现映射 |
|---|---|
| 启动浏览器（指定配置空间）| `playwright.launchPersistentContext(profileDir, stealthOptions)` |
| 执行层策略切换（三档）| Extension Content Script（默认）/ CDP 直接（效率）/ OS 级 nut.js（安全）→ 见 [execution.md](./execution.md) |
| 通信层通道切换 | Native Messaging（默认）/ WebSocket（调试用）→ 见 [communication.md](./communication.md) |
| CLI 与插件双向通信 | Native Messaging Protocol，Extension 主动发起连接 → 见 [communication.md](./communication.md) |
| 获取无障碍树 | CDP `Accessibility.getFullAXTree` + 过滤 + RefCache → 见 [read-write.md §4.3](./read-write.md) |
| 拦截网络响应数据 | Content Script API 主动发包（primary）+ 页面状态读取 fallback + webRequest 被动拦截（观测）→ 见 [read-write.md §4](./read-write.md) |
| 填写文字（富文本编辑器）| 合成事件链，自动识别 input/contenteditable → 见 [read-write.md §5.1](./read-write.md) |
| 上传本地文件 | DataTransfer 注入，降级为 L3 直调上传 API → 见 [read-write.md §5.2](./read-write.md) |
| 拟人化鼠标轨迹 | ghost-cursor 贝塞尔模型 + CDP Input.dispatchMouseEvent → 见 [read-write.md §5.3](./read-write.md) |
| 下载网页文件 / 媒体结果 | 页面内获取 URL / Blob，CLI 统一落盘 → 见 [read-write.md §5.4](./read-write.md) |
| 清除自动化指纹（8 维）| MAIN 世界 Stealth 补丁，`document_start` 注入 → 见 [read-write.md §6.3](./read-write.md) |
| 指纹一致性（跨 Session）| 指纹种子固化到配置空间 `__webenvoy_meta.json` → 见 [anti-detection.md §2.3](../anti-detection.md) |
| OS 级输入引擎（最高安全模式）| macOS CGEvent / Windows SendInput → 见 [execution.md](./execution.md) |
| CDP 输入引擎（默认模式）| `playwright.page.context().newCDPSession()` → 见 [execution.md](./execution.md) |
| 浏览器进程状态机 | 六态状态机 → 见 [account.md](./account.md) |
| 命令串行执行 | 操作命令队列，同一实例不允许并发操作 |
| 数据库并发安全 | SQLite WAL 模式 → 见 [database.md](./database.md) |
| 平台规则库加载 | `rules.yaml` 文件，系统启动时扫描加载 → 见 [adapter.md](./adapter.md) |
| 规则热更新 | `chokidar` 文件监听，下次调用时生效 → 见 [adapter.md](./adapter.md) |
| Content Script 执行世界隔离 | Isolated World 处理 Extension API，MAIN World 处理签名 → 见 [read-write.md §6](./read-write.md) |
| Native Messaging 消息大小限制 | 摘要优先，超 1MB 自动分片 → 见 [communication.md](./communication.md) |

---

## 十四、待确认的知识盲区（Spike 任务）

以下问题需要在各自对应阶段启动前，通过真实观察确认：

### Spike A：小红书核心读链路确认（Phase 1 前置）

- [ ] 读路径口径冻结：API 为主路径，页面状态读取仅作 fallback 连续性路径
- [ ] 搜索、详情、用户主页等核心 API 的 URL 端点与请求体结构
- [ ] 页面状态 fallback 的可读取字段、触发条件与失效信号
- [ ] `a1` / `webId` / `gid` 等追踪字段的生命周期（Content Script 内如何稳定获取）
- [ ] `window._webmsxyw` 的调用签名（参数格式、返回格式）

### Spike A-Write：小红书最小写链路与上传路径确认（Phase 1 后段验证 / Phase 2 前置）

- [ ] 富文本发布编辑器的 DOM 结构与 Composition 事件响应机制
- [ ] 图片上传流程（DataTransfer 还是独立上传接口）

### Spike B：抖音平台 API 端点确认（Phase 3 第二平台验证前置）

- [ ] 视频流、用户信息、搜索等核心 API 端点
- [ ] `window.bdms.init._v[2].p[42]` 签名函数的准确调用方式
- [ ] 创作服务台（发布页）的视频上传接口结构

### Spike C：Extension 通信容量验证

- [ ] 大体量 JSON（100 条搜索结果）通过 `chrome.runtime.sendMessage` 的延迟与限制
- [ ] 是否需要分片传输或 `chrome.storage` 中转
- [ ] webRequest / declarativeNetRequest 读取响应体的可行方案

### Spike D：agent-browser AX Tree 压缩算法研究（Phase 2 前置）

- [ ] `processAriaTree` + `compactTree` 算法的代码级实现细节
- [ ] RefMap 短引用系统的数据结构与序列化格式
- [ ] 压缩后 AX Tree 的 Token 消耗对比测试

### Spike E：Steel Browser 请求拦截在 Extension 架构中的可行性（Phase 2 前置）

- [ ] 在 Extension `declarativeNetRequest` 中实现图片/广告屏蔽的规则集
- [ ] 拦截规则对页面功能的影响边界（是否会误拦截 API 请求）
- [ ] 实测加载时间对比（拦截前 vs 拦截后）

---

## 十五、Phase 2 L2 首次可用能力（待设计）

> **状态**：占位章节，设计工作在 Phase 1 交付后启动。

本节描述 Phase 2 计划构建的 L2 通用读取层。该层的目标是使 WebEnvoy 能够对任意未知网站（无预建适配器）提供首次可用的内容提取与基础交互能力，并与前序阶段建设的 L3 专用平台适配器互补。

### 核心组成（待设计）

| 组件 | 来源参考 | 状态 |
|---|---|---|
| AX Tree 压缩算法（`processAriaTree` + `compactTree`）| agent-browser | ⏳ 待设计 |
| RefMap 短引用系统（`@e1` / `@e2` 格式）| agent-browser | ⏳ 待设计 |
| 通用 CLI 原语（`navigate` / `snapshot` / `click` / `type` / `intercept` / `extract`）| 自研 | ⏳ 待设计 |
| 请求拦截加速策略（屏蔽图片/广告/字体）| Steel Browser | ⏳ 待设计 |
| 正文 Markdown 提取（NAV-04）| 自研 | ⏳ 待设计 |
| 登录墙与验证码检测（NAV-08 / ERR-01）| 自研 | ⏳ 待设计 |

### 与 Phase 1 基础设施的依赖关系

L2 通用读取层**复用** Phase 1 建立的以下基础设施：

- **执行主链路**（CLI / Extension Background / Content Script / Native Messaging）完全复用
- **最小运行记录与配置空间模型**完全复用
- **AX Tree 基础感知**（[read-write.md §4.3](./read-write.md) 中已有基本调用）— 在此基础上扩展压缩算法
- **错误处理框架**（[error-handling.md](./error-handling.md)）— 需补充 L2→L1 降级条件（见下）

### L2 → L1 降级触发条件（待确认）

以下情况触发 L2 降级至 L1 VLM 漫游：

- AX Tree 返回结果为空或节点数 < 5（强 Canvas 渲染页面）
- 页面持续渲染超过 10s 仍无可交互节点
- 连续 3 次操作均无法定位目标元素

### 设计依赖的前置条件

1. Phase 1 核心运行时稳定运行（CLI 入口、Native Messaging 通道、Extension 架构）
2. 完成 Spike D（agent-browser AX Tree 压缩算法代码级研究）
3. 完成 Spike E（Steel Browser 请求拦截在 Extension 架构中的可行性验证）

---

## 附录：架构决策记录（ADR）

| 决策 | 选择 | 核心理由 | 排除选项 |
|---|---|---|---|
| 浏览器运行时 | TypeScript + Playwright（默认启动器）| TS 技术栈统一，Playwright 负责进程管控与 CDP Input 物理输入通道，业务逻辑编排由 Extension 执行 | Go + chromedp（生态小）、Python + Camoufox（不支持 Profile 持久化）|
| 默认执行档 | Playwright 启动 + Extension Content Script 操控 + Stealth 补丁 | 兼顾开发效率与防风控，适合主流平台（小红书、抖音）；Playwright 负责进程管理与 CDP Input 物理输入通道，业务逻辑编排由 Extension 执行 | 纯 CDP 直驱（时序特征明显，高防可检测）|
| 最高安全执行档 | 直接 spawn Chrome（无 CDP 端口）+ OS 级输入（nut.js / CGEvent） | 消除 `--remote-debugging-port` 痕迹，鼠标/键盘事件 `isTrusted=true` | Playwright 启动（有 CDP 端口侧信道风险）|
| 高防一次性侦察 | Camoufox（Python 胶水调用）| C++ 内核级 Canvas/WebGL 伪装不可替代 | 不作为主运行时 |
| 读取机制 | Content Script API 主动发包（L3 primary）+ 页面状态读取（fallback）+ webRequest 被动拦截（辅）| API 路径保障主链路效率；页面状态路径用于 API 波动时的连续性与补证；均不依赖独立 SignSrv | Python httpx 外部发包（违反浏览器内执行原则）|
| L3 实现准入门槛 | 核心读场景必须具备可复现 API 主路径；fallback 仅作补充证据 | 避免把临时 fallback 误判为能力完成，确保后续适配器实现稳定收敛 | 仅凭页面状态 fallback 放行实现 |
| 账号管理 | Named Profile（UserDataDir 隔离）| 一次登录永久复活，Profile 可备份/迁移 | Cookie 文件手动同步（脆弱）、Camoufox（不支持持久化）|
| 签名获取 | Content Script → MAIN World → 平台自有函数 | 平台已提供，无需逆向算法 | 独立 SignSrv 微服务（引入跨服务依赖，违反单一进程原则）|
| 写操作 | 真实页面交互（合成事件链）| 最拟真，与页面框架状态同步 | 直接调 API（对高防平台风险高，且写操作逻辑较复杂）|
| TLS 指纹 | Content Script fetch()（浏览器自带指纹）| 浏览器真实 TLS 指纹，无需另外处理 | Node axios / curl-cffi（在浏览器外部请求时才需要）|
