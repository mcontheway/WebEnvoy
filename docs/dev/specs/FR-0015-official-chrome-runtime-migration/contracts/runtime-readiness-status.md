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
- `RuntimeTakeoverEvidence.attachableReadyRuntime` / `RuntimeTakeoverEvidence.orphanRecoverable` 只表达 pre-lock handoff facts
- `postLockTakeoverGate` 负责表达“调用方已重新持锁后，attach/rebind 是否还能继续”

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

补充约束：

- `runtime.status` 顶层只允许承载单实例状态视图。
- pre-lock handoff facts 如需对外暴露，必须通过 formal-only、transient、non-persistent 的 `RuntimeTakeoverEvidence` sidecar 承载；不得继续作为顶层字段返回。

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
- `stale` 表示当前 bootstrap request 收到 stale ack 或陈旧 ready marker；ack 的 request identity 仍必须匹配当前请求。只有提供 `runtime.bootstrap.ack.result.stale_provenance` 且字段满足 `runtime-bootstrap` contract 时，旧 marker / observed runtime identity 才能作为 `stale_bootstrap_rebind` 的 provenance 消费；缺少该对象的 stale ack 只能保持硬阻断

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

### `takeoverEvidenceObservedAt`

取值：

- ISO-8601 timestamp
- `null`

说明：

- 该字段由 runtime status 聚合器在同一次 pre-lock handoff evaluation 中生成。
- 该字段只作为 `RuntimeTakeoverEvidence.freshness` 的 source machine field，不表示业务命令已可执行。
- 对 `mode=stale_bootstrap_rebind`，该字段必须存在，且不得早于当前 `runtime.bootstrap.params.requested_at`。
- 若该字段缺失、格式非法，或早于当前 request 的 `requested_at`，不得形成 `staleBootstrapRecoverable=true`。

## `RuntimeTakeoverEvidence`

`RuntimeTakeoverEvidence` 是 formal-only、transient、non-persistent 的 pre-lock handoff evidence 对象。

边界要求：

- 它用于承载接管路径在持锁前观察到的候选事实，不属于 `runtime.status` 顶层单实例状态视图。
- 它不得持久化到 profile 元数据、SQLite 或其他长期状态仓库。
- 它只能表达 pre-lock handoff facts，不能单独授权 attach/rebind。
- attach/rebind 动作面的最终授权必须在当前调用方重新持有 FR-0003 profile 独占锁后，通过 `postLockTakeoverGate` 计算。
- 它至少需要区分：
  - `mode=ready_attach`
  - `mode=recoverable_rebind`
  - `mode=stale_bootstrap_rebind`
- 它至少需要携带以下最小判定事实：
  - `freshness`
  - `identityBound`
  - `ownerConflictFree`
  - `controllerBrowserContinuity`
  - `transportBootstrapViable`
  - `observedRunId`
  - `observedRuntimeInstanceId | null`
  - `runtimeContextId | null`
  - `requestRunId | null`
  - `requestRuntimeContextId | null`
  - stale-bootstrap rebind 场景必须携带非空 `requestRunId`、`requestRuntimeContextId`、`managedTargetTabId`、`managedTargetDomain`、`managedTargetPage` 与 `targetTabContinuity`
- `RuntimeTakeoverEvidence` 必须在对应 mode 已冻结来源时绑定到具体 observed runtime instance，而不是只表达抽象“可接管”结论。
- 对 `mode=ready_attach` 与 `mode=recoverable_rebind`，`requestRunId` 与 `requestRuntimeContextId` 必须为 `null` 或缺省；它们不得被解释为这两种 mode 的 takeover gate。
- 对 `mode=ready_attach` 与 `mode=recoverable_rebind`，`observedRuntimeInstanceId` 可以为 `null` 或缺省，除非后续 formal contract 单独冻结这两种 mode 的 source machine field；本 PR 不为它们定义新的 observed runtime instance source。
- 若后续 attach/rebind 针对已冻结 observed runtime instance 来源的 evidence，且无法证明目标仍是同一个 observed runtime instance，则 `postLockTakeoverGate` 必须返回 `deny`。
- 对 `mode=stale_bootstrap_rebind`，`postLockTakeoverGate` 还必须复验冻结 target 字段仍匹配当前 managed target：`managedTargetTabId`、`managedTargetDomain`、`managedTargetPage` 与 `targetTabContinuity=runtime_trust_state`；任一缺失或不匹配都必须返回 `deny`。
- 对 `mode=stale_bootstrap_rebind`，`RuntimeTakeoverEvidence.requestRunId` 与 `requestRuntimeContextId` 必须分别等于当前 replacement run 的 `(run_id, runtime_context_id)`；`postLockTakeoverGate` 必须复验该 request identity，防止旧 evidence 被其他 run 重放。

