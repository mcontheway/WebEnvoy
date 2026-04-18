# FR-0015 official Chrome 持久扩展运行时迁移 implementation-prep

## 背景

`#280` 已完成 evidence spike，`#279` 已通过 PR `#283` 把 official branded Google Chrome 137+ 的正式运行时边界冻结到 roadmap / architecture：

- stealth 主路径不再建立在 `--load-extension` 的 per-run staged extension 上
- branded Chrome 主链改为 `profile` 内持久安装扩展 + `runtime_bootstrap_envelope` 解耦
- `stable extension_id + Native Messaging allowed_origins + profile` 是持久 identity 边界
- Chromium / Chrome for Testing 只保留为开发、调试和验证 fallback

当前缺口不再是“方向是否成立”，而是 `#281` 进入实现前仍缺少可执行的正式迁移输入：

- `runtime_bootstrap_envelope` 还没有正式 transport contract
- FR-0002 只冻结了 link-layer handshake / relay / heartbeat，并未承接 runtime bootstrap
- FR-0003 只冻结了 Named Profile 与最小会话边界，并未冻结 extension identity binding / bootstrap readiness 的状态语义

因此本 FR 的任务不是直接实现迁移，而是把 `#279` 已冻结的上位边界转成 FR-0015 后续实现可直接消费的 implementation-prep 输入。

在 formal 文档之外，当前 GitHub 对应关系以 FR-0015 canonical issue 页面为准。已关闭的 `#281` 与 `#361` 只保留为历史实现链路参考，不再承担当前主树父子关系、关闭语义或 formal 契约真相源；scope、stop-ship、验证入口仍只以正式 FR 套件为准。

## 目标

1. 冻结 FR-0015 runtime migration implementation-prep 第一阶段的范围、主输入与非目标。
2. 冻结 `runtime_bootstrap_envelope` 的正式职责、注入阶段、确认时机与失败分类。
3. 冻结 `stable extension_id + allowed_origins + profile identity` 与 run/session bootstrap 的阶段边界。
4. 冻结后续实现 PR 应首先承接的 runtime 状态语义、共享契约与推荐切片。
5. 明确本 FR 对 FR-0002、FR-0003 的继承关系，避免实现阶段反向改写已冻结 Phase 1 契约。

## 非目标

- 不直接交付 `#281` 的完整运行时代码。
- 不定稿最终安装器设计、首次安装引导、最终分发方案或 Chrome Web Store / 合规上架路径。
- 不把 `developer mode / unpacked`、External Extensions JSON、Windows 外部安装/注册表等 candidate 路径升级为当前正式主方案。
- 不把 Chromium / Chrome for Testing 回写成 stealth 主运行时。
- 不重写 FR-0002 的连接级 handshake，把 runtime bootstrap 混成 link-layer 字段。
- 不把 FR-0003 扩张为完整账号系统、安装资产仓库或长期运营模型。
- 不承接 `FR-0020` 的验证体系、baseline 评估、live / recon / dry_run 分层或回归框架。

## 功能需求

### 1. implementation-prep 范围冻结

- 本 FR 必须明确其当前职责是 runtime migration 的 implementation-prep / 设计收口，不是完整实现闭环。
- 本 FR 必须把 `#279` 已冻结的上位边界转换成后续实现可直接消费的正式输入。
- 本 FR 必须为后续实现 PR 指定推荐的第一刀切片、共享契约与状态边界。
- 本 FR 必须明确父级 Phase 为 Phase 1.x，当前 canonical FR issue 页面承接 FR-0015，后续验证归属 `FR-0020`；历史 `#281/#361` 只作为追溯参考，当前 PR 不以它们承担结构真相。

### 2. persistent identity 与 runtime bootstrap 分层

- 系统必须显式区分“持久 identity 边界”和“单次运行 bootstrap 边界”。
- 持久 identity 边界至少包括：
  - `profile`
  - 稳定 `extension_id`
  - Native Messaging host manifest 的 `allowed_origins`
  - profile 内已安装扩展这一事实
- 单次运行 bootstrap 边界至少包括：
  - `run_id`
  - `runtime_context_id`
  - `profile`
  - `fingerprint_runtime`
  - `fingerprint_patch_manifest`
  - `main_world_secret`
