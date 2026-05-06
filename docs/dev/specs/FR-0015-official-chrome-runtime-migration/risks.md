# FR-0015 风险与回滚

## 风险 1：把持久 identity 与单次 bootstrap 重新耦合

- 触发条件：
  - 实现继续依赖 per-run staged extension 文件
  - `run_id` / `runtime_context_id` 被塞回安装资产或 profile 永久元数据
- 影响：
  - `#279` 冻结边界失效
  - official Chrome 主路径再次退回到临时 staging 依赖
- 缓解：
  - 先做 identity preflight，再做独立 bootstrap contract
  - code review 中把 staged extension 回流视为阻断项
- 回滚：
  - 回退到“identity preflight 失败即阻断、不执行业务命令”的保守状态

## 风险 2：只凭单一 ready 信号误放行业务执行

- 触发条件：
  - 仅因 Native Messaging 已连接就宣称 runtime ready
  - 旧 run 的 ready marker 被当前 run 复用
- 影响：
  - 命令可能在 bootstrap 未完成时进入页面执行
  - stale context 污染当前 run
- 缓解：
  - readiness 必须至少联合 identity、transport、bootstrap 三类信号
  - `runtime.status` 必须通过 formal contract 暴露 readiness 分层，而不是继续只输出单一 `browserState=ready`
  - 信号冲突时进入 `blocked` 或 `unknown`
- 回滚：
  - 降回 bootstrap pending / blocked，不继续执行业务命令

## 风险 3：identity mismatch 被当作可恢复瞬时错误

- 触发条件：
  - `allowed_origins` 与稳定 `extension_id` 不一致
  - profile 指向的安装身份与当前 runtime 目标不一致
- 影响：
  - 运行时可能把错误的扩展实例当成合法目标
  - Native Messaging 安全边界被削弱
- 缓解：
  - identity mismatch 直接 stop-ship
  - 不允许盲重试掩盖该错误
- 回滚：
  - 中止当前 run，回到人工修复 identity binding 的阶段

## 风险 4：范围漂移到安装器产品化或验证体系

- 触发条件：
  - 实现 PR 同时引入安装器产品化、candidate 分发路径或 `FR-0020` 验证框架
- 影响：
  - `#281` 失去 implementation-prep 纯度
  - review 无法判断真正的 runtime migration 是否成立
- 缓解：
  - PR 只允许覆盖 identity preflight、bootstrap contract、runtime readiness 第一刀
  - 安装器产品化与 `FR-0020` 验证体系分开建后续事项
- 回滚：
  - 拆 PR，保留 runtime migration 主链，移出扩 scope 内容

## 风险 5：状态型 runtime 恢复语义不明确

- 触发条件：
  - bootstrap timeout、disconnect、stale ack、重复 start/stop 没有幂等规则
- 影响：
  - 运行时可能形成假活性、孤儿状态或重复初始化
- 缓解：
  - 明确同 run 重试与 stale ack 的拒绝规则
  - `runtime.status` 输出 readiness 分层，而不是单一 ready
  - 独占锁必须进入 readiness 门禁，不允许失锁后继续维持 ready
- 回滚：
  - 回到阻断态，要求显式 stop/start 或人工恢复，而不是自动乐观续跑

## 风险 6：stale-bootstrap rebind 被误当作通用恢复

- 触发条件：
  - `status=stale` 缺少 `runtime.bootstrap.ack.result.stale_provenance`，仍被提升为可恢复
  - `stale_provenance.observed_runtime_instance_id` 未原样 carry-through 到 `RuntimeTakeoverEvidence.observedRuntimeInstanceId`
  - `RuntimeTakeoverEvidence.requestRunId` / `requestRuntimeContextId` 未绑定当前 replacement run，导致 stale evidence 可跨 run 重放
  - `postLockTakeoverGate` 只校验 runtime instance，不复验 `managedTargetTabId`、`managedTargetDomain`、`managedTargetPage` 与 `targetTabContinuity`
  - account safety、rhythm、anti-detection validation / admission gates 任一未通过时仍尝试 attach/rebind
- 影响：
  - stale context 可能跨 tab、跨 page 或跨 runtime instance 被误用
  - 旧 run 的 ready marker 可能被当前 replacement run 当作 ready evidence
  - official Chrome managed profile 可能在未满足安全门禁时执行页面动作