### stale-bootstrap recovery proof mapping

`mode=stale_bootstrap_rebind` 的 proof fields 必须由以下机器来源生成；不得由日志文本、issue comment、人工推断或未冻结字段名补齐。

| proof | source machine field | runtime.status 映射 | RuntimeTakeoverEvidence 映射 | 缺失 / 不匹配处理 |
|---|---|---|---|---|
| request run identity | `runtime.bootstrap.ack.result.run_id`，且必须等于当前 `runtime.bootstrap.params.run_id` | 不改变顶层 `runtimeReadiness=blocked` / `bootstrapState=stale` | `requestRunId` | `deny`，保持 `ERR_RUNTIME_BOOTSTRAP_ACK_STALE` |
| request context identity | `runtime.bootstrap.ack.result.runtime_context_id`，且必须等于当前 `runtime.bootstrap.params.runtime_context_id` | 不改变顶层 `runtimeReadiness=blocked` / `bootstrapState=stale` | `requestRuntimeContextId` | `deny`，保持 `ERR_RUNTIME_BOOTSTRAP_ACK_STALE` |
| stale provenance kind | `runtime.bootstrap.ack.result.stale_provenance.kind` | 只允许贡献 `bootstrapState=stale`，不得提升为 `ready` | 参与 `mode=stale_bootstrap_rebind` 判定 | `deny`，缺失时按普通 stale ack 硬阻断 |
| observed run identity | `runtime.bootstrap.ack.result.stale_provenance.observed_run_id`，且不得等于当前 request `run_id` | 不写入顶层 current run readiness | `observedRunId` | `deny` |
| observed context identity | `runtime.bootstrap.ack.result.stale_provenance.observed_runtime_context_id`，且不得等于当前 request `runtime_context_id` | 不写入顶层 current run readiness | `runtimeContextId` | `deny` |
| observed runtime instance | `runtime.bootstrap.ack.result.stale_provenance.observed_runtime_instance_id`，且必须为非空字符串 | 不写入顶层 current run readiness | `observedRuntimeInstanceId` | `deny` |
| identity binding | `runtime.status.identityBindingState=bound` | 保持当前 `identityBindingState=bound` | `identityBound=true` | `deny` |
| transport viability | `runtime.status.transportState=ready` 且 ack 已进入 `bootstrapState=stale` | 保持 `transportState=ready` / `bootstrapState=stale` | `transportBootstrapViable=true` | `deny` |
| owner conflict | FR-0003 profile lock / controller ownership attestation | 若冲突则 `runtimeReadiness=blocked` | `ownerConflictFree=true` | `deny` |
| browser/controller continuity | official Chrome controller/browser continuity attestation | 若不连续则 `runtimeReadiness=blocked` | `controllerBrowserContinuity=true` | `deny` |
| target tab | readiness target attestation `managedTargetTabId`，且等于当前 request `target_tab_id` | 不改变顶层 readiness；作为 target handoff fact | `managedTargetTabId` | `deny` |
| target domain | readiness target attestation `managedTargetDomain`，且等于当前 request `target_domain` | 不改变顶层 readiness；作为 target handoff fact | `managedTargetDomain` | `deny` |
| target page | readiness target attestation `managedTargetPage`，且等于当前 request `target_page` | 不改变顶层 readiness；作为 target handoff fact | `managedTargetPage` | `deny` |
| target continuity | readiness target attestation `targetTabContinuity=runtime_trust_state` | 不改变顶层 readiness；作为 target handoff fact | `targetTabContinuity` | `deny` |
| freshness | `runtime.status.takeoverEvidenceObservedAt`，且不得早于当前 `runtime.bootstrap.params.requested_at` | 不改变顶层 readiness；只证明 handoff evidence 属于当前 request evaluation | `freshness=fresh` | `deny` |
| execution surface | official Chrome runtime attestation `execution_surface=real_browser` 与 `headless=false` | 若不满足则 `runtimeReadiness=blocked` | 只作为 gate input，不写入 evidence required fields | `deny` |
| consumer safety gates | account safety、rhythm、anti-detection validation / admission gate outputs | 若不满足则 `runtimeReadiness=blocked` 或 command preflight `NO_GO` | 只作为 gate input，不写入 evidence required fields | `deny` |

