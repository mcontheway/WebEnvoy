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
- `attachableReadyRuntime`
- `orphanRecoverable`

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

### `attachableReadyRuntime`

取值：

- `true`
- `false`

说明：

- 该字段只表达“当前 `runtime.status` 视图是否已经证明这个 ready runtime 可被新的 `run_id` 安全接管并重新 bootstrap”。
- 它不是业务命令放行门禁，也不等价于 `runtimeReadiness=ready`。
- `lockHeld=false` 时，`attachableReadyRuntime=true` 仍是合法状态；这表示 handoff 条件已成立，但当前调用方尚未拿到最终执行接管所需的 FR-0003 独占锁。
- `attachableReadyRuntime` 是额外的派生 handoff 字段；`lockHeld`、`transportState`、`bootstrapState`、`runtimeReadiness` 继续保持它们在现有 `runtime.status` 契约中的单一语义，不得因 takeover 查询场景被重解释为“另一个 runtime 实例”的状态。
- `attachableReadyRuntime` 只表达 ready-runtime handoff 事实本身，不能单独授权 attach/rebind；真正执行接管前，当前调用方仍必须先持有 FR-0003 profile 独占锁。

判定要求：

- `true` 至少要求：
  - 当前 profile 仍表现为 `profileState=ready`
  - `identityBindingState=bound`
  - status 聚合器已对现存 runtime 给出“ready runtime” attestation，不能只停留在 `pending` / `not_started` / `ERR_RUNTIME_BOOTSTRAP_NOT_DELIVERED` / `ERR_RUNTIME_BOOTSTRAP_ACK_TIMEOUT`
  - 该 ready-runtime 证明是独立 handoff 事实，不要求调用方通过当前 top-level `bootstrapState` / `transportState` 去反向推断另一个 runtime 实例
  - readiness attestation 未报告 identity/context conflict（例如 `ERR_RUNTIME_BOOTSTRAP_IDENTITY_MISMATCH`、`ERR_RUNTIME_READY_SIGNAL_CONFLICT`）
  - 锁与控制者连续性仍足以证明“接下来执行 attach/rebind 是安全的”
  - 当前 status 视图必须排除“另一条 controller 仍有效持有该 profile 的独占控制”这一真实 owner 冲突
- `false` 用于：
  - transport 未就绪
  - readiness probe 尚未实际验证当前 runtime
  - runtime 虽然可恢复，但并未处于已验证 ready 态
  - bootstrap 已 stale
  - readiness attestation 已明确 identity/context conflict
  - 锁/控制者连续性不足，无法证明 safe takeover
  - 另一条 controller 仍被证明有效持有该 profile 的独占控制

### `orphanRecoverable`

取值：

- `true`
- `false`

说明：

- 该字段只表达“当前 `runtime.status` 视图是否已经证明一个 `runtimeReadiness=recoverable` 的 runtime 仍可被新的 `run_id` 安全接管并完成 owner/rebind”。
- 它只适用于 recoverable takeover，不适用于 `runtimeReadiness=ready` 的 ready-runtime attach 场景。
- 它不是业务命令放行门禁，也不替代 `runtimeReadiness` / `attachableReadyRuntime`。
- `orphanRecoverable` 同样是额外的派生 handoff 字段；调用方不得把它解读为 top-level `runtimeReadiness` / `lockHeld` / `bootstrapState` 已经切换到另一条 runtime 实例的状态。
- `orphanRecoverable` 只表达 recoverable handoff 事实本身，不能单独授权 attach/rebind；真正执行接管前，当前调用方仍必须先持有 FR-0003 profile 独占锁。
- `orphanRecoverable` 只适用于“尚未有 controller 重新取得有效独占控制”的 pre-lock handoff 视图；一旦 replacement controller 或其他 controller 重新持有有效独占锁，该字段必须回落为 `false`。

判定要求：

- `true` 至少要求：
  - `runtimeReadiness=recoverable`
  - `identityBindingState=bound`
  - 当前 status 视图已经证明旧 owner 不再持有有效独占控制；仅凭锁文件仍存在、旧 pid 仍存活或单一心跳残留，不足以把 runtime 标为可 recoverable takeover
  - 当前 status 视图也必须排除“另一条 controller 已经重新取得该 profile 的有效独占控制”的并发冲突
  - 当前 runtime 的 browser/controller 所有权连续性仍可验证
  - 运行时现场仍存在可恢复的 transport/bootstrap 基础，不能退化为 `transportState=not_connected` 或 `bootstrapState=stale`
  - profile 仍处于允许 recoverable takeover 的运行态（例如 `ready` / `disconnected`）
- `false` 用于：
  - 当前状态不是 recoverable takeover 场景
  - identity binding 缺失、冲突或不再处于 `bound`
  - 旧 owner 仍被证明持有有效独占控制
  - 另一条 controller 已被证明重新取得该 profile 的有效独占控制
  - browser/controller 所有权连续性不足
  - transport/bootstrap 信号不足以证明当前 runtime 仍可恢复
  - profile 已离开可恢复运行态

业务接管要求：

- 调用方只有在自己已持有 FR-0003 profile 独占锁，且 `attachableReadyRuntime=true` 时，才允许对 ready runtime 尝试 attach/rebind
- 调用方只有在自己已持有 FR-0003 profile 独占锁，且 `runtimeReadiness=recoverable` 且 `orphanRecoverable=true` 时，才允许对 recoverable runtime 尝试 attach/rebind
- `orphanRecoverable=true` 不得被解释为“业务命令已可直接执行”；recoverable runtime 仍需先完成 attach/rebind，再进入后续 bootstrap/command 阶段
- replacement controller 在重新取得 FR-0003 独占锁后，不得再依赖 `runtime.status` 持续返回 `orphanRecoverable=true`；后续 attach/rebind 必须消费锁切换前已成立的 handoff 证据或等价的内部 attach 状态，而不是要求该字段在 relock 后继续暴露

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
