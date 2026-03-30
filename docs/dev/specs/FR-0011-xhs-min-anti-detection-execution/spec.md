# FR-0011 Sprint 3 最小反风控执行能力

## 背景

`FR-0009`（`#213`）已经冻结了读写路径风险门禁规约，并明确在门禁落实前不得恢复高风险 live 读写实验。当前缺口是“最小反风控执行能力”仍未形成可实现的正式契约，导致后续 `#208`（最小页面交互正式验证）和 `#209`（读路径后续 live 扩展）缺少统一可执行前置。

本 FR 聚焦 Sprint 3，目标不是完整反风控系统，而是交付“可实现、可验证、可审查”的最小执行能力基线，避免后续功能实现继续消耗账号。

## 目标

1. 明确插件层（background/content-script/main world）作为门禁主落点的职责边界。
2. 冻结读路径执行模式收敛规则（默认模式、受控 live 条件、禁止动作）。
3. 冻结写路径交互分级规则（真实交互优先、合成交互/上传注入分级与阻断）。
4. 冻结最小 session 节律、指数退避冷却与恢复规则。
5. 冻结最小风险状态机（`paused/limited/allowed`）与状态迁移条件。
6. 将 `#208/#209` 纳入同一状态机输入、阻断矩阵与恢复条件。
7. 冻结 `#208` 恢复正式验证前的最小机器契约边界，明确“治理动作类别”与“正式命令接口”之间的界线。

## 非目标

- 不交付完整平台写闭环或完整发布能力。
- 不实现账号矩阵、养号运营或跨平台统一运营系统。
- 不在本 FR 内交付高阶 Layer 4 平台行为模型完整实现。
- 不改变 `FR-0001` CLI 外层契约和 `FR-0002/0003` 通信/会话基础壳。
- 不把 `editor_input` 候选动作直接升级为已冻结的正式命令接口。
- 不在本 FR 内定义 `xhs.editor_input` 或 `xhs.interact` 的稳定 CLI/API schema。

## 功能需求

### 1. 插件层门禁主落点

- 必须定义 plugin gate ownership：哪些门禁判定在 extension background 执行，哪些在 content-script 执行，CLI 仅承载请求与结构化结果。
- 必须明确主世界调用（如签名调用）与页面执行行为的受控入口，不允许散落式放行。
- 必须定义“目标域 + 目标页确认”在插件层的最小实现契约。

### 2. 读路径执行模式收敛

- 必须定义读路径默认模式（`dry_run|recon`）与受控 live 触发条件。
- 必须明确 `live_read_limited` 是 Sprint 3 范围内对外可请求的正式受控 live 模式，而不是仅供内部 fallback 使用的私有枚举。
- 必须明确 `live_read_limited` 与 `live_read_high_risk` 在进入 live 前都要求人工确认、审批检查项与审计证据，不允许只对高风险模式单独要求审批。
- 必须把上述审批与审计要求落入结构化 `live_entry_requirements`，至少显式覆盖 `risk_state_checked` 与 `action_type_confirmed`，不允许只在 prose 里更严格、对象契约里更宽松。
- 必须定义读路径禁止动作清单（例如风险状态不满足时禁止扩新 live 面）。
- 必须明确 `effective_execution_mode` 只表示“真实继续执行的模式”；若门禁结果为 `blocked`，则该字段只能回落到 `dry_run` 或 `recon` 一类未继续 live 的模式，不得对外宣称未实际执行的 `live_*` 降级模式。
- 必须定义读路径执行的最小审计字段，确保后续可追踪。

### 3. 写路径交互分级

- 必须定义写路径动作级别：
  - 低风险可观测动作（只读观察）
  - 中风险交互动作（可逆交互）
  - 高风险/不可逆写动作（默认阻断）
