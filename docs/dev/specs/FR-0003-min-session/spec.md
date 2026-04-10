# FR-0003 浏览器启动与最小身份 / 会话模型

## 背景

Phase 1 已经冻结了 CLI 的最小调用面。下一步需要把“能被稳定调用”推进到“能稳定拉起一个绑定 Named Profile 的浏览器，并保留最小身份 / 会话边界”。

历史 issue `#143` 提出了最小身份 / 会话基座的目标；当前 formal review 由 issue `#356` 承接。这个底座要求的不是完整账号系统，也不是长期运营基座，而是为后续平台读取、最小写入和会话复用提供一个足够窄的运行时底座。这个底座必须回答五个问题：

1. 浏览器如何按指定 Profile 拉起。
2. Named Profile 如何作为最小身份边界被持久化。
3. 基础状态如何流转，并能被 `status` 类接口稳定读回。
4. 代理如何按 Profile 绑定并保持粘性，避免静默漂移。
5. 首次登录如何在未初始化 Profile 上形成最小身份边界。

## 目标

1. 建立基于 Named Profile 的浏览器启动流程，能够按指定 `profile` 拉起浏览器并进入可用状态。
2. 建立最小身份 / 会话模型，只保留完成一次可靠网页执行所需的边界，不扩张到账号矩阵或长期运营。
3. 冻结浏览器生命周期的基础状态流转，让 `start`、`login`、`status`、`stop` 具有一致的状态语义。
4. 建立 Profile 级代理粘性绑定，确保同一 Profile 后续会话默认复用同一代理出口。
5. 建立 Profile 独占锁，避免同一 Profile 被多个 CLI 进程同时占用。
6. 冻结最小持久化边界：Profile 目录 + `__webenvoy_meta.json`，不引入新的账号数据库或运营型状态仓库。
7. 冻结首次登录路径，让未初始化 Profile 能直接进入 `runtime.login` 并形成最小会话摘要 / 恢复输入边界。

## 非目标

- 不做账号池、矩阵调度、养号节律、健康评分、封禁运营。
- 不做代理池管理、自动轮换、出口择优或跨 Profile 调度。
- 不做完整写入链路、任务编排、能力分享、导入、版本化。
- 不做 SDK / API / daemon 服务化。
- 不把浏览器运行时扩张成长期驻留进程管理平台。
- 不在本 FR 中定义平台级读写命令的业务语义。
- 不在本 FR 中实现 `localStorageSnapshots` 自动回写到后续浏览器会话。

## 与相邻 FR 的边界

### 与 FR-0001 的边界

- FR-0001 冻结 CLI 外层调用壳、`stdout/stderr` 边界、退出码与命令级 `run_id` 语义；FR-0003 只承接这套外层契约，不重写它。
- FR-0003 的 `runtime.start`、`runtime.login`、`runtime.status`、`runtime.stop` 都必须复用 FR-0001 的单次调用 `run_id`；每次命令调用各自拥有一个 `run_id`，不得引入 Profile 级、浏览器级或元数据级第二套运行标识。
- FR-0003 允许在锁文件中记录 `ownerRunId` 作为审计 / 恢复输入，但它不是新的共享运行标识，也不是 `__webenvoy_meta.json` 主键。

### 与 FR-0002 的边界

- FR-0002 只冻结 CLI 到页面侧的最小通信闭环、link-layer 状态与 `ERR_TRANSPORT_*` 错误；FR-0003 不承接握手、心跳、转发和 transport error 分类。
- FR-0003 只定义 Profile / 浏览器生命周期语义；若运行时依赖通信链路，则仍需在 FR-0002 的 transport readiness 上承载。
- `run_id` 在 FR-0002 中只属于单次转发上下文，不属于握手字段；FR-0003 继续沿用这一分层，不得把会话状态、Profile 元数据或握手字段改写成另一套 `run_id` 语义。

### 与 FR-0006 的边界

