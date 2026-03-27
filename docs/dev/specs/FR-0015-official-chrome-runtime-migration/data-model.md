# FR-0015 数据模型

## 建模范围

本 FR 不直接新增运行时代码或 SQLite schema，但需要冻结 `#281` 实现会共享的数据边界，避免后续实现阶段自行发明 readiness/status 口径。

本 FR 的数据模型只覆盖：

- persistent identity 事实
- run/session bootstrap 输入
- `runtime.status` 的 readiness 读模型

本 FR 不在当前阶段定稿：

- 最终安装器持久化结构
- candidate 分发路径的配置仓库
- `#239` 的验证样本、baseline 或回归仓库

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

- 本实体当前用于 formal contract 建模，不要求在本 FR 中直接指定最终持久化落点
- 若后续实现需要把该事实持久化进 `__webenvoy_meta.json` 或其他存储，必须另行经过实现级 spec review

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
- 新增字段只用于表达 runtime migration 下的 readiness 分层
- `runtimeReadiness=ready` 仅在 lock / identity / transport / bootstrap 四类信号一致时成立

说明：

- 本视图是衍生读模型
- 不要求在本 FR 中落库
- 不得反向成为新的真相源，去覆盖 FR-0003 的 Profile 生命周期或 FR-0002 的 link-layer 状态事实

## 持久化边界说明

- 持久 identity 事实是否进入 `__webenvoy_meta.json`，当前仍未在本 FR 中定稿
- `RuntimeBootstrapEnvelope` 明确不属于持久化对象
- `RuntimeReadinessStatusView` 明确属于查询视图，不属于持久化实体

## 对后续实现的约束

- 若实现只需要状态聚合，可只落读模型，不得顺手新增不必要的持久化字段
- 若实现需要为 persistent identity 事实新增持久化字段，必须在实现 PR 前补充字段命名、生命周期与回滚方式
