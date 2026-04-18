# FR-0015 数据模型

## 建模范围

本 FR 不直接新增运行时代码或 SQLite schema，但需要冻结 `#281` 实现会共享的数据边界，避免后续实现阶段自行发明 readiness/status 口径。

本 FR 的数据模型只覆盖：

- persistent identity 事实
- run/session bootstrap 输入
- `runtime.status` 的 readiness 读模型
- 锁切换前冻结的 transient takeover evidence

本 FR 不在当前阶段定稿：

- 最终安装器持久化结构
- candidate 分发路径的配置仓库
- `FR-0020` 的验证样本、baseline 或回归仓库

## 实体 1：PersistentIdentityBinding

PersistentIdentityBinding 表示 official Chrome persistent extension 主路径下，profile 与扩展安装身份之间的正式绑定事实。

关键字段：

- `profile`
- `extensionId`
- `nativeHostName`
- `allowedOrigins`
- `bindingState`

约束：

- `extensionId` 必须稳定，不得来自 per-run staged extension 的临时 identity
- `allowedOrigins` 必须显式包含该稳定 `extensionId` 对应 origin
- `bindingState` 至少允许：
  - `missing`
  - `bound`
  - `mismatch`

生命周期：

- `missing`：尚未完成正式 identity binding
- `bound`：identity 边界一致，可进入运行阶段
- `mismatch`：identity 边界冲突，属于阻断态

说明：

- 本实体当前允许最小持久化落点进入 `__webenvoy_meta.json.persistentExtensionBinding`
- 该最小持久化子集只允许承载：
  - `extensionId`
  - `nativeHostName`
  - `browserChannel`
  - `manifestPath`
- `allowedOrigins` 与 `bindingState` 继续属于运行时推导事实，不作为持久真相源写入 `__webenvoy_meta.json`
- 当前 FR 只冻结最小字段、生命周期与回滚边界，不定稿最终安装器或更广泛的安装资产仓库

### `__webenvoy_meta.json.persistentExtensionBinding`

字段：

- `extensionId`
- `nativeHostName`
- `browserChannel`
- `manifestPath | null`

约束：

- 只允许在 identity preflight 已完成字段级校验后写入
- `extensionId` 必须符合稳定 Chrome extension id 约束
- `nativeHostName` 必须符合 Chrome Native Messaging host 命名规则
- `browserChannel` 只允许当前 formal 套件承认的浏览器通道枚举
- `manifestPath` 仅作为上次成功绑定时的定位提示；运行时仍需按正式 identity 规则重新校验 manifest / origin / profile 安装事实
- `manifestPath` 写入前必须归一化为绝对路径；相对路径不得以原样持久化
- `manifestPath` 只允许指向当前 `browserChannel + nativeHostName` 组合对应的 Native Messaging manifest 候选位置；路径本身不是新的真相源
- 回读时若 `manifestPath` 缺失、不可读、不是可解析的 manifest JSON、`name` 与 `nativeHostName` 不一致，或 `allowed_origins` 不能证明当前稳定 `extensionId` 对应 origin，运行时必须进入阻断态
- 回读实现不得仅凭 `manifestPath` 存在、平台默认目录命中或路径跳转结果就判定 identity 已通过；符号链接、重定位或平台差异只可作为重新校验的定位线索，不得绕过 manifest 内容校验
- 回读到非法、损坏或与当前运行态冲突的字段时，运行时必须进入阻断态，不得静默降级为“继续执行”

生命周期：

- 写入：`runtime.start` / `runtime.login` 在 identity preflight 通过后更新该字段
- 回读：`runtime.start` / `runtime.login` / `runtime.status` 在未显式提供 identity 绑定输入时可回读该字段作为最小 identity 提示输入
- 清理：当前阶段不要求自动垃圾回收；若 identity 解绑、安装资产迁移或人工重置 profile，需要由后续专门流程显式覆盖或移除

兼容策略：

- 本 FR 当前只冻结“identity 输入缺省时允许回读最小持久 binding”的行为，不冻结新的正式命令参数名
- 若后续实现需要把显式 identity 输入升级为正式 machine contract，必须在对应命令/contract 文档中单独冻结输入形状、可选性与兼容策略

回滚边界：

- 该字段为可选、加性元数据，不引入 schema migration
- 回滚实现时，旧版本必须把该字段视为可忽略的额外字段，或由人工删除该字段恢复到无持久 binding 状态
- 不允许把 `persistentExtensionBinding` 扩写为 bootstrap、readiness 或安装器产品化状态仓库

## 实体 2：RuntimeBootstrapEnvelope

RuntimeBootstrapEnvelope 对应当前 run/session 的临时输入。

关键字段：

- `runId`
- `runtimeContextId`
- `profile`
- `fingerprintRuntime`
- `fingerprintPatchManifest`
- `mainWorldSecret`

约束：

- 仅属于单次 run/session
- 不得作为 profile 永久元数据保存
- 不得通过 staged extension 文件承载

生命周期：

- `created`
- `delivered`
- `acknowledged`
- `stale`
- `failed`

## 实体 3：RuntimeReadinessStatusView

RuntimeReadinessStatusView 是 `runtime.status` 的衍生读模型，不是新的持久真相源。

关键字段：

- `profileState`
- `browserState`
- `lockHeld`
- `identityBindingState`
- `transportState`
- `bootstrapState`
- `runtimeReadiness`

约束：