- FR-0003 冻结实时 Profile 状态、最小元数据和锁语义；FR-0006 只负责 SQLite 运行记录、历史证据和诊断时间线。
- FR-0003 的 `runtime.status` 以 Profile 目录、锁和运行时观测为真相源；FR-0006 不得通过 SQLite 回放驱动 `profileState` / `browserState` 切换。
- FR-0003 只要求把命令级 `run_id` 透传到锁审计 / 运行态关联面；是否落库、如何按 `run_id` 查询历史记录属于 FR-0006。

### 与 FR-0015 的边界

- FR-0003 冻结 Named Profile、最小身份 / 会话模型和 `__webenvoy_meta.json` 基线字段；FR-0015 如需在 official Chrome persistent extension 迁移语境下新增 `persistentExtensionBinding` 等字段，必须在其自身 formal review 获批后单独冻结。
- FR-0015 的 `runtime_bootstrap_envelope`、`runtime_context_id`、bootstrap ack 与 readiness 分层属于单次运行上下文，不得回写成 FR-0003 的基线元数据字段。
- FR-0003 不承接 stable extension identity、bootstrap transport contract 或 readiness 细分视图；这些能力必须在 FR-0015 自己的 formal contract / data-model 内冻结。

## 功能需求

### 1. Named Profile 作为最小身份边界

- 每个 Profile 必须映射到独立的浏览器 UserDataDir。
- 浏览器启动时必须绑定到明确的 `profile`，不能落入匿名临时目录作为默认行为。
- Profile 的登录态主要由浏览器自身的持久化目录承载，WebEnvoy 只负责最小元数据与状态控制。
- Profile 名称必须是稳定标识，后续会话使用同一名称时应回到同一目录。

### 2. 最小生命周期命令

本 FR 冻结以下生命周期命令的正式语义：

- `runtime.start`
- `runtime.login`
- `runtime.status`
- `runtime.stop`

命令级要求：

- 以上命令均通过 FR-0001 的统一 CLI 调用面进入。
- 其中 `runtime.start`、`runtime.login`、`runtime.status`、`runtime.stop` 都必须支持 `--profile`。
- `runtime.start` 负责拉起浏览器并把 Profile 置入可用状态。
- `runtime.login` 负责打开或保持可见浏览器，并通过显式二次调用完成手动登录收口；若 Profile 尚未初始化，命令可直接创建最小目录与元数据后进入登录流程。
- `runtime.status` 负责读取当前 Profile 的浏览器态与持久化态，不应修改状态。
- `runtime.stop` 负责关闭当前 Profile 的浏览器实例并释放锁。

命令级运行标识要求：

- 上述四个命令都必须返回并透传 FR-0001 定义的命令级 `run_id`。
- 同一 Profile 上连续两次 `runtime.start` / `runtime.login` 即使作用于同一目录，也必须是两个不同的命令级 `run_id`。
- `runtime.status` 与 `runtime.stop` 同样拥有各自独立的命令级 `run_id`；不能复用先前 `start/login` 的 `run_id` 充当“会话 ID”。
- 唯一例外是 `runtime.login` 的显式确认续调用：当调用方以 `params.confirm=true` 收口同一手动登录流程时，必须复用首次 `runtime.login` 返回的同一个 `run_id`；否则当前实现会按非 owner 调用拒绝处理。

### 3. 基础状态流转

浏览器生命周期只冻结以下基础状态：

- `uninitialized`
- `starting`
- `ready`
- `logging_in`
- `disconnected`
- `stopping`
- `stopped`

状态流转要求：

- `runtime.start` 可以把 `uninitialized`、`stopped`、`disconnected` 转入 `starting`，随后进入 `ready`。
- `runtime.login` 可以把 `uninitialized`、`stopped`、`disconnected` 或 `ready` 转入 `logging_in`，登录确认后回到 `ready`。
- 浏览器异常退出、通信断开或用户手动关闭窗口时，系统必须能够将 Profile 置为 `disconnected`。
- 若断连信号来自通信链路观测，则该观测事实由 FR-0002 承接；FR-0003 只消费该事实并把结果收敛到 `profileState/browserState`。
- `runtime.stop` 必须将活动实例从 `ready` 或 `logging_in` 转入 `stopping`，最终进入 `stopped`。
- 同一时间一个 Profile 只能有一个有效活动实例。