- 缓解：
  - `stale_bootstrap_rebind` 只作为 `v1` 向后兼容 optional extension；缺少 `stale_provenance` 的 stale ack 继续保持 `ERR_RUNTIME_BOOTSTRAP_ACK_STALE` 硬阻断
  - 只有 `stale_provenance` 字段完整、`observed_runtime_instance_id` 非空并原样写入 `RuntimeTakeoverEvidence.observedRuntimeInstanceId` 时，才允许形成 `staleBootstrapRecoverable=true`
  - `RuntimeTakeoverEvidence.requestRunId` 与 `requestRuntimeContextId` 必须等于当前 replacement run 的 `(run_id, runtime_context_id)`，并由 `postLockTakeoverGate` 复验
  - `postLockTakeoverGate` 必须同时复验 observed runtime instance 与冻结 target 三元组：`managedTargetTabId`、`managedTargetDomain`、`managedTargetPage`，并确认 `targetTabContinuity=runtime_trust_state`
  - 既有 account safety、rhythm、anti-detection validation / admission gates 仍是前置条件，不能被 stale recovery 绕过
- deny 条件：
  - `stale_provenance` 缺失、字段名不匹配、`observed_run_id` / `observed_runtime_context_id` 为空或等于当前请求 identity
  - `observed_runtime_instance_id` 为 `null`、为空字符串，或 post-lock observed runtime instance 不匹配
  - `requestRunId` / `requestRuntimeContextId` 缺失，或与当前 replacement run 的 `(run_id, runtime_context_id)` 不一致
  - `managedTargetTabId`、`managedTargetDomain`、`managedTargetPage` 任一缺失或与 post-lock observed target 不一致
  - `targetTabContinuity` 不是 `runtime_trust_state`
  - FR-0003 profile 独占锁未由当前调用方重新持有，或出现 owner conflict / controller conflict
- 回滚：
  - 不执行 attach/rebind，不下发 replacement run bootstrap
  - 保持 `bootstrapState=stale`、`runtimeReadiness=blocked`，返回 `ERR_RUNTIME_BOOTSTRAP_ACK_STALE`
  - 需要人工 stop/start、重新绑定 target，或后续实现提供的显式恢复入口；不得自动进入业务命令阶段

## 最小健康矩阵

### healthy

- identity binding 正确
- transport ready
- current run bootstrap ack ready

### blocked

- 锁被抢占或锁归属不可确认
- identity mismatch
- bootstrap ack stale
- stale bootstrap provenance、observed runtime instance 或 target continuity 任一无法复验
- stop-ship 范围漂移

### recoverable

- transport 暂时断开
- bootstrap ack timeout，但 identity binding 仍正确且当前 run 未变
- 控制进程死 / 浏览器活，但 lock 与当前 run 归属仍可重新确认

### unknown

- transport ready 但 bootstrap 信号与 identity 信号冲突
- ready marker 与当前 run 无法确定对应关系

## 最小恢复路径

- 控制进程死 / 浏览器活：
  - 不得直接复用旧 ready
  - 必须重新验证 lock、transport 与 bootstrap ack 归属
- 锁仍持有但控制链断开：
  - 先判 `recoverable` 或 `blocked`
  - 明确 stop/start 或人工恢复入口
- 失锁或锁被抢占：
  - 退出 `ready`
  - 只能进入 `blocked` 或 `recoverable`
- ready marker 陈旧：
  - 直接进入 `blocked`
  - 只有通过 `stale_bootstrap_rebind` 的 provenance、runtime instance、target continuity 与 post-lock gate 复验后，才允许 replacement run 重新 bootstrap
  - 未满足受限恢复条件时，不得 attach/rebind，不得下发 replacement run bootstrap，只能保持 `ERR_RUNTIME_BOOTSTRAP_ACK_STALE` 阻断并进入显式 stop/start 或人工恢复入口
- 并发争抢同一 profile：
  - 继续服从 FR-0003 独占锁
  - 不允许第二个竞争者通过 bootstrap 绕过锁

## stop-ship 条件

- 任何实现仍依赖 staged extension 承载正式 bootstrap
- `allowed_origins` 不能稳定绑定正式 `extension_id`
- runtime readiness 仍然缺少多信号收敛
- stale-bootstrap recovery 缺少 provenance、observed runtime instance 或 target continuity 的 post-lock 复验
- PR 把安装器产品化或 `FR-0020` 验证体系混入 runtime migration 第一刀
