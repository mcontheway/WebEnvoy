# 通信协议设计

> 所属文档：[系统设计（战术层）](../system-design.md) › 第十章
> 覆盖章节：§十 通信协议设计（CLI ↔ Extension）

---

## runtime bootstrap 输入边界

在 official Chrome 持久扩展主路径下，通信层必须显式区分“持久身份边界”和“单次运行上下文”：

- 持久身份边界：稳定 `extension_id`、Native Messaging Host 名称、host manifest 的 `allowed_origins`、profile 内已安装扩展事实
- 单次运行上下文：本次 run/session 需要的 runtime bootstrap 输入

后者统一抽象为 `runtime_bootstrap_envelope` 一类对象。它在概念上会覆盖本次 run/session 所需的标识与上下文，例如 `run_id`、`runtime_context_id`、`profile`、运行时指纹与 main-world trust 相关输入，但这些字段的正式 transport contract 不在本次架构冻结里直接定稿。

冻结要求：

- `runtime_bootstrap_envelope` 属于 run/session 级输入，不属于扩展静态文件内容
- Content Script 不再把扩展包内 per-run JSON 文件视为正式主路径输入
- 它与持久 identity 边界存在关联，但具体消息格式、字段级校验、确认时机与失败面留给后续正式 spec 收口
- 本文档只冻结输入边界，不展开实现细节或安装器设计

---

## runtime bootstrap 与现有 transport 契约的边界

本次 architecture freeze 只冻结 **run/session 上下文必须与 transport handshake 解耦** 这一上位边界，不在这里改写已冻结的 FR-0002 Native Messaging 最小握手契约。

因此需要同时满足两条约束：

- FR-0002 负责的仍是 **连接级握手**、最小转发、心跳和断连处理
- `runtime_bootstrap_envelope` 负责的则是 **run/session 级上下文输入边界**

这意味着：

- `runtime_bootstrap_envelope` 不应再通过 per-run staged extension 文件承载
- 但它在后续运行时里究竟以何种消息名、何种确认时机、何种失败面进入正式 transport contract，应在 `#281` 对应的后续 spec / implementation-prep 中单独收口
- 在这些后续契约冻结前，不应把 `runtime_bootstrap_envelope` 直接写成已经替代 FR-0002 link-layer handshake 的正式握手阶段

当前只冻结以下最小事实：

- 它属于 run/session 级输入，而不是 profile 永久元数据
- 它与 `profile + stable extension_id + allowed_origins` 的持久 identity 边界有关
- 它必须作为独立于静态扩展资产的运行时输入被建模
- 其具体 transport 语义需要在后续正式 spec 中与 FR-0002 / FR-0003 对齐后再进入实现

---

## 命令格式（JSON-RPC 风格）

### 下行（CLI → Extension → Content Script）

```json
{
  "id": "cmd-20260316-001",
  "profile": "xhs_account_001",
  "method": "xhs.search",
  "params": {
    "query": "露营装备",
    "count": 20
  },
  "timeout_ms": 30000
}
```

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | string | 唯一命令 ID，用于请求-响应配对 |
| `profile` | string | 目标 Named Profile 标识 |
| `method` | string | `平台前缀.命令名`（L3）或通用原语名（L2） |
| `params` | object | 命令参数，由对应 Adapter 或通用层解析 |
| `timeout_ms` | number | 超时时间，超时后返回 ERR-07 |

### 上行（Content Script → Extension → CLI）

```json
{
  "id": "cmd-20260316-001",
  "status": "success",
  "summary": {
    "total": 20,
    "stored": 20,
    "skipped_dup": 0,
    "batch_id": "batch-abc123"
  },
  "error": null
}
```

---

## 信息披露管控

**返回给 AI 的永远是摘要，不是全量数据**：

| 操作类型 | 返回给 AI | 存储位置 |
|---|---|---|
| 搜索 / 列表采集 | `{ total: N, batch_id: "..." }` | SQLite `raw_items` 表（按 `batch_id` / `data_type` 归档） |
| 详情获取 | `{ note_id: "...", title: "前20字..." }` | SQLite `raw_items` 表（按 `biz_id` / `data_type` 覆盖写入） |
| 发布操作 | `{ note_id: "...", url: "...", status: "pending_review" }` | SQLite `audit_log` 表 |
| 互动操作 | `{ target_id: "...", action: "like", status: "ok" }` | SQLite `audit_log` 表 |
| 下载结果 | `{ file_id: "...", filename: "...", saved_to: "..." }` | SQLite `audit_log` 表（记录文件元数据与落盘结果） |
| 错误 | `{ code: "captcha_required", message: "..." }` | 不入库 |

这里的“搜索结果”“详情”“发布结果”等是对 AI 暴露的逻辑能力名，不额外对应独立物理表；实际落库统一复用 [`database.md`](./database.md) 中定义的 `raw_items`、`batch_checkpoints`、`audit_log` 三类核心表。