状态语义补充：

- FR-0003 的 `ready` 只表示“Profile / 浏览器生命周期已进入可复用的本地运行态”。
- 该 `ready` 不等同于 FR-0002 的 transport ready，也不等同于 FR-0015 后续引入的 runtime readiness / bootstrap ready。

### 4. 代理粘性绑定

- Profile 支持可选的 `proxyUrl` 绑定。
- 一旦某个 Profile 已绑定代理，后续启动默认复用该绑定，不允许静默轮换。
- 如果用户显式传入的代理与已绑定代理冲突，系统必须拒绝本次启动或登录，不能悄悄切换出口。
- `proxyUrl = null` 表示直连。
- 代理绑定只作为 Profile 级最小配置，不引入代理池、调度器或健康检查系统。

### 5. 独占锁与并发保护

- 同一 Profile 在同一时刻只能被一个 CLI 进程持有。
- 在锁未释放前，第二个针对同一 Profile 的 `start` / `login` 请求必须被拒绝。
- 锁释放必须与 `stop`、异常断开和进程崩溃恢复逻辑一致，不能依赖人工清理成为常态。
- 并发保护的目标是避免同一 Profile 的 UserDataDir 与元数据被两个进程同时写入。

### 6. 最小持久化边界

- 本 FR 只冻结两类持久化对象：
  - 浏览器 UserDataDir 中的原生会话数据
  - `__webenvoy_meta.json` 中的最小元数据
- 不新增独立 SQLite 表来承载账号生命周期。
- 不把任务状态、平台数据、运行日志混入 Profile 元数据。
- `__webenvoy_meta.json` 只保留运行所需的最小字段，不承载账号矩阵或长期运营信息。
- `localStorageSnapshots` 在本 FR 中只作为最小会话摘要 / 恢复输入写入元数据与状态回读。
- 本 FR 不要求把 `localStorageSnapshots` 自动回写到后续浏览器会话。
- FR-0003 基线下，`__webenvoy_meta.json` 只允许出现以下顶层字段白名单：
  - `schemaVersion`
  - `profileName`
  - `profileDir`
  - `profileState`
  - `proxyBinding`
  - `fingerprintSeeds`
  - `localStorageSnapshots`
  - `createdAt`
  - `updatedAt`
  - `lastStartedAt`
  - `lastLoginAt`
  - `lastStoppedAt`
  - `lastDisconnectedAt`
- 上述白名单之外的顶层字段，只有在对应后续 FR 完成 formal spec review 并明确冻结后，才允许作为加性可选字段出现；在此之前都不属于 FR-0003 原生白名单。
- FR-0003 基线下，`__webenvoy_meta.json` 不得持久化 `run_id`、`session_id`、transport session、bootstrap envelope、账号评分或代理池状态。

### 7. 最小错误码分层

- FR-0003 只冻结以下会话层错误码白名单：
  - `ERR_PROFILE_INVALID`
  - `ERR_PROFILE_LOCKED`
  - `ERR_PROFILE_META_CORRUPT`
  - `ERR_PROFILE_PROXY_CONFLICT`
  - `ERR_BROWSER_LAUNCH_FAILED`
  - `ERR_PROFILE_STATE_CONFLICT`
- 上述错误码只作为 FR-0001 CLI 错误响应壳内部的 `error.code` 扩展，不改写 CLI 外层字段与退出码契约。
- FR-0002 的 `ERR_TRANSPORT_*` 属于通信层错误，不纳入 FR-0003 白名单。
- 后续 FR 若需要新增会话层错误码，必须以 formal 加项方式补入，不能改写上述基线语义。

补充说明：