- 单次运行 bootstrap 输入不得通过 per-run staged extension 文件承载。
- 单次运行 bootstrap 输入不得写入 profile 永久元数据当作安装身份事实。
- 为支撑 identity preflight 的缺省回读路径，系统可以在 `__webenvoy_meta.json` 中持久化最小 `persistentExtensionBinding` 子集，但该子集只允许承载：
  - `extensionId`
  - `nativeHostName`
  - `browserChannel`
  - `manifestPath`
- `allowedOrigins`、`bindingState` 与 bootstrap 相关事实仍必须在运行时基于 manifest / profile / 当前 run 信号推导，不得被持久化成新的真相源。
- `persistentExtensionBinding` 只允许在 identity preflight 已通过且字段校验完成后写入，并且在后续 `runtime.start` / `runtime.login` / `runtime.status` 未显式提供 identity 绑定输入时，仅作为“已冻结的 identity 提示输入”回读使用。
- 本 FR 当前只冻结“缺省 identity 输入时允许回读最小持久 binding”这一行为，不冻结新的正式命令参数名、输入 payload 形状或 CLI 兼容层命名；如后续实现需要把显式 identity 输入升级为正式 machine contract，必须在对应 formal contract 中单独冻结。

### 3. runtime bootstrap transport contract

- 系统必须定义独立于 FR-0002 link-layer handshake 的 `runtime_bootstrap_envelope` transport contract。
- link-layer handshake 仍只负责连接建立、最小转发、心跳和断连。
- `runtime_bootstrap_envelope` 必须在连接建立后、业务命令进入前完成下发与确认。
- 在 bootstrap 未确认前，运行时不得假装已经进入可执行状态。
- bootstrap contract 至少必须定义：
  - 生产者 / 消费者
  - 输入字段
  - 幂等与重发语义
  - 成功确认信号
  - 失败分类
  - 与后续命令执行的门禁关系

### 4. runtime 状态语义

- 系统必须为后续实现冻结最小 runtime readiness 状态，而不是只保留“Native Messaging 已连上”这一单信号。
- 至少需要区分以下事实：
  - profile 是否已具备持久 identity binding
  - 当前 CLI 是否仍持有该 profile 的独占锁
  - Native Messaging 链路是否 ready
  - 本次 `runtime_bootstrap_envelope` 是否已被当前扩展实例确认
  - 当前 readiness 是否属于可恢复失败、阻断失败或未知状态
- `runtime.status` 后续承接时，必须能表达这些 runtime readiness 事实，而不是把它们折叠成单一 `ready`。
- `runtime.status` 的 readiness 增量必须通过独立 formal contract 冻结，并明确与 FR-0003 `profileState/browserState` 的兼容关系。
- readiness 视图如需引入新的共享对象或持久化事实，必须在正式 `data-model.md` 中写清“哪些是衍生视图，哪些是持久实体”。
- FR-0015 必须把 official Chrome runtime attachability 拆成三层机器可读语义：
  - 单实例 `runtime.status` 状态视图
  - 锁切换前的 pre-lock handoff facts
  - 调用方重新持有 FR-0003 profile 独占锁之后才消费的 post-lock action gate
