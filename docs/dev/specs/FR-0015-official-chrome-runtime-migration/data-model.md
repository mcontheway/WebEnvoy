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
- 回读到非法、损坏或与当前运行态冲突的字段时，运行时必须进入阻断态，不得静默降级为“继续执行”

生命周期：

- 写入：`runtime.start` / `runtime.login` 在 identity preflight 通过后更新该字段
- 回读：`runtime.start` / `runtime.login` / `runtime.status` 在缺省 `persistent_extension_identity` 参数时可回读该字段作为最小 identity 提示输入
- 清理：当前阶段不要求自动垃圾回收；若 identity 解绑、安装资产迁移或人工重置 profile，需要由后续专门流程显式覆盖或移除

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
- 新增字段只用于表达 runtime migration 下的 readiness 分层
- `runtimeReadiness=ready` 仅在 lock / identity / transport / bootstrap 四类信号一致时成立

说明：

- 本视图是衍生读模型
- 不要求在本 FR 中落库
- 不得反向成为新的真相源，去覆盖 FR-0003 的 Profile 生命周期或 FR-0002 的 link-layer 状态事实

## 持久化边界说明

- 最小 persistent identity 子集现已允许进入 `__webenvoy_meta.json.persistentExtensionBinding`
- `RuntimeBootstrapEnvelope` 明确不属于持久化对象
- `RuntimeReadinessStatusView` 明确属于查询视图，不属于持久化实体

## 对后续实现的约束

- 若实现只需要状态聚合，可只落读模型，不得顺手新增不必要的持久化字段
- 若实现继续扩大 persistent identity 持久化范围，必须再次补 formal spec review，而不是以当前最小冻结子集外推
