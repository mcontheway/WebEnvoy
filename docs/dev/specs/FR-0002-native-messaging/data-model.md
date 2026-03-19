# FR-0002 数据模型（通信层最小共享实体）

## 边界说明

本文件只定义 FR-0002 在通信链路内共享的运行时实体，用于约束握手、转发、心跳、断连和错误分类的一致语义。

明确不包含：

- SQLite 表结构、索引、迁移
- Profile 的持久化结构
- 完整账号生命周期

与其他 FR 的边界：

- FR-0003 负责最小身份 / 会话语义与执行隔离，不在本文件重复定义其账号模型。
- #144 负责最小持久化与运行记录，本文件不提前给出落库 schema。

## 实体 1：BridgeSession（连接级会话）

### 语义

表示 Extension Background 与 CLI Native Host 之间的一条连接级会话。该实体不承载单次命令业务 payload。

### 核心字段

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `session_id` | string | 是 | 连接级会话标识，握手成功后生成 |
| `protocol` | string | 是 | 协议名与版本，例如 `webenvoy.native-bridge.v1` |
| `state` | enum | 是 | `idle` / `handshaking` / `ready` / `forwarding` / `disconnected` / `failed` |
| `profile` | string | 否 | 来自调用上下文，transport 层仅透传不解释 |
| `opened_at` | string (ISO-8601) | 是 | 首次握手成功时间 |
| `last_heartbeat_at` | string (ISO-8601) | 否 | 最近一次心跳成功时间 |
| `disconnected_at` | string (ISO-8601) | 否 | 进入断连状态时间 |
| `disconnect_reason` | enum | 否 | `on_disconnect` / `heartbeat_timeout` / `host_exit` / `unknown` |

### 约束

- `session_id` 在同一连接生命周期内唯一。
- 只有 `state=ready` 才允许接收正常转发。
- 断连后必须重新握手，不得复用旧连接会话继续转发。

### 生命周期

`idle -> handshaking -> ready -> forwarding (可重入) -> ready -> disconnected -> handshaking | failed`

## 实体 2：ForwardRequest（单次转发调用）

### 语义

表示一次 `bridge.forward` 调用上下文，绑定单条命令的往返，不上提为连接级状态。

### 核心字段

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `id` | string | 是 | 请求-响应配对标识 |
| `run_id` | string | 是 | 单次命令运行标识 |
| `command` | string | 是 | 运行时命令名，例如 `runtime.ping` |
| `command_params` | object | 否 | 页面侧命令参数 |
| `cwd` | string | 否 | 调用工作目录 |
| `timeout_ms` | integer | 是 | 单次调用超时预算 |
| `sent_at` | string (ISO-8601) | 是 | 发起时间 |
| `completed_at` | string (ISO-8601) | 否 | 完成时间 |
| `result_status` | enum | 否 | `success` / `error` / `timeout` / `disconnected` |

### 约束

- `run_id` 仅属于单次调用上下文，不能作为握手字段。
- `timeout_ms` 仅约束当前调用，不改变连接级会话状态。
- `id` 必须在请求与响应中保持一致，不引入额外 `correlation_id`。

### 生命周期

`created -> forwarded -> completed | timeout | disconnected`

## 实体 3：HeartbeatSample（心跳样本）

### 语义

表示一次心跳探活记录，用于断连判定与恢复窗口控制。

### 核心字段

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `heartbeat_id` | string | 是 | 心跳请求标识 |
| `session_id` | string | 是 | 关联的连接会话 |
| `sent_at` | string (ISO-8601) | 是 | 发送时间 |
| `ack_at` | string (ISO-8601) | 否 | 应答时间 |
| `status` | enum | 是 | `acked` / `missed` |

### 约束

- 连续 `missed` 到达阈值时必须触发 `BridgeSession.state=disconnected`。
- 心跳失败判定优先于把问题归类为普通业务超时。

## 实体 4：TransportErrorEvent（通信层错误事件）

### 语义

表示 link-layer 错误分类输出，供 FR-0001 外层错误壳承载。

### 核心字段

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `error_code` | enum | 是 | `ERR_TRANSPORT_HANDSHAKE_FAILED` / `ERR_TRANSPORT_NOT_READY` / `ERR_TRANSPORT_FORWARD_FAILED` / `ERR_TRANSPORT_TIMEOUT` / `ERR_TRANSPORT_DISCONNECTED` |
| `session_id` | string | 否 | 关联连接会话 |
| `run_id` | string | 否 | 关联单次调用 |
| `failure_site` | enum | 是 | `handshake` / `forward` / `heartbeat` / `disconnect` |
| `occurred_at` | string (ISO-8601) | 是 | 发生时间 |
| `message` | string | 否 | 面向排障的短消息 |

### 约束

- 只定义通信层错误，不覆盖页面业务错误。
- `ERR_TRANSPORT_TIMEOUT` 仅在连接可观测为可用且 `timeout_ms` 到期时成立。
- 已观测到断连信号时，优先归类为 `ERR_TRANSPORT_DISCONNECTED`。