- `runtime.status` 顶层只允许承载单实例状态视图；`attachableReadyRuntime` / `orphanRecoverable` 不得继续作为顶层字段暴露。
- 锁切换前的 pre-lock handoff facts 必须通过 formal-only、transient、non-persistent 的 `RuntimeTakeoverEvidence` 承载。
- `RuntimeTakeoverEvidence.attachableReadyRuntime=true` 只允许表示“现存 runtime 已被 status 聚合器独立验证为 ready，且在锁切换前已形成可供后续接管消费的 ready-runtime handoff fact”；不得把 attested failed 或其他 recoverable handoff 语义混入该字段。
- `RuntimeTakeoverEvidence.attachableReadyRuntime=true` 还必须排除“另一条 controller 仍有效持有该 profile 独占控制”的真实 owner 冲突。
- `RuntimeTakeoverEvidence.orphanRecoverable=true` 只允许表示“现存 runtime 处于 recoverable handoff 场景，且在锁切换前已形成可供后续接管消费的 recoverable handoff fact”；不得替代 ready-runtime attach 或业务命令放行门禁。
- 上述 pre-lock handoff facts 都是 additive 派生事实；不得借它们重解释 `lockHeld`、`transportState`、`bootstrapState`、`runtimeReadiness` 的既有单实例语义。
- FR-0015 必须新增 formal-only 的 `RuntimeTakeoverEvidence` 概念，用于表示锁切换前冻结下来的 handoff 证据；它至少需要区分 `ready_attach` 与 `recoverable_rebind` 两类模式，并包含 freshness、identity bound、owner conflict free、controller/browser continuity、transport/bootstrap viability，以及能绑定到具体 observed runtime instance 的 attach-target identity（例如 `observedRunId`、`runtimeContextId` 或等价标识）这些最小判定事实。
- FR-0015 必须新增 formal-only 的 `postLockTakeoverGate` 概念；它不是新的 `runtime.status` 顶层布尔字段，而是 attach/rebind 动作面在“调用方已重新持有 FR-0003 profile 独占锁之后”消费的 gate。
- 上述 pre-lock handoff facts 都不能单独授权接管动作；真正执行 attach/rebind 时，当前调用方必须先持有 FR-0003 profile 独占锁，并消费锁切换前已成立的 `RuntimeTakeoverEvidence` 通过 `postLockTakeoverGate`。
- `RuntimeTakeoverEvidence.orphanRecoverable=true` 只适用于尚未有 controller 重新取得有效独占控制的 pre-lock handoff 视图；一旦 replacement controller 或其他 controller 重新持有有效独占锁，新的 pre-lock evidence 中该字段必须回落为 `false`。

### 5. 迁移实施切片

- 后续实现第一刀必须优先承接：
  - persistent extension 主路径的 identity preflight
  - runtime bootstrap contract 与 ack
  - runtime readiness 状态收口
- 后续实现第一刀不得同时混入：
  - 最终安装器产品化
  - candidate 分发路径产品化
  - `FR-0020` 的验证框架
  - 其他与 runtime migration 无关的 feature scope

## GWT 验收场景

### 场景 1：持久 identity 已存在时，运行时在 bootstrap 前不会误报 ready

Given 一个 profile 已具备稳定 `extension_id` 与 Native Messaging `allowed_origins` 绑定
And Native Messaging 链路已建立
When 本次 run 还未完成 `runtime_bootstrap_envelope` 下发与确认
Then 运行时不得宣称业务命令已可执行
And readiness 必须明确区分“identity ready”与“bootstrap pending”

### 场景 2：bootstrap 只属于单次运行上下文

Given 一个已安装 WebEnvoy 扩展的 profile
When 系统为本次 run 构建 `runtime_bootstrap_envelope`
Then 该 envelope 只包含 run/session 级输入
And 不得被写回为 profile 永久身份元数据
And 不得通过 per-run staged extension 文件承载

### 场景 2A：最小 persistent identity 绑定可以作为 profile 元数据持久化

Given 一个 profile 已完成 official Chrome persistent extension identity preflight
When 运行时需要为后续缺省参数路径保留最小 identity 绑定事实
Then `__webenvoy_meta.json` 只允许持久化 `persistentExtensionBinding.extensionId/nativeHostName/browserChannel/manifestPath`
And `allowedOrigins`、`bindingState` 与 bootstrap 事实不得被持久化为新的真相源
And 回读到非法或陈旧字段时，运行时必须阻断执行，而不是静默接受
And 是否存在显式 identity 输入参数不影响上述回读语义；本 FR 不以未冻结参数名作为前提

### 场景 3：FR-0002 link-layer 与 runtime bootstrap 保持分层

Given Native Messaging link-layer handshake 已成功
When 运行时准备进入业务执行前阶段
Then 系统必须通过独立 bootstrap contract 下发 run/session 上下文
And 不得把 `run_id` 或等价 bootstrap 字段塞回 FR-0002 握手字段
And link-layer handshake 失败与 bootstrap 失败必须可区分

### 场景 3A：只有已验证 ready 的旧 runtime 才能形成 `attachableReadyRuntime=true` 的 pre-lock handoff fact

