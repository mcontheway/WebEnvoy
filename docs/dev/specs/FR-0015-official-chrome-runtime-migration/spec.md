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

因此本 FR 的任务不是直接实现迁移，而是把 `#279` 已冻结的上位边界转成 `#281` 可直接消费的 implementation-prep 输入。

## 目标

1. 冻结 `#281` 的 implementation-prep 范围、主输入与非目标。
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
- 不承接 `#239` 的验证体系、baseline 评估、live / recon / dry_run 分层或回归框架。

## 功能需求

### 1. implementation-prep 范围冻结

- 本 FR 必须明确 `#281` 的当前职责是 implementation-prep / 设计收口，不是完整实现闭环。
- 本 FR 必须把 `#279` 已冻结的上位边界转换成后续实现可直接消费的正式输入。
- 本 FR 必须为后续实现 PR 指定推荐的第一刀切片、共享契约与状态边界。
- 本 FR 必须明确 `#233` 是 umbrella，`#239` 是后续验证归属，当前 PR 不关闭这些问题。

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

### 5. 迁移实施切片

- 后续实现第一刀必须优先承接：
  - persistent extension 主路径的 identity preflight
  - runtime bootstrap contract 与 ack
  - runtime readiness 状态收口
- 后续实现第一刀不得同时混入：
  - 最终安装器产品化
  - candidate 分发路径产品化
  - `#239` 的验证框架
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

### 场景 3：FR-0002 link-layer 与 runtime bootstrap 保持分层

Given Native Messaging link-layer handshake 已成功
When 运行时准备进入业务执行前阶段
Then 系统必须通过独立 bootstrap contract 下发 run/session 上下文
And 不得把 `run_id` 或等价 bootstrap 字段塞回 FR-0002 握手字段
And link-layer handshake 失败与 bootstrap 失败必须可区分

### 场景 4：candidate 安装路径不会被误写成正式主方案

Given implementation-prep 文档正在定义 official Chrome 主路径
When 文档提到 `developer mode / unpacked`、External Extensions JSON、Windows 外部安装/注册表或 Chrome Web Store
Then 它们只能被标记为 candidate / transition path 或后续产品化方向
And 不得替代当前正式 runtime / identity / bootstrap 边界

### 场景 5：#239 的验证体系不混入 #281 的 implementation-prep

Given `#281` 的 formal spec 正在冻结 runtime migration 输入
When 文档定义后续测试与验证范围
Then 只允许描述实现 PR 最小验证矩阵
And 不得把 live / recon / dry_run 分层、baseline 框架或回归平台归入本 FR 的职责

## 异常与边界场景

### 1. identity 边界

- profile 存在但稳定 `extension_id` 未绑定时，必须视为 identity 未就绪，而不是假定后续启动会自动修复。
- Native Messaging manifest 存在但 `allowed_origins` 与稳定 `extension_id` 不一致时，必须视为阻断性 identity failure。
- 本 FR 不定义首次安装流程如何建立 identity binding，只定义建立完成后的正式运行时边界。

### 2. bootstrap 边界

- bootstrap ack 不得沿用旧 run 的陈旧 ready marker。
- bootstrap 未确认时，任何需要页面执行上下文的命令都必须被阻止。
- 同一个 `runtime_context_id` 的重复下发必须具备幂等语义，不能制造双重初始化。

### 3. 状态边界

- Native Messaging ready 但 bootstrap 未确认时，状态必须进入“可观察但不可执行”的分层，而不是伪装成全量 ready。
- identity binding 缺失但 Native Messaging 仍可连通时，系统不得仅凭链路活性放行业务执行。
- 独占锁失效、被抢占或锁归属无法确认时，系统不得继续维持 `ready`。
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
7. 本 FR 未把 candidate 安装路径、最终安装器设计或 `#239` 验证体系误写入当前正式范围。

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
- 对应 issue：
  - `#281`
- 父级 umbrella：
  - `#233`
- 明确不在本 FR 内承接：
  - `#239`
