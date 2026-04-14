# FR-0023 上游授权输入与请求期 admission 契约

Canonical Issue: #472

## 背景

`#470` 已完成“上游批准结果如何进入 WebEnvoy、WebEnvoy 自己保留什么门禁职责”的决策收口，并明确 `#472` 的关闭条件不再是继续口头讨论，而是要形成可被后续实现 issue / PR 直接引用的正式 FR 套件。

当前缺口在于：

- 现有 `FR-0010`、`FR-0011`、`FR-0014` 已冻结 gate、admission evidence、session rhythm 等内部运行时对象，但尚未把“上游授权输入”收口为稳定外部接缝。
- `#445` 暴露的 `paused` / admission 阻断事实已经证明，若没有上游输入与请求期 admission 的清晰分层，WebEnvoy 会长期停留在内部 gate 语义，却缺少稳定恢复入口。
- WebEnvoy 的产品边界已经明确：它是 Web 执行底座，不是账号矩阵、审批产品或长期资源运营系统。

因此，本 FR 的职责是把 `#470` 的决策冻结成 formal contract：上游负责动作、资源、授权范围与策略输入；WebEnvoy 负责把这些输入映射为 request-time admission、执行保护与请求级审计结果。

## 目标

1. 冻结 `action_request`、`resource_binding`、`authorization_grant`、`runtime_target` 四个外部正式对象。
2. 冻结 `request_admission_result` 与 `execution_audit` 的请求级结果边界。
3. 明确 `anonymous_context` 与 `profile_session` 的第一版资源主体边界，以及匿名请求不得落入目标站点已登录上下文的正式约束。
4. 明确 `dry_run / recon / live_*`、request-time admission、execution audit、session rhythm 等仍属于 WebEnvoy 内部运行时语义。
5. 明确 `FR-0010`、`FR-0011`、`FR-0014` 与本 FR 的兼容迁移关系，使后续实现可以直接据此建立 mapping 层，而不再回到 `#470` 重开边界讨论。

## 非目标

- 不在本 FR 内实现 runtime、CLI、extension 或命令层代码。
- 不修复 `#445` 的 fresh rerun 阻断，也不修复 `#468` 的 post-gate bundle 缺陷。
- 不修改 `FR-0016` 或任何治理落库文件。
- 不把本 FR 扩成上层账号运营产品、审批 UI、资源池调度系统或长期账号健康系统。
- 不重构现有 runtime command surface。
- 不把 integration governance、真实 live evidence 门禁或 rerun closeout 混入当前 formal spec review PR。

## 功能需求

### 1. 外部正式对象骨架

系统必须冻结以下四个外部正式对象：

1. `action_request`
2. `resource_binding`
3. `authorization_grant`
4. `runtime_target`

这些对象共同回答以下问题：

- `action_request`：这次要做什么动作
- `resource_binding`：这次允许使用什么资源主体
- `authorization_grant`：上游授予了哪些动作范围与约束
- `runtime_target`：这次请求要在哪个具体现场执行

本 FR 必须明确：

- 上游正式协议以“动作 + 资源 + 授权 + 现场”为中心，而不是以 `live_read_limited`、`live_read_high_risk` 等 WebEnvoy 内部模式为中心。
- `runtime_target` 是现场约束，不是长期权限主体。
- WebEnvoy 必须先验证四个对象彼此一致，再进入 request-time admission。

### 2. `action_request` 边界

- `action_request` 只表达上游业务动作、动作类别、请求意图与可选约束引用。
- `action_request` 可以映射到现有 `FR-0010.gate_input.action_type`，但不得直接把 `requested_execution_mode` 暴露为上游主授权语义。
- `action_request` 不得承载 `dry_run`、`recon`、`live_read_limited`、`live_read_high_risk`、`live_write` 等内部执行模式枚举。
- 若上游需要表达风险敏感动作，只能通过 grant 的约束表达“是否允许该动作、需要什么前置”，不能直接要求 WebEnvoy 以某个内部 mode 运行。

### 3. `resource_binding` 边界

- 第一版正式资源主体只允许：
  - `anonymous_context`
  - `profile_session`
- `account_ref` / `subject_ref` 只允许作为可选上游治理引用附带，不得成为第一版 WebEnvoy 主执行主体。
- `profile_session` 表达“可复用本地执行容器 + 会话依赖”，不扩张为账号矩阵、健康评分、冷却运营或长期资源状态机主体。
- `anonymous_context` 表达“本次请求必须在匿名视角下执行”，不要求上游指定具体本地匿名落地方式。

匿名约束必须正式冻结为：

- `anonymous_context` 请求不得落到目标站点已登录上下文。
- 若当前目标现场被检测为目标站点已登录上下文，WebEnvoy 必须返回阻断事实与风险信号，而不是静默复用该登录态。
- 匿名请求是否由临时匿名上下文还是专用匿名 profile 落地，属于 WebEnvoy 内部实现细节，不改变外部资源主体语义。