Given 一个新的 `run_id` 正在查询现存 official Chrome runtime
And 当前调用方自己尚未持有该 profile 的独占锁
When `runtime.status` 评估 ready-runtime handoff 条件
Then `runtime.status` 顶层仍只允许返回单实例状态视图
And 只有在 status 聚合器已明确证明现存 runtime 处于 ready 时，才允许 `RuntimeTakeoverEvidence.attachableReadyRuntime=true`
And `pending` / `not_started` / `ERR_RUNTIME_BOOTSTRAP_NOT_DELIVERED` / `ERR_RUNTIME_BOOTSTRAP_ACK_TIMEOUT` / attested failed 都不得被提升为 `RuntimeTakeoverEvidence.attachableReadyRuntime=true`
And 调用方不得被要求通过当前 top-level `bootstrapState` / `transportState` 去反向推断另一条 runtime 实例
And 若另一条 controller 仍被证明有效持有该 profile 的独占控制，则 `RuntimeTakeoverEvidence.attachableReadyRuntime` 必须保持 `false`
And `RuntimeTakeoverEvidence.attachableReadyRuntime=true` 只表示 ready-runtime handoff fact 已成立，而不是 post-lock attach/rebind 已被授权
And 当前调用方在真正执行 attach/rebind 前仍必须先持有 FR-0003 profile 独占锁，并基于锁切换前冻结的 `RuntimeTakeoverEvidence` 通过 `postLockTakeoverGate`

### 场景 3B：recoverable handoff 必须通过 `orphanRecoverable` 单独表达为 pre-lock handoff fact

Given 一个新的 `run_id` 正在查询现存 official Chrome runtime
And 当前 runtime 不处于 ready attach，而是 owner/rebind 级的 recoverable handoff 场景
When `runtime.status` 评估 recoverable takeover 条件
Then `runtime.status` 顶层仍只允许返回单实例状态视图
And 只有在 `runtimeReadiness=recoverable`、`identityBindingState=bound`、旧 owner 已失去有效独占控制、没有其他 controller 已重新取得有效独占控制且 browser/controller 连续性仍成立时，才允许 `RuntimeTakeoverEvidence.orphanRecoverable=true`
And `RuntimeTakeoverEvidence.orphanRecoverable=true` 不得被解释为业务命令已可直接执行
And replacement `run_id` 在真正执行 attach/rebind 前仍必须先持有 FR-0003 profile 独占锁，并基于锁切换前冻结的 `RuntimeTakeoverEvidence` 通过 `postLockTakeoverGate`
And replacement controller 重新取得 FR-0003 独占锁后，新的 pre-lock evidence 不得继续暴露 `orphanRecoverable=true`

### 场景 3C：post-lock attach/rebind 只能消费锁切换前冻结的 evidence

Given 一个新的 `run_id` 已在锁切换前观察到 `RuntimeTakeoverEvidence.attachableReadyRuntime=true` 或 `RuntimeTakeoverEvidence.orphanRecoverable=true`
And 该 `run_id` 随后重新取得了 FR-0003 profile 独占锁
When attach/rebind 动作面评估是否允许继续接管
Then 它必须消费锁切换前冻结的 `RuntimeTakeoverEvidence` 通过 `postLockTakeoverGate`
And `postLockTakeoverGate` 不得作为新的 `runtime.status` 顶层字段暴露
And `postLockTakeoverGate` 必须校验该 evidence 仍绑定到同一个被观察到的 runtime 实例，而不是任意可附着目标
And 调用方不得要求 relock 后新的 pre-lock evidence 继续返回 `RuntimeTakeoverEvidence.orphanRecoverable=true` 作为执行前提

### 场景 4：candidate 安装路径不会被误写成正式主方案

Given implementation-prep 文档正在定义 official Chrome 主路径
When 文档提到 `developer mode / unpacked`、External Extensions JSON、Windows 外部安装/注册表或 Chrome Web Store
Then 它们只能被标记为 candidate / transition path 或后续产品化方向
And 不得替代当前正式 runtime / identity / bootstrap 边界

### 场景 5：FR-0020 的验证体系不混入 FR-0015 的 implementation-prep

