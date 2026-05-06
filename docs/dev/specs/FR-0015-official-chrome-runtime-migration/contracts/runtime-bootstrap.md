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
  - `stale_bootstrap_rebind` 是 `v1` 的向后兼容扩展：旧 producer/consumer 可继续把缺少 `stale_provenance` 的 `status=stale` 视为 `ERR_RUNTIME_BOOTSTRAP_ACK_STALE` 硬阻断；只有要进入受限 stale recovery 时，`stale_provenance` 才成为该 recovery path 的必需字段。

## 契约目标

1. 把 run/session 级上下文显式送入已安装扩展，而不是再依赖 per-run staged extension 文件。
2. 让 runtime readiness 建立在多信号之上：
  - identity binding ready
  - link-layer ready
  - bootstrap ack ready
3. 为后续实现提供可幂等、可重试、可诊断的 bootstrap 收口面。

## 输入字段

`runtime_bootstrap_envelope` base fields 至少应包含：

- `version`
- `run_id`
- `runtime_context_id`
- `profile`
- `fingerprint_runtime`
- `fingerprint_patch_manifest`
- `main_world_secret`

`stale_bootstrap_rebind` request extension fields：

- `requested_at`
- `target_domain | null`
- `target_tab_id | null`
- `target_page | null`

约束：

- `run_id` 与 `runtime_context_id` 只属于单次 run/session。
- `profile` 必须与当前持久 identity binding 指向同一 profile。
- `requested_at` 必须为当前 bootstrap request 生成的 ISO-8601 timestamp；进入 `stale_bootstrap_rebind` 时必须存在，并作为 freshness proof 的 request-side source。
- `main_world_secret` 只用于当前 run 的信任链，不进入持久元数据。
- `target_domain`、`target_tab_id`、`target_page` 是 `v1` 的向后兼容 optional extension；普通 bootstrap 可为 `null` 或缺省，但进入 `stale_bootstrap_rebind` 时三者必须为非空 machine fields。
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
    "requested_at": "2026-05-06T10:00:00.000Z",
    "fingerprint_runtime": {},
    "fingerprint_patch_manifest": {},
    "main_world_secret": "secret-opaque",
    "target_domain": "www.xiaohongshu.com",
    "target_tab_id": 1230428939,
    "target_page": "https://www.xiaohongshu.com/search_result/?keyword=%E9%9C%B2%E8%90%A5&type=51"
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
    "status": "ready",
    "stale_provenance": null
  }
}
```

ack 字段约束：

- `version`：必须与 request 一致
- `run_id`：表示本次 bootstrap request identity，必须与当前请求的 run 一致
- `runtime_context_id`：表示本次 bootstrap request identity，必须与当前请求的 context 一致
- `profile`：必须与当前目标 profile 一致
- `status`：当前最小允许 `ready | stale | failed`
- `stale_provenance`：可选字段；当 `status=ready | failed` 时必须为 `null` 或缺省；当 `status=stale` 且调用方要形成 `RuntimeTakeoverEvidence(mode=stale_bootstrap_rebind)` 时必须为非空对象
- 当 `status=ready` 时，`run_id/runtime_context_id` 即为可接受的 ready evidence 归属；不得再依赖其他历史 ready marker。
- 当 `status=stale` 时，ack 仍必须响应当前 bootstrap request identity；缺少 `stale_provenance` 时继续按 `ERR_RUNTIME_BOOTSTRAP_ACK_STALE` 硬阻断处理，不能进入 `stale_bootstrap_rebind`。

`stale_provenance` 形状冻结如下：

```json
{
  "kind": "ready_marker",
  "observed_run_id": "run-previous-001",
  "observed_runtime_context_id": "ctx-previous-001",
  "observed_runtime_instance_id": "runtime-instance-001"
}
```

字段约束：

- `kind`：必填，当前只允许 `ready_marker | observed_runtime`
- `observed_run_id`：必填，必须为非空字符串，且不得等于当前 ack 的 `run_id`
- `observed_runtime_context_id`：必填，必须为非空字符串，且不得等于当前 ack 的 `runtime_context_id`
- `observed_runtime_instance_id`：必填，可为非空字符串或 `null`；进入 `stale_bootstrap_rebind` 时必须为非空字符串，并且必须原样 carry-through 为 `RuntimeTakeoverEvidence.observedRuntimeInstanceId`
- 不允许使用其他字段名替代上述字段；producer/consumer 不得用“等价 identity”声明兼容。

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
- 当 ack `status=stale` 时，必须把 `bootstrapState` 视为 `stale`，并返回 `ERR_RUNTIME_BOOTSTRAP_ACK_STALE`；该 ack 的 request identity 必须匹配当前 bootstrap 请求。缺少 `stale_provenance` 的 `v1` stale ack 只能保持硬阻断；存在 `stale_provenance` 时，该对象必须指向非当前 run/context 的旧 ready marker 或 observed runtime。
- 当 stale ack 同时具备 FR-0003 profile/browser continuity、official Chrome transport ready 与同一 managed target continuity 时，只允许进入“attach/rebind replacement run 后重新下发 replacement run bootstrap”的受限恢复路径；不得把 stale provenance 指向的旧 run ready marker 直接接受为 replacement run 的 ready ack。
- 当 ack `status=failed` 时，必须返回对应 `ERR_RUNTIME_BOOTSTRAP_*`
- 当 ack 缺少 `version/run_id/runtime_context_id/profile/status` 任一必填字段时，必须视为 invalid ack，不得当作成功确认；`status=stale` 缺少 `stale_provenance` 时不得进入受限恢复路径，但仍按既有 `ERR_RUNTIME_BOOTSTRAP_ACK_STALE` 处理。

## 幂等与重试

- 相同 `(run_id, runtime_context_id)` 的重复 bootstrap 下发必须具备幂等语义。
- bootstrap ack 超时后允许在同 run 内重试，但不得接受旧 run 的 ack 作为 ready 恢复依据。
- 当前 bootstrap request 返回 `status=stale` 且 stale provenance 指向旧 run/context 时，默认仍必须返回 `ERR_RUNTIME_BOOTSTRAP_ACK_STALE`；唯一例外是调用方已经通过 `RuntimeTakeoverEvidence(mode=stale_bootstrap_rebind)` 与 `postLockTakeoverGate=allow` 完成受限 attach/rebind，然后重新下发 replacement run 的 bootstrap。该例外只允许消费新的 replacement run ack，不允许复用 stale provenance 指向的旧 run ready marker。
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
- 不在这里引入 `FR-0020` 的验证基线或 live/recon/dry_run 体系。
