# runtime-bootstrap contract

## 文档定位

本文档冻结 `#281` 在 official Chrome 持久扩展主路径下的 runtime bootstrap 共享契约。它补的是 FR-0002 link-layer handshake 之上的 run/session 输入边界，不重写 FR-0002 的连接级职责。

## 契约边界

- 边界名称：`runtime_bootstrap_envelope`
- 生产者：CLI runtime controller / native host
- 消费者：已绑定到目标 profile 的 Extension Background，以及后续被其初始化的 Content Script / MAIN world runtime
- 生效阶段：Native Messaging link-layer handshake 成功之后，业务命令进入之前

## 版本与兼容策略

- 当前契约版本：`v1`
- 兼容原则：
  - `version` 为必填字段
  - 同一主版本内只允许增加向后兼容的可选字段
  - 若 ack 无法识别 `version`，必须返回显式 bootstrap failure，而不是静默降级
  - 后续若要改变 request/ack 的必填字段或状态语义，必须提升主版本并重新经过 spec review

## 契约目标

1. 把 run/session 级上下文显式送入已安装扩展，而不是再依赖 per-run staged extension 文件。
2. 让 runtime readiness 建立在多信号之上：
  - identity binding ready
  - link-layer ready
  - bootstrap ack ready
3. 为后续实现提供可幂等、可重试、可诊断的 bootstrap 收口面。

## 输入字段

`runtime_bootstrap_envelope` 至少应包含：

- `version`
- `run_id`
- `runtime_context_id`
- `profile`
- `fingerprint_runtime`
- `fingerprint_patch_manifest`
- `main_world_secret`

约束：

- `run_id` 与 `runtime_context_id` 只属于单次 run/session。
- `profile` 必须与当前持久 identity binding 指向同一 profile。
- `main_world_secret` 只用于当前 run 的信任链，不进入持久元数据。
- 本契约不负责冻结新的 bootstrap payload 持久化 schema。
- `persistentExtensionBinding` 的最小持久化子集已在 FR-0015 `spec.md` / `data-model.md` 中单独冻结；它属于 identity preflight 的持久 binding 边界，而不是 `runtime_bootstrap_envelope` 的输入字段。

## 最小 request / ack 形状

### request

```json
{
  "method": "runtime.bootstrap",
  "params": {
    "version": "v1",
    "run_id": "run-20260327-001",
    "runtime_context_id": "ctx-20260327-001",
    "profile": "xhs_account_001",
    "fingerprint_runtime": {},
    "fingerprint_patch_manifest": {},
    "main_world_secret": "secret-opaque"
  }
}
```

### ack

```json
{
  "method": "runtime.bootstrap.ack",
  "result": {
    "version": "v1",
    "run_id": "run-20260327-001",
    "runtime_context_id": "ctx-20260327-001",
    "profile": "xhs_account_001",
    "status": "ready"
  }
}
```

ack 字段约束：

- `version`：必须与 request 一致
- `run_id`：必须与当前 run 一致
- `runtime_context_id`：必须与当前 context 一致
- `profile`：必须与当前目标 profile 一致
- `status`：当前最小允许 `ready | stale | failed`

## 成功确认

bootstrap 成功至少要求同时满足：

1. 当前扩展实例确认收到与当前 `runtime_context_id` 一致的 envelope。
2. 确认发生在当前活跃 run，而不是历史 run 的陈旧 ack。
3. 运行时将 readiness 从 `bootstrap_pending` 推进到 `bootstrap_ready`。

在此之前：

- 运行时不得放行业务命令
- `runtime.status` 不得把状态折叠为全量 `ready`

## 失败分类

后续实现至少需要区分：

- `ERR_RUNTIME_IDENTITY_NOT_BOUND`
- `ERR_RUNTIME_BOOTSTRAP_NOT_DELIVERED`
- `ERR_RUNTIME_BOOTSTRAP_ACK_TIMEOUT`
- `ERR_RUNTIME_BOOTSTRAP_ACK_STALE`
- `ERR_RUNTIME_BOOTSTRAP_IDENTITY_MISMATCH`
- `ERR_RUNTIME_READY_SIGNAL_CONFLICT`

边界要求：

- link-layer 失败仍归 FR-0002 的 `ERR_TRANSPORT_*`
- 只有 link-layer 已 ready 后的 bootstrap 失败，才进入 `ERR_RUNTIME_*`

## 状态返回与失败 ack

- 当 ack `status=ready` 时，才允许将 `bootstrapState` 推进到 `ready`
- 当 ack `status=stale` 时，必须把 `bootstrapState` 视为 `stale`，并返回 `ERR_RUNTIME_BOOTSTRAP_ACK_STALE`
- 当 ack `status=failed` 时，必须返回对应 `ERR_RUNTIME_BOOTSTRAP_*`
- 当 ack 缺少 `version/run_id/runtime_context_id/profile/status` 任一必填字段时，必须视为 invalid ack，不得当作成功确认

## 幂等与重试

- 相同 `(run_id, runtime_context_id)` 的重复 bootstrap 下发必须具备幂等语义。
- bootstrap ack 超时后允许在同 run 内重试，但不得接受旧 run 的 ack 作为恢复依据。
- 若 identity binding 与当前 profile 不一致，应立即 stop-ship，而不是继续盲重试。

## 与 FR-0002 / FR-0003 的关系

- FR-0002 继续负责：
  - Native Messaging handshake
  - relay
  - heartbeat
  - disconnect
- FR-0003 继续负责：
  - Named Profile
  - profile lock
  - 最小生命周期命令
  - 最小元数据边界
- FR-0015 追加负责：
  - persistent identity preflight
  - runtime bootstrap envelope
  - bootstrap ack / readiness 分层

## 明确不做

- 不在本契约中定稿最终安装器协议。
- 不把 candidate 分发路径写成正式 contract。
- 不在这里引入 `#239` 的验证基线或 live/recon/dry_run 体系。