**设计意图**：避免将全量业务数据（可能数十 KB）直接塞入 AI 的上下文窗口，消耗 Token 预算。AI 通过 `batch_id` 或结构化业务 ID 在后续步骤按需查询，而非一次性接收全部数据。

---

## Native Messaging 消息大小控制

Chrome Native Messaging 协议存在单消息 1MB 的硬限制：

| 策略 | 说明 |
|---|---|
| **首选：摘要返回** | 通过信息披露管控将消息控制在 1MB 以内 |
| **兜底：自动分片** | 超过 1MB 时按 `chunk_index` / `chunk_total` 字段分片传输，接收端重组 |
| **调试通道：WebSocket** | `--debug` 模式下切换为 WebSocket 通道，单条消息上限 10MB，便于开发时观察原始数据 |

**Content Script 层数据清洗（上游裁剪原则）**：Native Messaging 的 JSON 序列化/反序列化在数据量大时会产生显著的主线程阻塞（Content Script → Background → CLI 三次序列化）。清洗应在 Content Script 侧完成，**不将脏数据传给 Background**：

- 删除 `tracking_data`、`ad_info`、`recommend_reason` 等纯埋点字段
- 将 base64 占位图（低质缩略图）替换为真实 CDN URL 或直接丢弃
- 对列表数据只保留入库必要字段，其余延迟到用户显式查询详情时再获取

清洗后单条笔记数据通常可从 50-100KB 压缩到 2-5KB，100 条批量抓取的总传输量从数 MB 降至 500KB 以内，完全避免分片。

---

## 通信层通道选择

| 通道 | 模式 | 使用场景 | 安全机制 |
|---|---|---|---|
| Native Messaging | **默认** | 本地部署，CLI 与 Chrome 同机运行 | Chrome 强制验证注册的可执行文件身份，第三方进程无法冒充 |
| WebSocket | 可选（`--ws`） | 云端/容器化部署，CLI 与 Chrome 分机运行；或本地调试 | Token 鉴权（见下文） |

> **Native Messaging 为何是本地默认**：Chrome 的 Native Messaging 协议要求 CLI 可执行文件必须在操作系统中注册 Manifest（macOS: `~/Library/Application Support/`，Windows: 注册表），只有注册的程序才能与扩展通信。这意味着本机上的任何恶意进程都无法冒充 CLI 来劫持浏览器 Session。对于操作真实用户账号的 WebEnvoy 来说，这层系统级安全保障不可放弃。详细注册安装方案见下文。

> **WebSocket 何时使用**：当 CLI 和 Chrome 不在同一台物理机（如 Docker 容器编排、云端浏览器集群）时，Native Messaging 不可用，需要切换为 WebSocket。此时必须启用 Token 鉴权：

```typescript
// CLI 启动 WebSocket Server 时生成一次性 Token
const token = crypto.randomUUID()
// Token 通过环境变量或启动参数传递给 Extension
// Extension 连接时在首条消息中携带 Token，Server 校验后才接受后续通信
```

> **Extension 发起连接**：两种模式下均由 Extension Background（Service Worker）主动发起连接。Native Messaging 中 CLI 作为 Native Host 被动监听；WebSocket 中 CLI 启动 Server 监听动态端口。

---

## Service Worker 保活与心跳机制

MV3 的 Background 是 **Service Worker** 机制，Chrome 会在其**空闲约 30 秒后强制休眠**，导致 Native Messaging 连接静默断开。必须在两端实现心跳机制对抗此行为：

**Extension Background 侧（心跳发送方）**：

```typescript
// background.ts
let port: chrome.runtime.Port | null = null

const connect = () => {
  port = chrome.runtime.connectNative('com.webenvoy.host')
  port.onDisconnect.addListener(() => {
    port = null
    // 断连后 5s 重试
    setTimeout(connect, 5000)
  })
}

// 每 20s 发一次心跳（早于 Chrome 30s 休眠阈值）
setInterval(() => {
  port?.postMessage({ method: '__ping__' })
}, 20_000)
```

**CLI Native Host 侧（心跳响应方）**：

```go
// 收到 __ping__ 立即回复 __pong__
case "__ping__":
    writeMessage(conn, map[string]string{"method": "__pong__"})
```

**与账号状态机的联动**：心跳超时（连续 2 次未收到 `__pong__`）触发浏览器生命周期状态机进入「异常断开」状态，CLI 自动尝试重连；30 秒超时后上报错误，等待人工介入。详见 [account.md](./account.md)。

---

## Native Messaging Host 注册安装

> 调研已完成（2026年03月17日）。参考实现：KeePassXC `NativeMessageInstaller.cpp`。
> 调研报告：[keepassxc_analysis.md](../../../research/ref/keepassxc_analysis.md)