- `runtime.login` 在 FR-0003 基线下采用显式二次确认模型：首次调用进入 `logging_in` 并返回 `confirmationRequired`，后续由调用方再次调用 `runtime.login` 并传入 `params.confirm=true` 收口。
- `runtime.login` 的确认续调用必须复用首次登录调用的同一个命令级 `run_id`；本 FR 当前不冻结“首次调用与确认调用使用两个独立 `run_id`”的语义。
- FR-0003 当前不冻结“命令内等待用户登录确认直到超时”的稳定语义；若确认阶段发现登录浏览器已断开或状态已不兼容，统一收敛到 `ERR_PROFILE_STATE_CONFLICT`。
- 若后续 FR 需要引入登录确认 deadline / timeout 语义，必须连同状态机、错误码和测试一起以 formal 加项方式进入，不得回写为本基线既有语义。

## GWT 验收场景

### 场景 1：首次启动指定 Profile 会创建最小身份边界

Given 一个尚未初始化的 Profile 名称  
When 调用 `runtime.start --profile <name>`  
Then 系统会创建对应的 Profile 目录与最小元数据文件  
And 浏览器会绑定到该 Named Profile 启动  
And Profile 状态会从 `uninitialized` 进入 `starting` 并最终进入 `ready`

### 场景 2：已存在 Profile 的登录态可以被复用

Given 一个已经存在且包含登录态的 Profile  
When 再次调用 `runtime.start --profile <name>`  
Then 系统必须复用同一 Profile 目录  
And 浏览器启动后应处于 `ready` 状态  
And 现有登录态不应被无谓清空

### 场景 3：首次登录可以直接创建并回写最小身份边界

Given 一个尚未初始化的 Profile 名称  
When 首次调用 `runtime.login --profile <name>`  
Then 系统会创建对应的 Profile 目录与最小元数据文件  
And 浏览器会绑定到该 Named Profile 启动  
And Profile 状态进入 `logging_in`  
And 返回结果会明确要求调用方后续再次调用 `runtime.login` 并传入 `params.confirm=true`
And 后续确认调用必须复用这次登录流程的同一个 `run_id`

### 场景 4：手动登录后的状态可以回写到 Profile

Given 一个已经通过首次 `runtime.login --profile <name>` 进入 `logging_in` 的 Profile  
When 用户完成手动登录后再次调用 `runtime.login --profile <name>` 且传入 `params.confirm=true`，并复用首次登录调用的同一个 `run_id`  
Then Profile 状态会从 `logging_in` 回到 `ready`  
And 登录态相关的最小持久化摘要会被保存到该 Profile 元数据

### 场景 4b：确认阶段若浏览器已断开则收敛为状态冲突

Given 一个已经进入 `logging_in` 的 Profile  
When 调用 `runtime.login --profile <name>` 且传入 `params.confirm=true` 时登录浏览器已断开  
Then 命令必须失败  
And 失败错误码为 `ERR_PROFILE_STATE_CONFLICT`  
And Profile 状态会收敛到 `disconnected`

### 场景 5：同一 Profile 的并发启动会被拒绝

Given 一个 Profile 已被某个 CLI 进程持有  
When 另一个 CLI 进程再次对同一 Profile 调用 `runtime.start` 或 `runtime.login`  
Then 第二个请求必须失败  
And 失败原因必须明确指向 Profile 独占锁冲突  
And 既有会话状态不得被破坏

### 场景 6：代理绑定会随 Profile 持久化复用

Given 一个 Profile 首次以显式 `proxyUrl` 启动并成功绑定代理  
When 之后再次使用同一 Profile 启动且未显式修改绑定  
Then 系统必须复用既有代理绑定  
And 浏览器会话不得在后台自动切换到其他代理出口

### 场景 7：异常断开后可以稳定识别为断连状态

Given 一个处于 `ready` 或 `logging_in` 的活动 Profile  
When 浏览器进程崩溃或连接断开  
Then Profile 状态必须进入 `disconnected`  
And `runtime.status` 必须能读回该状态  
And 后续重新 `runtime.start` 可以重新进入 `starting`

### 场景 8：`localStorageSnapshots` 在 FR-0003 中不要求自动回写浏览器会话