- 必须明确“真实交互优先”与“合成事件回退”的使用边界。
- 必须明确上传注入相关路径（`DataTransfer` 等）在本阶段默认不放行为 live。
- 必须明确 `issue_208` 当前冻结的是治理动作类别 `reversible_interaction_with_approval`，而不是正式命令名。
- 必须明确在本次 formal contract freeze 中，`issue_208` 冻结的是“进入真实最小可逆交互验证的前置条件与边界”，而不是正式稳定命令接口。
- 必须明确 `issue_208` 当前唯一正式验证候选动作是 `editor_input`：仅限 `creator.xiaohongshu.com/publish` 页面上的“聚焦并输入少量文本”。
- 必须明确 `reversible_interaction_with_approval` 在 `issue_208` 上只允许作为单动作正式验证的受控 live 范围，不得扩张到上传、提交、发布确认或完整写链路。
- 必须明确 `FR-0008` 中 `editor_input` 只是正式验证候选动作，不得被实现 PR 视为已冻结 command/API contract。
- 必须明确后续若要引入 `xhs.editor_input` 或 `xhs.interact`，必须通过独立正式 command contract 冻结命令名、输入、输出、错误码、observability 与 gate-only 语义。

### 4. `#208` gate-only 前置与真实验证最小边界

- 必须冻结 `#208` 在 gate-only success 与 gate blocked 两种场景下的最小 `observability.page_state` 语义。
- 必须明确上述两种场景都允许返回最小 `page_state`，且 `key_requests=[]`。
- 必须明确 gate-only success 时 `failure_site=null`，gate blocked 时 `failure_site.component="gate"`。
- 必须明确 gate-only 结果可返回页面观测信息，但不得发起真实写请求或返回真实 `interaction_result`。
- 必须明确当 `issue_208` 已满足 `allowed + approval + audit` 前置时，可进入 `editor_input` 单动作真实验证。
- 必须明确真实验证场景至少记录 `success_signals`、`failure_signals`、`minimum_replay` 与受限的 `interaction_result`，但这些验证态结果不等于正式稳定命令输出壳。

### 5. 最小 session 节律/冷却/恢复

- 必须定义最小节律约束字段：
  - 执行动作频率
  - 连续实验间隔
  - 命中风险后的冷却窗口
- 必须定义恢复条件与恢复后可执行范围，避免口头恢复。

### 6. 最小风险状态机

- 必须冻结三态：
  - `paused`：禁止高风险 live
  - `limited`：仅允许受控范围
  - `allowed`：满足稳定窗口与人工审批后，可执行已批准范围
- 必须定义状态迁移触发条件与阻断条件。
- 必须定义状态输出契约，供 `#208/#209` 直接消费。
- 必须定义 `#208/#209` 在三态下的差异化阻断边界：
  - `paused`：`#208` 与 `#209` 均只允许 `dry_run|recon`，禁止任何 live。
  - `limited`：`#209` 仅允许受控读 live；`#208` 仍只允许 `dry_run|recon` 与 gate-only 观测返回，不得放行真实可逆交互。
  - `allowed`：`#209` 可进入已审批范围；`#208` 可在已审批范围内进入单一 `editor_input` 真实验证，但不因此获得稳定命令接口或完整写链路放行。
- 必须定义状态变更审计与回滚动作，至少包含变更前后状态、触发原因、run/session 关联；任何依赖人工审批或扩大 live 范围的迁移还必须包含审批人。

## GWT 验收场景

### 场景 1：插件层成为门禁主落点

Given 读写命令通过 CLI 进入 extension 执行链
When 评审者检查 FR-0011 套件
Then 能明确看到门禁判定由插件层主导
And CLI 侧不承担门禁核心判定逻辑

### 场景 2：读路径执行模式被收敛

Given 当前已有 `xhs.search` 执行链
When 检查读路径模式规则
Then 能明确区分默认模式、受控 live 条件与禁止动作
And `live_read_limited` 被定义为正式受控 live 模式
And `#209` 后续 live 扩展有统一前置

### 场景 3：写路径交互分级可执行

Given `#208` 尚未完成正式验证
When 检查写路径交互规则
Then 能看到动作分级与默认阻断规则
And 高风险/不可逆写动作在门禁前置未满足时不会被放行
And `editor_input` 仅作为 `#208` 的单动作正式验证对象存在，不等于正式命令已冻结
And 上传、提交、发布确认不会被混入 `#208`