- `profileState` 与 `browserState` 继续沿用 FR-0003 的原语义
- 新增字段只用于表达 runtime migration 下的单实例 readiness 分层
- `runtimeReadiness=ready` 仅在 lock / identity / transport / bootstrap 四类信号一致时成立
- `runtime.status` 顶层只允许承载上述单实例状态视图；pre-lock handoff facts 不得继续作为顶层字段混入

说明：

- 本视图是衍生读模型
- 不要求在本 FR 中落库
- 不得反向成为新的真相源，去覆盖 FR-0003 的 Profile 生命周期或 FR-0002 的 link-layer 状态事实

## 实体 4：RuntimeTakeoverEvidence

RuntimeTakeoverEvidence 表示锁切换前冻结下来的 transient handoff evidence，供 attach/rebind 动作面在 post-lock 阶段消费。

关键字段：

- `mode`
- `freshness`
- `identityBound`
- `ownerConflictFree`
- `controllerBrowserContinuity`
- `transportBootstrapViable`
- `observedRunId`
- `runtimeContextId | null`

约束：

- `mode` 至少允许：
  - `ready_attach`
  - `recoverable_rebind`
- 该对象只允许由 pre-lock handoff facts 冻结生成，不得反向要求 relock 后的 `runtime.status` 继续维持原布尔值
- 该对象是 transient / non-persistent / non-profile-metadata
- 该对象必须绑定到具体 observed runtime instance，而不是只表达抽象“可接管”结论
- attach/rebind 动作面只能在当前调用方已重新持有 FR-0003 profile 独占锁之后消费它
- `postLockTakeoverGate` 必须继续校验 evidence 仍对应同一个 observed runtime instance
- `attachableReadyRuntime=true` 只表示“对一个新的 `run_id` 来说，当前 ready runtime 已形成可冻结的 pre-lock handoff fact”
- `attachableReadyRuntime` 不得替代 `runtimeReadiness` 作为业务命令最终门禁
- `attachableReadyRuntime` 必须要求 status 聚合器已独立验证现存 runtime 处于 ready；`pending`、`not_started`、`ERR_RUNTIME_BOOTSTRAP_NOT_DELIVERED`、`ERR_RUNTIME_BOOTSTRAP_ACK_TIMEOUT` 与 attested failed 都不能被提升为 attachable
- `attachableReadyRuntime` 必须把 identity/context conflict attestation 继续视为阻断态，不能仅凭 `bootstrapState=failed + transportState=ready` 就一律放行
- `attachableReadyRuntime` 不得要求调用方通过当前 top-level `bootstrapState` / `transportState` 去反向推断另一条 runtime 实例的状态；既有 top-level 字段继续绑定单一 status 视图
- `attachableReadyRuntime` 必须继续排除“另一条 controller 仍有效持有该 profile 独占控制”的真实 owner 冲突
- `attachableReadyRuntime` 只表达 pre-lock handoff 事实本身；不得单独授权 attach/rebind
- `orphanRecoverable=true` 只表示“对一个新的 `run_id` 来说，当前 recoverable runtime 已形成可冻结的 pre-lock handoff fact”
- `orphanRecoverable` 只能在 `runtimeReadiness=recoverable` 的场景下生效，不得外推到 ready-runtime attach 或业务命令放行
- `orphanRecoverable` 必须继续要求 `identityBindingState=bound`，identity 缺失或冲突时不得把 recoverable runtime 提升为可 rebind
- `orphanRecoverable` 必须要求旧 owner 已失去有效独占控制；锁文件残留、单一 pid 存活或单一心跳信号都不足以单独证明可安全接管
- `orphanRecoverable` 必须继续要求没有其他 controller 已经重新取得该 profile 的有效独占控制；真实并发 owner 冲突必须保持 blocked
- `orphanRecoverable` 必须把 browser/controller 所有权连续性与 transport/bootstrap 可恢复性同时纳入判定，不能只靠单一进程存活信号抬高
- `orphanRecoverable` 同样不得迫使调用方重解释 top-level `lockHeld` / `runtimeReadiness` / `bootstrapState` 的语义归属
- `orphanRecoverable` 只适用于尚未有 controller 重新取得有效独占控制的 pre-lock handoff 视图；一旦 replacement controller 或其他 controller 重新持有有效独占锁，新的 pre-lock evidence 中该字段必须回落为 `false`
- `orphanRecoverable` 同样只表达 pre-lock handoff 事实本身；不得单独授权 attach/rebind

生命周期：

- `observed`
- `frozen_pre_lock`
- `consumed_post_lock`
- `expired`

说明：

- `RuntimeTakeoverEvidence` 不是新的共享持久实体，不进入 `__webenvoy_meta.json`
- 它只服务于 post-lock attach/rebind 的动作授权，不替代 `runtimeReadiness` 作为业务命令门禁
- `postLockTakeoverGate` 只允许基于该 evidence 或等价内部 attach 状态做 `allow/deny`

## 持久化边界说明

- 最小 persistent identity 子集现已允许进入 `__webenvoy_meta.json.persistentExtensionBinding`
- `RuntimeBootstrapEnvelope` 明确不属于持久化对象
- `RuntimeReadinessStatusView` 明确属于查询视图，不属于持久化实体
- `RuntimeTakeoverEvidence` 明确属于 transient evidence，不属于持久化实体

## 对后续实现的约束

- 若实现只需要状态聚合，可只落读模型，不得顺手新增不必要的持久化字段
- 若实现继续扩大 persistent identity 持久化范围，必须再次补 formal spec review，而不是以当前最小冻结子集外推