Given 一个 Profile 的 `__webenvoy_meta.json` 已保存 `localStorageSnapshots`  
When 后续再次执行 `runtime.start --profile <name>`  
Then 命令返回与状态回读可以暴露最小会话摘要 / 恢复输入  
And 本 FR 不要求自动把该快照回写到浏览器会话

## 异常与边界场景

### 1. Profile 与路径边界

- Profile 名称非法、为空或包含路径穿越风险时，必须拒绝启动。
- Profile 目录存在但元数据缺失时，应优先按可恢复状态处理，而不是直接创建新的不相关 Profile。
- Profile 目录或元数据损坏时，必须返回明确错误，不允许静默覆盖原有数据。

### 2. 代理边界

- 已绑定代理的 Profile 若收到冲突代理参数，必须失败，不允许静默改绑。
- 非法代理格式、不可解析协议或无法连接的代理应在启动前给出结构化错误。
- 直连与代理绑定必须是显式区分的两种状态，不能通过空值推断出模糊语义。

### 3. 状态边界

- `runtime.status` 只能读状态，不能顺手触发启动、登录或修复动作。
- 在 `logging_in` 期间如果用户关闭浏览器，系统应把状态识别为 `disconnected`，而不是误报为 `ready`。
- 如果 `runtime.stop` 在未持锁状态下调用，应返回可解释的失败，而不是制造假停止态。

### 4. 并发边界

- 同一 Profile 的锁必须防止并发写入，但不能把整个系统串行化成单进程。
- 崩溃后遗留的陈旧锁应有明确的回收策略，不能永久阻塞该 Profile。

### 5. 持久化边界

- 本 FR 不要求把所有浏览器内部会话细节都镜像到 WebEnvoy 的自有数据库。
- `__webenvoy_meta.json` 只保存最小必要字段，不能膨胀成账号资产总表。

## 验收标准

1. 能按指定 `profile` 启动浏览器，并进入可读回的 `ready` 状态。
2. `runtime.login` 能在首次使用时创建最小身份边界，并通过再次调用 `runtime.login` 且传入 `params.confirm=true` 收口手动登录结果。
3. 同一 Profile 的并发启动能被稳定拒绝，且拒绝原因可读。
4. 代理绑定能随 Profile 持久化并在后续启动中复用。
5. `runtime.status` 能稳定返回浏览器态、Profile 态和代理绑定信息。
6. 本 FR 未引入账号矩阵、长期运营、代理池或独立会话数据库。
7. 浏览器启动与最小身份 / 会话模型能为后续 `#145`、`#146`、`#148` 提供稳定承载面。
8. `localStorageSnapshots` 在本 FR 中仅作为最小会话摘要 / 恢复输入，不作为自动回写浏览器会话的完成标准。
9. FR-0003 与 FR-0001 / FR-0002 / FR-0006 / FR-0015 的边界分工、`run_id` 口径、`__webenvoy_meta.json` 字段白名单与错误码白名单都已形成正式冻结表述。

## 依赖与前置条件

- 前置文档：
  - `vision.md`
  - `docs/dev/roadmap.md`
  - `docs/dev/architecture/system-design.md`
  - `docs/dev/architecture/system-design/account.md`
  - `docs/dev/architecture/system-design/execution.md`
  - `docs/dev/architecture/system-design/communication.md`
  - `docs/dev/architecture/system-design/database.md`
  - `docs/dev/architecture/system-design/error-handling.md`
  - `docs/dev/specs/FR-0001-runtime-cli-entry/spec.md`
  - `docs/dev/specs/FR-0001-runtime-cli-entry/contracts/cli-entry.md`
- Governing issue：
  - `#143`
- Formal review issue：
  - `#356`
- 前置能力：
  - `#354` 已收口 FR-0001 的 CLI 最小入口与可集成契约
- 并行协同：
  - `#355`（最小通信闭环 formal 基座）
  - `#359`（SQLite 运行记录映射边界）
  - `#361`（official Chrome 主方案下的运行时增量边界）
- 后续承接：
  - `#145`、`#146`、`#148`