映射约束：

- `RuntimeTakeoverEvidence(mode=stale_bootstrap_rebind)` 必须一次性冻结上表所有 required evidence fields；后续 `postLockTakeoverGate` 不得重新查询新的 pre-lock evidence 来补字段。
- `runtime.status` 顶层仍必须保持 `runtimeReadiness=blocked` 与 `bootstrapState=stale`，直到 replacement run attach/rebind 后重新下发并收到新的 `status=ready` ack。
- 任一 proof field 缺失、类型不符、来源不匹配或来自未冻结 source，均不得形成 `staleBootstrapRecoverable=true`。
- post-lock 阶段只能消费锁切换前冻结的 `RuntimeTakeoverEvidence`；不得把当前 live tab、当前日志或旧 artifact 作为缺失字段的补充来源。

### `RuntimeTakeoverEvidence.attachableReadyRuntime`

取值：

- `true`
- `false`

说明：

- 该字段只表达“当前 status 聚合器是否已经证明这个 ready runtime 在锁切换前形成了可供后续接管消费的 ready-runtime handoff fact”。
- 它不是业务命令放行门禁，也不等价于 `runtimeReadiness=ready`。
- `lockHeld=false` 时，`RuntimeTakeoverEvidence.attachableReadyRuntime=true` 仍是合法状态；这表示 handoff 条件已成立，但当前调用方尚未拿到最终执行接管所需的 FR-0003 独占锁。
- `RuntimeTakeoverEvidence.attachableReadyRuntime` 是额外的派生 handoff fact；`lockHeld`、`transportState`、`bootstrapState`、`runtimeReadiness` 继续保持它们在现有 `runtime.status` 契约中的单一语义，不得因 takeover 查询场景被重解释为“另一个 runtime 实例”的状态。
- `RuntimeTakeoverEvidence.attachableReadyRuntime` 只表达 ready-runtime handoff 事实本身，不能单独授权 attach/rebind。

判定要求：

- `true` 至少要求：
  - 当前 profile 仍表现为 `profileState=ready`
  - `identityBindingState=bound`
  - status 聚合器已对现存 runtime 给出“ready runtime” attestation，不能只停留在 `pending` / `not_started` / `ERR_RUNTIME_BOOTSTRAP_NOT_DELIVERED` / `ERR_RUNTIME_BOOTSTRAP_ACK_TIMEOUT`
  - 该 ready-runtime 证明是独立 handoff 事实，不要求调用方通过当前 top-level `bootstrapState` / `transportState` 去反向推断另一个 runtime 实例
  - readiness attestation 未报告 identity/context conflict（例如 `ERR_RUNTIME_BOOTSTRAP_IDENTITY_MISMATCH`、`ERR_RUNTIME_READY_SIGNAL_CONFLICT`）
  - 锁与控制者连续性仍足以证明该 ready-runtime handoff fact 在持锁前成立
  - 当前 status 视图必须排除“另一条 controller 仍有效持有该 profile 的独占控制”这一真实 owner 冲突
