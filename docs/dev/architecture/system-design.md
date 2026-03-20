# WebEnvoy 系统设计（战术层）

> 版本：v1.0
> 日期：2026年03月16日
> 来源：综合 17 份竞品调研报告（`docs/research/ref/`）及 MediaCrawlerPro 参考实现分析
> 目的：在进入 Phase 1 编码前，明确系统各组件的职责边界、数据流向、读写机制和技术约束，为 Spec 编写提供确定性基础

本文件为**索引与概览层**，保留全局性的设计原则与系统边界描述。各模块详细设计已按关注点拆分至 `system-design/` 子目录，通过下方导航表访问。

---

## 子文档导航

| 模块 | 文件 | 覆盖内容 |
|---|---|---|
| 执行策略层 | [execution.md](./system-design/execution.md) | 三级执行模型（L1/L2/L3）、三档安全执行策略、Playwright 职责边界 |
| 读写机制与上下文 | [read-write.md](./system-design/read-write.md) | API 主路径、页面状态 fallback、被动拦截、AX Tree 感知、富文本/媒体/鼠标写操作、网页文件下载、Content Script 两个执行世界 |
| 账号与运行时 | [account.md](./system-design/account.md) | Named Profile 模型、配置空间状态机、浏览器生命周期状态机 |
| 平台适配器规范 | [adapter.md](./system-design/adapter.md) | `rules.yaml` 结构、适配器代码职责、热更新、改版快速维护路径 |
| 通信协议 | [communication.md](./system-design/communication.md) | JSON-RPC 消息格式、信息披露管控、Native Messaging 分片 |
| 错误处理与降级 | [error-handling.md](./system-design/error-handling.md) | 错误分类、L3→L2 降级触发、断点续传 DDL |
| 数据库结构 | [database.md](./system-design/database.md) | 核心表 DDL、索引设计、数据流向 |
| 外部依赖与集成决策 | [dependencies.md](./system-design/dependencies.md) | 28 个参考项目的集成方式（npm 依赖 / 算法移植 / 子进程 / 概念借鉴）、依赖清单 |
| 参考资料 | [reference.md](./system-design/reference.md) | 需求实现映射、Spike 任务（A-E）、L2 通用层占位、ADR |

---

## 一、核心设计原则

### 1.1 「浏览器内执行」原则

**核心约束**：WebEnvoy 的唯一 HTTP 出口是浏览器进程本身。所有对目标平台的网络请求，必须在 Chrome 扩展的 Content Script 或页面上下文中发起，不允许绕过浏览器在外部独立构造请求。

**原则边界**：Content Script 在平台页面内部执行的 `fetch()` 调用，天然携带同源 Cookie、平台签名能力（`window._webmsxyw` 等）、真实浏览器 TLS 指纹，是**合法的主动读路径**，不违反此原则。

**L3 读取基线（对齐 FR-0005 Spike 输出）**：正式承认 `API primary + page-state fallback`。即以平台 API 主路径为默认读取来源；当 API 临时不可用、灰度漂移或观测窗口不足时，允许页面状态读取（如 `window.__INITIAL_STATE__`）作为 fallback 连续性路径。`fallback` 仅用于连续性与侦察补证，不等于实现准入，不能单独作为“L3 读链路已完成”的验收依据。

| 行为 | 是否符合原则 | 原因 |
|---|---|---|
| Content Script `fetch('/api/...')` | ✅ 合法 | 在浏览器进程内，同源，天然认证 |
| `webRequest` 拦截自然流量 | ✅ 合法 | 纯被动，不产生新请求 |
| 外部 Python httpx 调用平台 API | ❌ 违反 | 浏览器进程外，需手动伪造 Cookie/签名 |
| 独立 SignSrv 微服务 | ❌ 违反 | 违背单一进程边界，引入运维成本 |


---

## 二、四组件模型（系统边界）

WebEnvoy 由以下四个核心组件构成：

```
[AI Agent]
     │
     │ CLI 参数 / stdout JSON
     ▼
┌─────────────────────────────────────────────────────────┐
│  CLI 进程 (Node.js / TypeScript)                        │
│  · 接收/解析 AI 指令                                    │
│  · 管理浏览器进程生命周期                               │
│  · 持久化数据到 SQLite                                  │
│  · 信息披露管控（只返回摘要给 AI）                      │
└────────────────────┬────────────────────────────────────┘
                     │ Native Messaging Protocol
                     ▼
┌─────────────────────────────────────────────────────────┐
│  Extension Background (Service Worker, MV3)             │
│  · 维护 CLI ↔ Content Script 双向消息路由               │
│  · 管理 webRequest 规则（declarativeNetRequest）        │
│  · 持有最小身份 / 会话元数据（登录态、指纹种子等）     │
│  · 向多个 Content Script 实例分发指令                   │
└────────────────────┬────────────────────────────────────┘
                     │ chrome.runtime.sendMessage / tabs.sendMessage
                     ▼
┌─────────────────────────────────────────────────────────┐
│  Content Script（注入到目标平台页面内）                 │
│  · L3 主读：fetch() 调用平台 API（primary）             │
│  · L3 fallback 读：页面状态提取（如 `window.__INITIAL_STATE__`） │
│  · 被动读：通过 Background 传递 webRequest 拦截数据     │
│  · 写操作：合成事件链 / DataTransfer 注入               │
│  · AX Tree 提取（L2 感知层）                            │
│  · 调用平台自有签名函数（在 MAIN 世界执行）             │
└─────────────────────────────────────────────────────────┘
                     │（数据回传 CLI）
                     ▼
┌─────────────────────────────────────────────────────────┐
│  SQLite 数据库                                          │
│  · WAL 模式，读写并发安全                               │
│  · 按平台/数据类型/业务ID索引                           │
└─────────────────────────────────────────────────────────┘
```

### 2.1 组件职责边界

| 组件 | 职责范围 | 不做什么 |
|---|---|---|
| **CLI** | 指令解析、进程管理、数据库读写、信息披露控制 | 不直接发 HTTP 请求，不操作页面 DOM |
| **Extension Background** | 消息路由、webRequest 规则管理、最小身份 / 会话元数据 | 不承担账号矩阵、限流运营或长期调度职责；不执行页面交互，不存储业务数据 |
| **Content Script** | 页面操作、API 发包、页面状态提取、AX Tree 感知 | 不做持久化，不做复杂业务逻辑编排 |
| **SQLite** | 结构化数据持久化、查询 | 不存储媒体 Blob，只存文件路径引用 |
