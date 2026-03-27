# runtime-readiness-status contract

## 文档定位

本文档冻结 `#281` 在 official Chrome 持久扩展主路径下的 `runtime.status` readiness 增量契约。它在 FR-0003 `runtime-session` 契约之上追加 runtime readiness 视图，不回改 FR-0003 已冻结的 Profile 生命周期、锁和代理绑定基线。

## 契约边界

- 边界名称：`runtime_readiness_status_view`
- 生产者：runtime controller / status aggregator
- 消费者：
  - `runtime.status`
  - 后续 runtime migration 实现 PR
  - 调试与人工 smoke 流程

## 兼容策略

FR-0003 继续保留：

- `profileState`
- `browserState`

FR-0015 追加的 readiness 视图不得重定义这两个字段的原语义，而是通过新增字段表达 official Chrome persistent extension 主路径下的 runtime readiness 分层。

换句话说：

- `profileState` 继续表达持久化 Profile 状态
- `browserState` 继续表达浏览器实例态
- `runtimeReadiness` 负责表达“当前 profile/transport/bootstrap 是否足以执行业务命令”

## `runtime.status` 最小返回

在 FR-0015 范围内，`runtime.status` 至少应继续返回：

- `profile`
- `profileState`
- `browserState`
- `profileDir`
- `proxyUrl`
- `lockHeld`

并新增：

- `lockHeld`
- `identityBindingState`
- `transportState`
- `bootstrapState`
- `runtimeReadiness`

## 字段语义

### `identityBindingState`

取值至少包括：

- `missing`
- `bound`
- `mismatch`

说明：

- `missing`：当前 profile 尚未具备可复用的持久 identity binding
- `bound`：稳定 `extension_id + allowed_origins + profile` 已一致
- `mismatch`：identity 事实存在但彼此不一致，属于阻断态

### `lockHeld`

取值：

- `true`
- `false`

约束：

- `true` 仅表示当前 CLI / controller 仍确认自己持有该 profile 的独占锁
- `false` 表示锁已失效、被抢占或当前归属不可确认
- `lockHeld=false` 时，不得继续维持 `runtimeReadiness=ready`

### `transportState`

取值至少包括：

- `not_connected`
- `ready`
- `disconnected`

说明：

- 该字段承接 FR-0002 link-layer 的当前可用性
- 它本身不等于 runtime ready

### `bootstrapState`

取值至少包括：

- `not_started`
- `pending`
- `ready`
- `stale`
- `failed`

说明：

- `ready` 仅表示当前 run 的 bootstrap ack 已确认
- `stale` 表示收到了非当前 run 的陈旧 ack 或 ready marker

### `runtimeReadiness`

取值至少包括：

- `blocked`
- `pending`
- `ready`
- `recoverable`
- `unknown`

判定要求：

- `ready` 仅在 `lockHeld=true`、`identityBindingState=bound`、`transportState=ready`、`bootstrapState=ready` 时成立
- `blocked` 用于 identity mismatch、明确 stop-ship 或不允许继续执行的状态
- `blocked` 还用于锁被抢占或锁归属不可确认的情况
- `pending` 用于 identity 已就绪但 bootstrap 尚未确认
- `recoverable` 用于 transport 暂时断开、bootstrap timeout 等允许同 run 或显式恢复的场景
- `unknown` 用于多信号冲突、无法确认当前 run ready 归属的保守状态

业务命令门禁要求：

- `runtimeReadiness=ready` 前不得放行业务命令
- `lockHeld=false` 时，即使 transport 与 bootstrap 信号仍为真，也必须降级为 `blocked` 或 `recoverable`

## 与 FR-0003 的关系

- FR-0003 的 `browserState=ready` 继续表示“浏览器实例可用”
- 但在 official Chrome persistent extension 主路径下，“浏览器实例可用”不再自动等于“runtime migration 已完成 bootstrap 并可执行命令”
- 因此后续实现与 review 必须使用 `runtimeReadiness` 作为执行业务命令的最终门禁，而不是单看 `browserState`

## 最小示例

### 示例 1：identity 已就绪，bootstrap 待确认

```json
{
  "profile": "xhs_account_001",
  "profileState": "ready",
  "browserState": "ready",
  "lockHeld": true,
  "identityBindingState": "bound",
  "transportState": "ready",
  "bootstrapState": "pending",
  "runtimeReadiness": "pending"
}
```

### 示例 2：当前 run 已完成 bootstrap

```json
{
  "profile": "xhs_account_001",
  "profileState": "ready",
  "browserState": "ready",
  "lockHeld": true,
  "identityBindingState": "bound",
  "transportState": "ready",
  "bootstrapState": "ready",
  "runtimeReadiness": "ready"
}
```

### 示例 3：identity mismatch 阻断

```json
{
  "profile": "xhs_account_001",
  "profileState": "ready",
  "browserState": "ready",
  "lockHeld": false,
  "identityBindingState": "mismatch",
  "transportState": "ready",
  "bootstrapState": "failed",
  "runtimeReadiness": "blocked"
}
```