Native Messaging 通道的前提是 CLI 在操作系统中完成注册。WebEnvoy 通过 `webenvoy install` / `webenvoy uninstall` 命令管理注册状态，不在 Extension 启动时自动注册（需要系统写权限，应由用户主动触发）。

对 `#279` 冻结后的主路径，还需额外满足以下边界：

- `allowed_origins` 必须绑定稳定 `extension_id`，不接受通配或 run 级临时 origin
- official branded Google Chrome 是当前正式主路径；Chromium / Chrome for Testing 仅保留为开发、调试和验证 fallback
- 安装/分发路径可以继续演进，但不得覆盖 `stable extension_id + allowed_origins + runtime_bootstrap_envelope` 这组正式边界

### Manifest 文件内容

WebEnvoy 只需支持 Chrome（Chromium 系），不支持 Firefox，只生成一种格式：

```json
{
  "name": "com.webenvoy.host",
  "description": "WebEnvoy CLI ↔ Extension bridge",
  "path": "/path/to/webenvoy-host",
  "type": "stdio",
  "allowed_origins": [
    "chrome-extension://<WEBENVOY_EXTENSION_ID>/"
  ]
}
```

文件名：`com.webenvoy.host.json`。`path` 字段在 Windows 上须包含 `.exe` 后缀，在 macOS/Linux 上直接指向可执行文件。

这里的 `<WEBENVOY_EXTENSION_ID>` 必须来自稳定扩展身份边界，而不是 unpacked staging 后偶然得到的临时值。

## 安装/分发路径分级

本次 architecture freeze 只冻结运行时与 identity 边界，不冻结最终安装/分发实现。当前分级如下：

- `developer mode / unpacked`：`candidate / transition path`
- `External Extensions JSON`：`candidate`
- Windows 外部安装/注册表 + 用户确认：`candidate`
- Chrome Web Store / 合规上架：后续产品化方向

额外约束：

- 上述路径都不能替代 official Chrome 主路径必须先冻结的 runtime / identity / bootstrap 边界
- 当前不设计最终安装器实现，不承诺 Chrome 商店上架方案已经定稿
- 不把任何 candidate 安装路径写成当前正式主方案

### 三平台注册路径

**macOS**（用户目录，无需 sudo）：

| 浏览器 | Manifest 写入目录 |
|---|---|
| Chrome | `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/` |
| Chrome Beta | `~/Library/Application Support/Google/Chrome Beta/NativeMessagingHosts/` |
| Chromium | `~/Library/Application Support/Chromium/NativeMessagingHosts/` |
| Brave | `~/Library/Application Support/BraveSoftware/Brave-Browser/NativeMessagingHosts/` |
| Edge | `~/Library/Application Support/Microsoft Edge/NativeMessagingHosts/` |

**Linux**（用户目录，无需 sudo）：

| 浏览器 | Manifest 写入目录 |
|---|---|
| Chrome | `~/.config/google-chrome/NativeMessagingHosts/` |
| Chromium | `~/.config/chromium/NativeMessagingHosts/` |
| Brave | `~/.config/BraveSoftware/Brave-Browser/NativeMessagingHosts/` |
| Edge | `~/.config/microsoft-edge/NativeMessagingHosts/` |

> Snap/Flatpak 安装的浏览器通常无法使用（沙箱隔离），超出 Phase 1 范围。

**Windows**（HKCU 注册表，无需 UAC 提权）：

| 浏览器 | 注册表键路径 |
|---|---|
| Chrome | `HKCU\Software\Google\Chrome\NativeMessagingHosts\com.webenvoy.host` |
| Chromium | `HKCU\Software\Chromium\NativeMessagingHosts\com.webenvoy.host` |
| Brave | `HKCU\Software\Google\Chrome\NativeMessagingHosts\com.webenvoy.host`（复用 Chrome）|
| Edge | `HKCU\Software\Microsoft\Edge\NativeMessagingHosts\com.webenvoy.host` |

注册表键的 `(Default)` 值为 JSON 文件绝对路径，JSON 文件存放于 `%LOCALAPPDATA%\WebEnvoy\com.webenvoy.host.json`。

```typescript
// Windows 注册表写入（通过 reg.exe，无需第三方库）
import { execSync } from 'child_process'
const key = `HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts\\com.webenvoy.host`
execSync(`reg add "${key}" /ve /t REG_SZ /d "${jsonPath}" /f`)
```

### 关键工程约束

1. **`path` 必须为绝对路径**，不能用 `~` 缩写
2. **macOS/Linux 可执行文件必须有 `0755` 权限**，缺失时 Chrome 静默失败报 `Could not connect to the native messaging host`
3. **幂等性**：重复执行 `install` 安全（先删旧文件/键，再写新）
4. **卸载时完整清理**：删除 JSON 文件 + Windows 注册表键值
5. **升级时重新注册**：CLI 路径变更后需重新执行 `install` 覆盖旧路径