### 4. `authorization_grant` 边界

- `authorization_grant` 只表达上游授予的动作范围与约束。
- 第一版正式范围至少覆盖：
  - 允许动作范围
  - 资源适用范围
  - 目标适用范围
  - 资源使用约束
  - 人工确认 / 授权结果引用
  - 时间窗口、频率限制、恢复条件等上游约束
- `active` / `cool_down` / `paused` 等资源策略状态归上游持有；WebEnvoy 不成为这类长期运营状态的真相源。
- 第一版 grant 可以携带这些资源策略状态的快照或声明，但 WebEnvoy 只把它们当作输入事实，不负责其长期状态流转权威。
- 若 grant 缺失必要授权范围或与 binding / target / action 不匹配，WebEnvoy 必须在 request-time admission 直接阻断。

### 5. `runtime_target` 边界

- `runtime_target` 表达本次请求的现场约束，至少包含域、页面语义、tab、URL 或等价现场选择信息。
- `runtime_target` 必须保留与既有 `target_domain`、`target_tab_id`、`target_page` 的兼容映射。
- `runtime_target` 不得被解释为长期权限主体。
- WebEnvoy 必须在 admission 前验证 `runtime_target` 与 `authorization_grant`、`resource_binding`、`action_request` 是否一致；若现场不匹配，必须返回请求级阻断结果。

### 6. WebEnvoy 内部运行时语义边界

以下语义继续属于 WebEnvoy 内部运行时，不进入上游主授权协议：

- `dry_run`
- `recon`
- `live_read_limited`
- `live_read_high_risk`
- `live_write`
- request-time admission
- execution audit
- session rhythm / recovery probe / cooldown gating

本 FR 必须明确：

- 上游协议不直接审批这些模式。
- WebEnvoy 接收到 `action_request + resource_binding + authorization_grant + runtime_target` 后，自行归一化到内部 gate / rhythm / execution mode 语义。
- `FR-0010`、`FR-0011`、`FR-0014` 继续作为内部 gate、risk_state、admission evidence、session rhythm 的正式边界。
- 内部允许、阻断、降级与恢复控制仍由 WebEnvoy 根据 request-time admission 决定，但不得反向把这些内部 mode 当成上游授权主模型。

### 7. 请求级结果边界

系统必须冻结以下请求级结果对象：

1. `request_admission_result`
2. `execution_audit`

它们至少必须支持以下正式语义：

- `request_admission_result`
  - 表达当前请求是否可进入执行
  - 只返回请求级事实：允许 / 阻断 / 降级、原因、现场校验结果、资源与 grant 是否匹配、是否命中匿名约束或登录态污染
  - 不把上游资源运营状态重写成 WebEnvoy 权威状态机
- `execution_audit`
  - 表达本次请求实际消费了什么上游输入、做了哪些判断、产生了哪些风险信号与执行证据
  - 是请求级执行证据，不等于上游审批产品审计系统
  - 必须能与 `FR-0010.approval_record / audit_record`、`FR-0011.approval_admission_evidence / audit_admission_evidence`、`FR-0014.session_rhythm_*` 形成兼容追溯关系

### 8. 兼容迁移关系

本 FR 只定义继承与映射，不改写既有 formal FR：

- `FR-0010.gate_input`
  - 由 `action_request + resource_binding + authorization_grant + runtime_target` 经 WebEnvoy 归一化后生成。
- `FR-0010.approval_record / audit_record`
  - 继续保留为 gate 后 persisted trail。
  - 不再承担上游授权输入本体。
- `FR-0011.approval_admission_evidence / audit_admission_evidence`
  - 作为第一版 grant 输入进入 request-time admission 的兼容承载。
  - 继续是 pre-gate evidence，不替代 post-gate record。
- `FR-0014.session_rhythm_*`
  - 继续保留为 WebEnvoy 内部节律与恢复控制。
  - 其 `allowed / blocked / deferred` 结果只影响 request-time admission / execution_audit，不上升为上游资源运营状态真相源。

### 9. 范围与阶段边界

- 本 FR 的当前成熟度是 `spec-ready`，目标是形成 formal spec review PR。
- 在 spec review 通过前，不得据此进入实现承诺。
- `#468` 是实现侧并行 blocker，但不属于本 FR 范围。
- `#445` fresh rerun 只能在实现修复与授权输入 mapping 都完成后，在新的 latest head 上重开；本 FR 不承担 rerun closeout。
- 本 FR 当前属于 integration-gated formal suite：
  - 本地 integration 锚点：`#464`
  - 对应 Syvert 治理事项：`MC-and-his-Agents/Syvert#105`
  - 原因：本 FR 冻结的是上游授权输入与 runtime mode / gate 口径之间的共享契约边界，后续实现前与合并前都必须继续核对 integration 状态。

## GWT 验收场景

### 场景 1：匿名请求命中已登录现场时必须阻断

