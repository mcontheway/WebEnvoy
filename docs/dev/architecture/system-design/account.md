# 账号生命周期与浏览器运行时

> 所属文档：[系统设计（战术层）](../system-design.md) › 第七、九章
> 覆盖章节：§七 账号生命周期管理 · §九 浏览器生命周期状态机

---

## 七、账号生命周期管理

### 7.1 Named Profile 模型

```
profiles/
  ├── xhs_account_001/       ← 小红书账号 A 的 Chrome UserDataDir
  │     ├── Default/Cookies
  │     ├── Default/Local Storage/
  │     ├── Default/IndexedDB/
  │     └── __webenvoy_meta.json    ← 配置空间元数据（账号状态、指纹种子等）
  ├── xhs_account_002/
  └── douyin_account_001/
```

`__webenvoy_meta.json` 存储的内容包括：
- 账号平台标识与健康状态
- 指纹噪声种子（`audioNoiseSeed`、`canvasNoiseSeed` 等，详见 [`anti-detection.md`](../anti-detection.md) §2.3）
- 行为人格（`BehaviorPersona`，详见 [`anti-detection.md`](../anti-detection.md) §4.2）
- LocalStorage 快照（用于 SPA 前端鉴权恢复）
- **Proxy 绑定**（`proxyUrl` 字段，见下文）

#### Proxy 黏性绑定

每个 Profile 与一个代理 IP 绑定，生命周期内不轮换（对应 Crawlee 的 `sessionId→proxyUrl` 模型）：

```jsonc
// __webenvoy_meta.json
{
  "proxy": {
    "url": "http://user:pass@proxy-host:8080",  // null = 直连
    "boundAt": "2026-03-17T10:00:00Z"            // 绑定时间，用于审计
  }
}
```

**核心原则**：同一账号在其整个生命周期内固定使用同一出口 IP。原因：
- 平台风控会追踪账号的 IP 历史，频繁换 IP 是强力风控信号
- Profile 创建时随机分配一个代理，此后不主动更换
- 只有在账号进入 `[已封禁]` 状态并新建 Profile 时，才为新 Profile 分配新代理

**代理配置来源**（按优先级）：
1. `webenvoy login --proxy <url>` 命令行参数
2. 代理池配置文件自动分配（Phase 6 增强项）
3. `null`（无代理，直连）

> 参考来源：Crawlee SessionPool 的 `ProxyConfiguration.newProxyInfo(sessionId)` 黏性映射机制；Selenoid 的每容器独立 `HTTP_PROXY` 环境变量隔离模型（概念类比）。

### 7.2 配置空间生命周期状态机

```
[未创建]
    │ webenvoy login xhs --profile xhs_001
    ▼
[登录中]（打开可见浏览器，等待用户手动完成登录）
    │ 用户手动确认登录完成
    ▼
[预热中]（自动执行 Profile Seeding：全局预热 → 目标平台预热，约 15-30 分钟）
    │ 预热完成（或 --skip-warmup 跳过）
    ▼
[已就绪] ◄──────────────────────────────────────────────────────────┐
    │ webenvoy run --profile xhs_001                                 │
    ▼                                                                 │
[运行中]   ←──── 执行中 ────── 操作完成                             │
    │                                                                 │
    ├─ 轻度风控信号（429 / 静默失败率上升 / 操作成功率下降）         │
    │      ▼                                                          │
    │  [冷却中]（指数退避：第 1 次 1h → 第 2 次 4h → 第 3 次 24h）──┘
    │      │ 连续第 4 次触发 → [已封禁]
    │
    ├─ Cookie 过期 / 401 响应
    │      ▼
    │  [登录已失效] → 需要用户重新执行 login 命令
    │
    └─ 平台确认封号 / 严重风控
           ▼
       [已封禁] → 人工介入（更换账号或申诉）
```

**状态转换触发条件**：