### 场景 4：状态机与节律规则可被消费

Given 账号出现风险提示或状态变化
When 检查状态机契约与恢复条件
Then 能明确从 `paused` 到 `limited/allowed` 的迁移条件与审批要求
And `#208/#209` 能直接引用状态输出作为前置

### 场景 5：`#208/#209` 统一状态机要求可验证

Given `#208` 与 `#209` 同时存在 live 扩展诉求
When 评审者检查 FR-0011 输出对象
Then 两条链路使用同一三态状态机与恢复条件
And 不存在“`#208` 与 `#209` 使用不同阻断矩阵”的口径分叉

### 场景 6：`#208` gate-only 与真实验证边界可验证

Given `#208` 处于 gate-only 前置或真实验证准备阶段
When 插件层返回 gate-only success、gate blocked 或已审批的真实验证结果
Then 返回对象允许包含最小 `observability.page_state`
And gate-only 场景下 `key_requests` 必须为空数组
And 真实验证场景下只允许返回受限的 `interaction_result`
And 不得把验证态结果宣称为正式稳定命令输出

### 场景 7：阻断时的生效模式语义不失真

Given 请求方提交 `live_read_high_risk`
And 当前风险状态只允许受控 live 或更低模式
When 插件层门禁决定阻断该请求
Then `effective_execution_mode` 只能表达真实未继续 live 的降级结果
And 不得在 `gate_decision=blocked` 时对外暴露未实际执行的 `live_read_limited`

## 异常与边界场景

1. 账号已预警：必须进入 `paused` 或保持 `limited`，不得默认恢复 `allowed`。
2. 域名/目标页不匹配：判定失败并阻断，不得自动降级放行。
3. 证据不足：未满足恢复证据时，只允许 `dry_run|recon`。
4. 阻断语义失真：若 `gate_decision=blocked` 仍返回未实际执行的 `live_*` 生效模式，视为阻断性违规。
5. 契约漂移：若实现绕过状态机直接执行 live，视为阻断性违规。
6. 状态审计缺失：若状态变更缺少审计记录，则该变更视为无效并回退到 `paused`。
7. 命令契约偷渡：若实现 PR 把 `editor_input` 候选动作直接宣称为正式命令接口，视为阻断性违规。
8. gate-only 写入越界：若 gate-only 结果触发真实编辑器写入或返回真实 `interaction_result`，视为阻断性违规。
9. 范围漂移：若 `#208` 的真实验证扩张到上传、提交、发布确认或完整写链路，视为阻断性违规。

## 验收标准

1. FR-0011 套件完整（`spec.md`、`plan.md`、`TODO.md`、`contracts/`、`research.md`、`risks.md`、`data-model.md`）。
2. 插件层门禁主落点、读路径收敛、写路径分级三项均有可实现契约边界。
3. 最小 session 节律/冷却/恢复规则和三态状态机均有结构化输出定义。
4. `#208/#209` 可直接引用 FR-0011 输出作为进入 live 的前置。
5. `live_read_limited` 的公开模式语义、审批前置与审计要求已被正式冻结。
6. `effective_execution_mode` 在 `blocked` 场景下的语义已冻结为“真实未继续 live 的降级模式”，不会对外暴露未实际执行的 `live_*`。
7. `#208` 的 gate-only `page_state`、`key_requests=[]` 与 `failure_site` 最小语义已冻结，且真实验证场景的最小记录字段已冻结。
8. FR-0011 已明确 `editor_input` 是 `#208` 的唯一正式验证对象，但不等于已冻结的正式命令接口。
9. 本 FR 不混入实现代码，保持在规约审查路径。

## 依赖与前置条件

- 治理前置：`#216`
- 风险门禁基线：`#213` / `FR-0009`
- 门禁结果与审批证据载体：`#223` / `FR-0010`
- 关联事项：`#208`、`#209`
- 架构依据：
  - `docs/dev/architecture/system-design/read-write.md`
  - `docs/dev/architecture/system-design/execution.md`
  - `docs/dev/architecture/anti-detection.md`