Given 上游发来一个 `resource_binding.resource_kind=anonymous_context` 的请求
And `runtime_target` 指向的目标站点现场检测为已登录上下文
When WebEnvoy 执行 request-time admission
Then `request_admission_result` 必须返回阻断事实
And 返回明确的登录态污染 / 匿名约束不满足信号
And 不得静默复用该登录态继续执行

### 场景 2：`profile_session` 请求允许使用已登录会话

Given 上游发来一个 `resource_binding.resource_kind=profile_session` 的请求
And grant 允许该动作在该资源主体下执行
And `runtime_target` 与当前现场一致
When WebEnvoy 执行 request-time admission
Then 该请求可以继续映射到内部 gate / rhythm 语义
And 不因“现场已登录”这一事实被当成匿名污染而阻断

### 场景 3：grant 允许动作但 runtime target 不匹配时必须阻断

Given grant 允许某个资源主体执行某个读取动作
And 上游请求中的 `runtime_target` 指向特定域、页面与 tab
When WebEnvoy 发现当前现场与 `runtime_target` 不一致
Then `request_admission_result` 必须返回阻断
And 阻断原因必须能独立表达现场不匹配

### 场景 4：上游资源策略状态只作为输入事实

Given `authorization_grant` 携带上游声明的 `cool_down` 或 `paused` 资源策略状态
When WebEnvoy 执行 request-time admission
Then WebEnvoy 只返回请求级阻断事实与风险信号
And 不把该资源策略状态升级为自身长期真相源
And 不声明自己拥有该资源长期状态流转权威

### 场景 5：内部执行 mode 不作为上游授权主语义

Given 上游发来 `action_request + resource_binding + authorization_grant + runtime_target`
When WebEnvoy 将请求归一化到内部执行语义
Then `dry_run / recon / live_*` 只在 WebEnvoy 内部使用
And 外部协议不需要直接审批这些内部 mode

### 场景 6：旧 admission evidence 仍可作为第一版 grant 输入兼容映射

Given 上游提供的 grant 仍通过 `approval_admission_evidence` 与 `audit_admission_evidence` 承载第一版授权输入
When WebEnvoy 执行 request-time admission
Then 这些对象可以被兼容映射为 grant 输入的一部分
And `FR-0010.approval_record / audit_record` 继续只承担 gate 后 persisted trail

## 异常与边界场景

- `authorization_grant` 缺失必要授权范围或与 action / binding / target 不匹配时，必须直接阻断。
- 上游只传入 `account_ref` / `subject_ref`，但未给出 `anonymous_context` 或 `profile_session` 可执行主体时，必须直接阻断，不能由 WebEnvoy 猜测执行主体。
- 匿名请求误落登录态时，必须显式返回匿名约束失败，而不是退化为 profile 任务。
- `runtime_target` 漂移、tab 不匹配、页面语义不匹配或 URL 越界时，必须作为请求级 admission 阻断原因返回。
- request-time admission 可以因为内部 gate、risk_state、session rhythm 或目标现场不满足而阻断，但不得借此篡夺上游资源长期状态权威。
- 若上游 grant 声明的资源策略状态与 WebEnvoy 当前内部风险信号冲突，WebEnvoy 只能返回请求级事实、风险信号与执行证据，不能把自己的内部风险状态写回成上游长期运营状态真相源。

## 验收标准

1. `action_request`、`resource_binding`、`authorization_grant`、`runtime_target` 的正式边界已冻结。
2. `request_admission_result` 与 `execution_audit` 的请求级结果边界已冻结。
3. `anonymous_context` 与 `profile_session` 的第一版资源主体边界已冻结，匿名请求不得落入已登录现场的约束已明确。
4. `dry_run / recon / live_*`、request-time admission、execution audit、session rhythm 的内部运行时归属已明确。
5. `FR-0010`、`FR-0011`、`FR-0014` 与本 FR 的兼容迁移关系已明确。
6. formal 套件足以支撑后续实现 issue / PR 直接引用，不再回到 `#470` 重新讨论边界。
7. 当前 PR 只承载 formal spec review，不混入实现代码、`FR-0016`、治理文件、`#445` rerun 或 `#468` 修复。

## 依赖与前置条件

- `vision.md`
- `docs/dev/roadmap.md`
- `docs/dev/architecture/system-design.md`
- `docs/dev/architecture/system-design/account.md`
- `docs/dev/architecture/system-design/communication.md`
- `docs/dev/architecture/system-design/execution.md`
- `docs/dev/specs/FR-0010-xhs-risk-gates-hardening/contracts/risk-gate-execution.md`
- `docs/dev/specs/FR-0011-xhs-min-anti-detection-execution/contracts/anti-detection-execution.md`
- `docs/dev/specs/FR-0014-layer3-session-rhythm-engine/contracts/session-rhythm-engine.md`
- `docs/dev/issue-470-upstream-authorization-boundary-decision-note.md`
- GitHub issue `#472`