- `false` 用于：
  - transport 未就绪
  - readiness probe 尚未实际验证当前 runtime
  - runtime 虽然可恢复，但并未处于已验证 ready 态
  - bootstrap 已 stale；stale recovery 必须只通过独立的 `staleBootstrapRecoverable=true` / `mode=stale_bootstrap_rebind` 表达，不能提升为 ready attach
  - readiness attestation 已明确 identity/context conflict
  - 锁/控制者连续性不足，无法证明该 pre-lock handoff fact
  - 另一条 controller 仍被证明有效持有该 profile 的独占控制

### `RuntimeTakeoverEvidence.staleBootstrapRecoverable`

取值：

- `true`
- `false`

说明：

- 该字段只表达“当前 bootstrap request 已观察到满足 `runtime.bootstrap.ack.result.stale_provenance` 机器字段要求的旧 run/context provenance，且当前 status 聚合器已证明同一 managed runtime 与同一 target tab/domain/page 仍可由新 run 接管后重新 bootstrap”的 pre-lock handoff fact。
- 它不是 `runtimeReadiness=ready`，也不得把旧 run 的 stale ack 当作当前 run 的 ready ack。
- 它只允许用于先 attach/rebind replacement/current requested run，再重新下发当前 `(run_id, runtime_context_id)` 的 `runtime.bootstrap`；业务命令仍必须等重新 bootstrap 后达到 `runtimeReadiness=ready` 才能放行。
- 它必须绑定明确 target continuity，不能用于无 target 的通用接管，也不能跨 tab、跨 domain、跨 profile 或跨 browser instance 复用。

判定要求：

- `true` 至少要求：
  - `identityBindingState=bound`
  - `transportState=ready`
  - `bootstrapState=stale`
  - `stale_provenance.kind` 为 `ready_marker | observed_runtime`
  - `stale_provenance.observed_run_id` 与 `stale_provenance.observed_runtime_context_id` 均为非空字符串，且分别不等于当前 `(run_id, runtime_context_id)`
  - `stale_provenance.observed_runtime_instance_id` 为非空字符串
  - 冻结 `RuntimeTakeoverEvidence(mode=stale_bootstrap_rebind)` 时，必须把当前 bootstrap request 的 `run_id` 与 `runtime_context_id` 原样写入 `RuntimeTakeoverEvidence.requestRunId` 与 `requestRuntimeContextId`
  - 冻结 `RuntimeTakeoverEvidence(mode=stale_bootstrap_rebind)` 时，必须把 `stale_provenance.observed_runtime_instance_id` 原样写入 `RuntimeTakeoverEvidence.observedRuntimeInstanceId`
  - 当前请求提供完整 `target_domain`、`target_tab_id`、`target_page`
  - readiness target attestation 返回同一个 `managedTargetTabId` / `managedTargetDomain` / `managedTargetPage`
  - `targetTabContinuity=runtime_trust_state`
  - `freshness=fresh`
  - `ownerConflictFree=true`
  - `controllerBrowserContinuity=true`
  - execution surface 已证明为 official Chrome `real_browser`
  - `headless=false`
  - 消费方已有的 account safety、rhythm、anti-detection validation / admission gates 均已通过；stale recovery 不得绕过这些 gate
- `false` 用于：
  - 缺少完整 target binding
  - target continuity 缺失或不匹配
  - identity、transport、profile/browser continuity 任一不满足
  - 试图把 stale ack 直接作为 ready evidence 消费

### `RuntimeTakeoverEvidence.orphanRecoverable`

取值：

- `true`
- `false`

说明：