Given FR-0015 的 formal spec 正在冻结 runtime migration 输入
When 文档定义后续测试与验证范围
Then 只允许描述实现 PR 最小验证矩阵
And 不得把 live / recon / dry_run 分层、baseline 框架或回归平台归入本 FR 的职责

## 异常与边界场景

### 1. identity 边界

- profile 存在但稳定 `extension_id` 未绑定时，必须视为 identity 未就绪，而不是假定后续启动会自动修复。
- Native Messaging manifest 存在但 `allowed_origins` 与稳定 `extension_id` 不一致时，必须视为阻断性 identity failure。
- 本 FR 不定义首次安装流程如何建立 identity binding，只定义建立完成后的正式运行时边界。
- 若实现选择把最小 identity 绑定子集持久化进 `__webenvoy_meta.json`，字段合法性必须先经过 formal 冻结，且非法值必须在回读时视为阻断态而不是自动修复。
- 若实现允许显式传入 identity 绑定输入，本 FR 只要求其缺省行为与持久 binding 回读保持兼容；未在 formal contract 中冻结前，不得把任何临时参数名宣称为正式稳定契约。

### 2. bootstrap 边界

- bootstrap ack 不得沿用旧 run 的陈旧 ready marker。
- bootstrap 未确认时，任何需要页面执行上下文的命令都必须被阻止。
- 同一个 `runtime_context_id` 的重复下发必须具备幂等语义，不能制造双重初始化。

### 3. 状态边界

- Native Messaging ready 但 bootstrap 未确认时，状态必须进入“可观察但不可执行”的分层，而不是伪装成全量 ready。
- identity binding 缺失但 Native Messaging 仍可连通时，系统不得仅凭链路活性放行业务执行。
- 独占锁失效、被抢占或锁归属无法确认时，系统不得继续维持 `ready`。
- `RuntimeTakeoverEvidence` 只能表达 pre-lock handoff facts；relock 后不得把旧 evidence 伪装成当前 `runtime.status` 顶层状态。
- `postLockTakeoverGate` 只能在 attach/rebind 动作面、且调用方重新持有 FR-0003 profile 独占锁后计算；不得把它回写成 `runtime.status` 顶层字段。
- 多信号冲突时，运行时必须允许进入 `unknown` / `blocked` 一类保守状态，而不是择一乐观放行。

### 4. 范围边界

- 实现切片不得借 implementation-prep 之名引入最终安装器、CWS 合规、分发产品化或验证框架。
- 本 FR 不得回改 `#279` 冻结的主路径方向，只承接其实现输入。

## 验收标准

1. `#281` 的 implementation-prep 范围与非目标已正式冻结。
2. `runtime_bootstrap_envelope` 的 transport contract 已形成正式输入，不再停留在上位架构口径。
3. `runtime.status` / readiness 的共享契约与数据边界已形成正式输入，不再由实现阶段自行发明。
4. persistent identity 与 run/session bootstrap 的分层边界已可直接指导实现。
5. 后续实现 PR 的第一刀切片、状态语义与失败面已明确，不再依赖口头补充。
6. 文档已明确哪些内容仍然不属于 `#281`。
7. 本 FR 未把 candidate 安装路径、最终安装器设计或 `FR-0020` 验证体系误写入当前正式范围。

## 依赖与前置条件

- 上位基线：
  - `vision.md`
  - `docs/dev/roadmap.md`
  - `docs/dev/architecture/system-design.md`
  - `docs/dev/architecture/system-design/execution.md`
  - `docs/dev/architecture/system-design/account.md`
  - `docs/dev/architecture/system-design/communication.md`
- 前置输入：
  - `#280` spike 证据
  - `#279` architecture freeze
  - PR `#283` merge commit `fd083e8e8e3491d00a36fe866776e636dd39f941`
- 继承 FR：
  - `FR-0002-native-messaging`
  - `FR-0003-min-session`
- GitHub 对应关系：
  - `#426` Parent Phase: Phase 1.x
  - `#435` Canonical FR issue: FR-0015
- 历史实现链路参考：
  - `#281`
  - `#361`
- 明确不在本 FR 内承接：
  - `FR-0020`（`#239`）