| 事件 | 当前状态 | 目标状态 |
|---|---|---|
| `webenvoy login` 命令 | 未创建 | 登录中 |
| 用户手动确认登录完成 | 登录中 | 预热中 |
| Profile Seeding 自动预热完成 | 预热中 | 已就绪 |
| `--skip-warmup` 标志 | 预热中 | 已就绪 |
| 收到任务 | 已就绪 | 运行中 |
| 任务完成 | 运行中 | 已就绪 |
| 轻度风控信号触发 | 运行中 | 冷却中 |
| 冷却期结束（< 第 4 次） | 冷却中 | 已就绪 |
| 第 4 次触发冷却 | 冷却中 | 已封禁 |
| Cookie 过期 / 401 | 运行中 / 冷却中 | 登录已失效 |
| 平台确认封号 | 任意 | 已封禁 |

> **冷却指数退避**：来自 Profile Seeding 行业实践。首次触发风控后立即重试成功率极低，同时给平台留下「强行突破」信号。指数退避（1h→4h→24h）让账号自然降温，前三次有机会恢复正常。详见 [`anti-detection.md §5.3`](../anti-detection.md)。

> **预热必要性**：全新 Profile 直接执行任务会因「零 Cookie 生态、零浏览历史」被识别为机器账号。`--skip-warmup` 仅用于开发调试，生产环境禁止使用。

### 7.3 关键实现约束

- **禁止使用 Camoufox** 管理需要保活的账号（不支持持久化 Profile）
- **LocalStorage 快照**：对于依赖 LocalStorage 做前端鉴权的 SPA，需在配置空间元数据中额外保存 localStorage 快照，防止重启后鉴权失效
- **配置空间独占锁**：通过锁文件实现互斥，同一配置空间同时只能被一个 CLI 进程使用

---

## 九、浏览器生命周期状态机

> 注：本章描述**浏览器进程**的运行时状态（与上面"配置空间"的账号状态是两个独立的状态机）。

```
┌──────────────┐
│   未启动     │
└──────┬───────┘
       │ webenvoy start --profile <name>
       ▼
┌──────────────┐
│   启动中     │  等待 Extension Background 建立 Native Messaging 连接
└──────┬───────┘
       │ 连接建立成功
       ▼
┌──────────────┐          ┌──────────────┐
│    就绪      │◄─────────│   执行完毕   │
└──────┬───────┘  操作完成└──────────────┘
       │ 收到操作命令（click/input/fetch/...）
       ▼
┌──────────────┐
│   执行中     │  此状态下拒绝新的操作命令（串行保证）
└──────┬───────┘
       │ 检测到验证码 / 登录失效 / 封号
       ▼
┌──────────────┐
│   已暂停     │  等待人工介入，查询类命令仍可响应
└──────┬───────┘
       │ 浏览器进程退出 / 通信断开
       ▼
┌──────────────┐
│  异常断开    │  CLI 自动尝试重连，30s 超时后提示人工
└──────────────┘
```

**状态转换触发源**：

| 触发来源 | 目标状态 |
|---|---|
| CLI 收到 `start` 命令 | 启动中 |
| Native Messaging 握手成功 | 就绪 |
| 收到任何操作命令 | 执行中 |
| 操作完成（成功/失败） | 就绪 |
| 平台返回 471/461 或弹出风控弹窗 | 已暂停 |
| 浏览器进程崩溃 / Native Messaging 断开 | 异常断开 |
| **心跳超时**（连续 2 次未收到 `__pong__`，≈ 40s） | 异常断开 |
| 30s 内重连成功 | 就绪 |
| 30s 超时未重连 | 通知 AI 人工介入 |

> **心跳机制说明**：MV3 Service Worker 会在空闲约 30 秒后被 Chrome 强制休眠，导致 Native Messaging 静默断开。Extension Background 每 20 秒向 CLI 发送 `__ping__`，CLI 立即回复 `__pong__`。CLI 侧维护心跳计时器，超时（连续 2 次无响应）时主动触发断连流程，进入「异常断开」状态并尝试重连。心跳协议详见 [communication.md](./communication.md)。