- 该字段只表达“当前 status 聚合器是否已经证明一个 `runtimeReadiness=recoverable` 的 runtime 在锁切换前形成了可供后续接管消费的 recoverable handoff fact”。
- 它只适用于 recoverable takeover，不适用于 `runtimeReadiness=ready` 的 ready-runtime attach 场景。
- 它不是业务命令放行门禁，也不替代 `runtimeReadiness` / `RuntimeTakeoverEvidence.attachableReadyRuntime`。
- `RuntimeTakeoverEvidence.orphanRecoverable` 同样是额外的派生 handoff fact；调用方不得把它解读为 top-level `runtimeReadiness` / `lockHeld` / `bootstrapState` 已经切换到另一条 runtime 实例的状态。
- `RuntimeTakeoverEvidence.orphanRecoverable` 只表达 recoverable handoff 事实本身，不能单独授权 attach/rebind。
- `RuntimeTakeoverEvidence.orphanRecoverable` 只适用于“尚未有 controller 重新取得有效独占控制”的 pre-lock handoff 视图；一旦 replacement controller 或其他 controller 重新持有有效独占锁，新的 pre-lock evidence 中该字段必须回落为 `false`。

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

## `postLockTakeoverGate`

取值：

- `allow`
- `deny`

说明：

- `postLockTakeoverGate` 是 attach/rebind 动作面在“当前调用方已重新持有 FR-0003 profile 独占锁之后”消费的 gate。
- 它不是新的 `runtime.status` 顶层字段，也不要求 relock 后新的 pre-lock evidence 持续返回 `orphanRecoverable=true`。
- 它只允许消费锁切换前已成立的 `RuntimeTakeoverEvidence` 或等价的内部 attach 状态。
- 它必须继续校验该 evidence 仍绑定到同一个已冻结来源的 observed runtime instance；对 `mode=stale_bootstrap_rebind`，校验输入必须包含并匹配 `RuntimeTakeoverEvidence.observedRuntimeInstanceId`，不得只靠 `observedRunId` 或 `runtimeContextId` 推断。
- 对 `mode=stale_bootstrap_rebind`，它还必须复验 `RuntimeTakeoverEvidence.managedTargetTabId`、`managedTargetDomain`、`managedTargetPage` 与当前 post-lock observed target 完全一致，并确认 `targetTabContinuity=runtime_trust_state` 仍成立；不能把锁切换前的 target evidence 套用到新的 tab、domain 或 page。
- 对 `mode=stale_bootstrap_rebind`，它还必须复验 `RuntimeTakeoverEvidence.requestRunId` 与 `requestRuntimeContextId` 等于当前 replacement run 的 `(run_id, runtime_context_id)`；不匹配时必须返回 `deny`。

业务接管要求：

- 调用方只有在自己已持有 FR-0003 profile 独占锁，且存在 `RuntimeTakeoverEvidence(mode=ready_attach)` 并通过 `postLockTakeoverGate=allow` 时，才允许对 ready runtime 尝试 attach/rebind
- 调用方只有在自己已持有 FR-0003 profile 独占锁，且存在 `RuntimeTakeoverEvidence(mode=recoverable_rebind)` 并通过 `postLockTakeoverGate=allow` 时，才允许对 recoverable runtime 尝试 attach/rebind
- 调用方只有在自己已持有 FR-0003 profile 独占锁，且存在 `RuntimeTakeoverEvidence(mode=stale_bootstrap_rebind)` 并通过 `postLockTakeoverGate=allow` 时，才允许对 stale-bootstrap runtime 尝试 attach/rebind；随后必须重新下发 replacement run 的 `runtime.bootstrap`
- `RuntimeTakeoverEvidence.orphanRecoverable=true` 不得被解释为“业务命令已可直接执行”；recoverable runtime 仍需先完成 attach/rebind，再进入后续 bootstrap/command 阶段
- `RuntimeTakeoverEvidence.staleBootstrapRecoverable=true` 不得被解释为“业务命令已可直接执行”；stale-bootstrap runtime 仍需先完成 attach/rebind 与 replacement run bootstrap，再进入后续 command 阶段
- replacement controller 在重新取得 FR-0003 独占锁后，不得再依赖新的 pre-lock evidence 持续返回 `orphanRecoverable=true`；后续 attach/rebind 必须消费锁切换前已成立的 `RuntimeTakeoverEvidence` 或等价的内部 attach 状态

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
