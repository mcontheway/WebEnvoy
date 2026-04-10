# FR-0022 Layer 4 平台行为基线（Platform Behavior Baseline）

Canonical Issue: #238

## 背景

`anti-detection.md` 已把 Layer 4（平台行为模型与长期基线）标记为核心差异化，并在当前 GitHub 单一主树中固定到 `Phase 4 -> FR-0022`：canonical FR issue 为 `#238`，父级 Phase 为 `#423`，相关验证前置由 `FR-0020`（`#239`）承接。与此同时，`roadmap.md` 也明确：Phase 2 不承诺在近期完成完整 Layer 4 实现，当前需要先冻结正式边界，避免后续把 Layer 4 能力与 Layer 1/2/3、或与上层账号运营系统混写。

当前仓库已有的正式规约已经覆盖：

- Layer 1：`FR-0012`
- Layer 2：`FR-0013`
- Layer 3：`FR-0014`
- 风险门禁主链：`FR-0010`、`FR-0011`

但 Layer 4 仍缺 formal FR 套件，导致“长期行为基线”只停留在架构描述，尚无可审查、可实现、可回滚的正式输入。`FR-0022` 的目标就是补齐这条缺口。

本 FR 所在 PR 仅用于 spec review，不承诺在本 PR 内提交运行时代码。

## 目标

1. 冻结 `FR-0022` / `#238` 的正式范围：Layer 4 只承接“平台历史行为基线与偏移评估”。
2. 冻结 Layer 4 与 Layer 1/2/3、`FR-0010/0011` 风险门禁链路的衔接边界。
3. 冻结 Layer 4 的最小稳定对象：行为信号、基线状态、偏移评估、决策建议。
4. 冻结冷启动与学习期（learning）语义，避免“无基线即放行”。
5. 冻结 Layer 4 的审计与数据最小化约束，避免写入无关隐私数据或多套真相源。
6. 为后续实现 PR 提供 implementation-ready 前置条件。

## 非目标

- 不在本 FR 中实现账号矩阵调度、养号运营、健康评分运营系统。
- 不在本 FR 中实现完整 Persona 生成、内容编排或跨平台运营策略。
- 不在本 FR 中重写 `FR-0010/0011` 的风险状态机真相源。
- 不在本 FR 中承诺自动放行高风险 write/live 动作。
- 不在本 FR 中实现 Layer 5（Camoufox/C++）能力。
- 不在本 FR 中混入实现代码或真实平台实验脚本。

## 功能需求

### 1. 事项定位与继承关系

- 本 FR 必须显式关联：
  - `#423`（Parent Phase: Phase 4）
  - `#238`（Canonical FR issue: FR-0022）
  - `#239`（Validation FR: FR-0020）
- 本 FR 必须显式继承：
  - `FR-0010/0011`：风险门禁和状态机主语义
  - `FR-0014`：session 节律输出边界
  - `FR-0019`：read lane 语义继承
  - `FR-0003`：profile/session 最小身份边界
- `FR-0020` 必须是 Layer 4 共享验证输入的唯一 formal owner：
  - `FR-0022` 只消费 `anti_detection_baseline_snapshot`、`anti_detection_baseline_registry_entry` 与 `anti_detection_validation_record`
  - `validation_scope=cross_layer_baseline` 是 Layer 4 唯一正式编码入口
  - `FR-0022` 不得再平行定义第二套 baseline snapshot / validation record 真相源
  - `anti_detection_baseline_registry_entry.active_baseline_ref` 是 Layer 4 唯一允许消费的 active baseline 判定来源；不得仅凭 snapshot / validation record 自行宣布某条 baseline 仍为当前生效
- Layer 4 输出只能作为 `risk decision hint`，不能直接覆盖门禁最终判定。
- `goal_kind=read` 时必须继承 `FR-0019` 的 `interaction_safety_class=pure_read` 语义：
  - 仅允许动作 `navigate | locate | click | extract | wait_settled`
  - 其中 Layer 4 的 `click` 只复用 `FR-0019` trace-side 的 `action=click + interaction_semantics=reveal_only_click`；request-side `allowed_actions=reveal_only_click` 仍留在上游授权语义，不在本 FR 内复制为新的 action enum
  - 只要出现 `type`、`submit`、`confirm`、`publish`、`purchase`、`dispatch` 或 `bind`，不得标记为 `pure_read`
- 本 FR 当前只冻结 `goal_kind=read|write` 两类 Layer 4 输入；`download` 不作为独立 Layer 4 goal 枚举冻结。
- 下载链路在进入 Layer 4 前必须完成正式映射：
  - 若下载来源解析只包含 `navigate | locate | click | extract | wait_settled`，必须映射为 `goal_kind=read` 并继续满足 `pure_read`
  - 若下载链路包含 `type`、`submit`、`confirm`、`publish`、`purchase`、`dispatch`、`bind` 或其他写入型交互，必须映射为 `goal_kind=write`，且不得标记为 `pure_read`
- 下载链路进入 `platform_behavior_assessment` 后，`action_type` 必须继续记录实际交互动作（至少覆盖 `navigate`、`locate`、`click`、`extract`、`wait_settled`、`type`、`submit`、`confirm`、`publish`、`purchase`、`dispatch`、`bind`），不得平行引入 `download` 作为新的 Layer 4 action shortcut。

### 2. Layer 4 最小对象与状态机

- 必须冻结以下正式对象：
  - `platform_behavior_signal_batch`
  - `platform_behavior_baseline_state`
  - `platform_behavior_assessment`
- `platform_behavior_baseline_state` 的最小必填字段至少包含：
  - `profile`
  - `platform`
  - `browser_channel`
  - `execution_surface`
  - `effective_execution_mode`
  - `probe_bundle_ref`
  - `baseline_state`
  - `baseline_version`
  - `learned_sample_count`
  - `learning_window_started_at`
  - `drift_level`
  - `reseed_required`
- `platform_behavior_baseline_state` 的条件字段必须固定为：
  - `ready_at`：仅 `baseline_state=ready` 时必填
  - `last_assessed_at`：只要该状态对象已被至少一次 assessment 消费，就必须可回填
- 必须冻结 `baseline_state` 最小状态集合：
  - `unseeded`
  - `learning`
  - `ready`
  - `degraded`
- 必须冻结 `drift_level` 最小等级集合：
  - `none`
  - `low`
  - `medium`
  - `high`
  - `critical`
- 必须定义状态迁移最低条件：进入学习、学习完成、偏移降级、重播种（reseed）触发。
- `baseline_state=degraded` 的最小触发准则必须冻结为：
  - 先前处于 `ready` 的同 scope 基线，其 `last_assessed_at` 已超过当前 `threshold_config_snapshot_ref` 定义的 freshness window
  - 同 scope 最新一次 assessment 返回 `drift_level=high|critical`
  - 同 scope 最新样本批次未通过正式的字段完整性或证据回链校验，导致 ready 基线不再可直接信任
- `reseed_required=true` 的最小触发准则必须冻结为：
  - `FR-0020.anti_detection_baseline_registry_entry.active_baseline_ref` 已不再指向当前 baseline version，或该 baseline 被显式 supersede / invalidate
  - 检测到跨 `(profile, platform, browser_channel, execution_surface, effective_execution_mode, probe_bundle_ref)` scope 的样本污染或隔离破坏
  - 同 scope 持续处于 `degraded`，或重复出现 `high|critical` 漂移，且已达到当前 `threshold_config_snapshot_ref` 定义的 reseed threshold
- 一旦 `reseed_required=true`，`baseline_state` 不得继续保持稳定 `ready`；下游 `decision_hint` 只能收敛到 `require_manual_review` 或 `require_reseed`，直到新学习周期重新建立。

### 3. 信号采集与归一化边界

- Layer 4 只接收结构化行为摘要，不接收页面原文、用户输入原文或媒体内容。
- `platform_behavior_signal_batch` 最小字段必须包含：
  - `batch_id`
  - `run_id`
  - `session_id`
  - `profile`
  - `platform`
  - `browser_channel`
  - `execution_surface`
  - `effective_execution_mode`
  - `probe_bundle_ref`
  - `runtime_context_id`
  - `proxy_binding_ref`
  - `target_domain`
  - `goal_kind`
  - `interaction_safety_class`
  - `observed_at`
  - `action_mix`
  - `timing_summary`
  - `risk_feedback_signals`
- `browser_channel` 在当前 formal baseline 下只允许 `Google Chrome stable`，并必须与 `FR-0015`、`FR-0016`、`FR-0020` 共享同一 canonical label。
- `execution_surface` 必须直接复用 `FR-0016` 已冻结枚举：`real_browser | stub | fake_host | other`。
- `platform_behavior_signal_batch` 只能承接已可回链到 `FR-0020.validation_scope=cross_layer_baseline` 的运行摘要输入，不得独立形成并行 baseline 作用域。
- Layer 4 若需要判定当前 active baseline，必须通过 `FR-0020.anti_detection_baseline_registry_entry` 解析，而不是直接把任意 snapshot / record 当作当前生效基线。
- Layer 4 不得把不同 `effective_execution_mode` 或不同 `probe_bundle_ref` 的共享输入合并到同一条 baseline state / drift assessment。
- `proxy_binding_ref` 只允许作为本次运行批次与 assessment 的代理绑定证据；在 `FR-0020` registry scope 未正式扩展前，Layer 4 不得把它提升为 active baseline key 或 `platform_behavior_baseline_state` 可写主键。
- 信号必须可回链到 `runtime.audit` 与 session 证据，不允许“无来源信号”进入基线计算。
- 缺少 `run_id/session_id/profile/platform` 任一主键坐标时，必须拒绝入库并输出结构化错误。
- `action_mix` 必须显式包含 `click`、`wait_settled`、`confirm`、`publish`、`purchase`、`dispatch`、`bind` 等动作计数，确保 `FR-0019` 的 trace 语义与 pure-read 禁止集合可以被稳定编码。
- `platform_behavior_baseline_state` 可写主键必须为 `(profile, platform, browser_channel, execution_surface, effective_execution_mode, probe_bundle_ref)`。
- `runtime_context_id` 与 `proxy_binding_ref` 只允许作为 run/session 证据回链字段，不能进入可写基线主键。

### 4. 偏移评估与输出边界

- 必须冻结 `platform_behavior_assessment` 输出对象，必填字段至少包含：
  - `assessment_id`
  - `profile`
  - `platform`
  - `browser_channel`
  - `execution_surface`
  - `probe_bundle_ref`
  - `runtime_context_id`
  - `proxy_binding_ref`
  - `baseline_state`
  - `drift_level`
  - `issue_scope`
  - `action_type`
  - `requested_execution_mode`
  - `effective_execution_mode`
  - `threshold_config_snapshot_ref`
  - `decision_hint`
  - `confidence`
  - `evidence_refs`
  - `assessed_at`
  - `model_version`
- 当 assessment 实际比较了 active baseline 时，还必须回填条件字段：
  - `baseline_ref`
- 当门禁链路已消费 assessment 并产出正式决策/审计对象时，还必须回填条件字段：
  - `decision_id`
  - `audit_record_ref`
- `decision_hint` 最小枚举：
  - `allow_read_only`
  - `hold_live_write`
  - `require_manual_review`
  - `require_reseed`
- Layer 4 输出是“建议”而不是“门禁最终裁决”：
  - 不得直接把风险状态从 `paused|limited|allowed` 改写为其他值
  - 必须经 `FR-0010/0011` 既有门禁链路消费
- `baseline_ref` 必须指向本次 assessment 实际比较所用的 baseline snapshot；只有在当前 scope 尚无 active baseline、assessment 处于冷启动/学习期保守判定时才允许为空。
- `threshold_config_snapshot_ref` 必须指向本次 assessment 使用的不可变阈值配置快照，确保漂移判定可重放、可审计。
- `decision_id` 与 `audit_record_ref` 只允许作为门禁消费后的审计回链，不得被解释为新增 gate result。
- `proxy_binding_ref` 只用于标注本次 assessment 对应输入批次的代理绑定证据，不参与 active baseline 选择。
- `platform_behavior_assessment` 只能比较同一 `(profile, platform, browser_channel, execution_surface, effective_execution_mode, probe_bundle_ref)` scope 内、由 registry 选中的 active baseline；不得跨 mode / probe bundle 混用。

### 5. 冷启动（cold start）与学习期约束

- 新 profile + 新 platform 默认 `baseline_state=unseeded`。
- 未完成最小学习窗口前，必须保持保守策略：
  - 允许 read 路径评估采样
  - 不允许把 Layer 4 结果用于自动放行高风险 write/live
- 学习期进入 `ready` 必须同时满足：
  - 最小样本量阈值
  - 最小时间跨度阈值
  - 样本完整性阈值（关键字段覆盖率）
- 任一阈值未满足时，`decision_hint` 必须返回 `require_manual_review` 或 `allow_read_only`。

### 6. 审计、留痕与数据最小化

- 每次 assessment 必须生成可检索审计对象，并记录：
  - 输入来源摘要
  - 评估版本
  - 阈值配置快照
  - 输出建议与证据引用
- Layer 4 不得新增并行审批对象替代 `approval_record/audit_record`。
- 原始行为信号保留期与聚合保留期必须可配置，且默认优先保留聚合摘要而非原始明细。

### 7. PR 与实现边界

- 本 FR 仅冻结 formal 套件，不混入实现代码。
- 后续实现 PR 必须先满足本 FR 的“进入实现前条件”。
- 在 `FR-0020`（`#239`）完成合并前，不得将 `FR-0022` 标记为 implementation-ready。
- `FR-0022` 进入 implementation-ready 的前置固定为：
  - `FR-0020` 已合入
  - `FR-0020` 已提供 `anti_detection_baseline_snapshot`
  - `FR-0020` 已提供 `anti_detection_baseline_registry_entry`
  - `FR-0020` 已提供 `anti_detection_validation_record`
  - `FR-0020.validation_scope=cross_layer_baseline` 已可作为 Layer 4 正式输入
- 更细的阈值冻结、假阳性/漏报研究若需进入正式契约，必须通过后续独立 spec review，不得反向要求本 FR 先承诺这些细节已冻结。
- 若实现需要扩展 `FR-0010/0011` 正式字段，必须先补充 spec review，不得边实现边改主契约。

## GWT 验收场景

### 场景 1：冷启动 profile 不会被误判为 ready

Given 一个 profile 首次进入某平台且没有历史样本  
When 触发 Layer 4 评估  
Then `baseline_state` 必须是 `unseeded` 或 `learning`  
And `decision_hint` 不能直接放行为高风险 live write

### 场景 2：学习窗口达标后可进入 ready

Given 某 profile/platform 已满足最小样本量、时间跨度和字段完整性阈值  
When 触发评估  
Then `baseline_state` 可以进入 `ready`  
And 输出必须包含可追溯 `evidence_refs`

### 场景 3：高偏移会触发保守建议

Given 当前行为分布与基线偏移达到 `high` 或 `critical`  
When 生成 assessment  
Then `decision_hint` 必须是 `hold_live_write`、`require_manual_review` 或 `require_reseed`  
And 不得自动把门禁状态写成放行

### 场景 4：Layer 4 不能直接改写门禁真相源

Given Layer 4 评估输出了 `hold_live_write`  
When 门禁链路消费该结果  
Then 最终状态仍由 `FR-0010/0011` 的流程判定  
And Layer 4 只作为风险证据输入

### 场景 5：无来源信号会被拒绝

Given 输入信号缺少 `run_id` 或 `session_id`  
When 尝试写入 `platform_behavior_signal_batch`  
Then 系统必须拒绝入库  
And 返回结构化错误而不是静默跳过

### 场景 6：跨 profile 隔离成立

Given `profile_A` 与 `profile_B` 同平台并行运行  
When Layer 4 进行基线评估  
Then 两者的基线状态与偏移评估必须完全隔离  
And 不得共享同一条可写基线真相源

### 场景 7：评估过期会降级

Given 某 profile/platform 已有 `ready` 基线
And `last_assessed_at` 已超过当前阈值快照定义的 freshness window
When 再次请求评估  
Then `baseline_state` 必须回退到 `degraded`
And 结果不能伪装成稳定 ready

### 场景 8：reseed 阈值命中后必须要求重新播种

Given 某 scope 连续命中高漂移并达到当前阈值快照定义的 reseed threshold
When 生成新的 assessment
Then `reseed_required` 必须为 `true`
And `decision_hint` 只能是 `require_manual_review` 或 `require_reseed`

### 场景 9：下载链路不会绕过 Layer 4 goal 映射

Given 一条下载链路只包含 `navigate | locate | click | extract | wait_settled`
When 进入 Layer 4 信号采样
Then 该链路必须被映射为 `goal_kind=read`
And 仍可标记为 `pure_read`

Given 一条下载链路包含 `type`、`submit`、`confirm`、`publish`、`purchase`、`dispatch` 或 `bind`
When 进入 Layer 4 信号采样
Then 该链路必须被映射为 `goal_kind=write`
And 不得标记为 `pure_read`

### 场景 10：本 PR 只做 spec review

Given 当前 PR 对应 `FR-0022`  
When reviewer 检查变更范围  
Then 只能看到 formal FR 套件文档  
And 不应包含运行时实现代码

## 异常与边界场景

1. 学习样本不足却输出 `ready + allow_read_only`：视为学习阈值失效。  
2. 漂移达到 `critical` 仍输出放行建议：视为风险边界失效。  
3. assessment 无 `evidence_refs`：视为审计链断裂。  
4. Layer 4 直接改写 `risk_state_output`：视为契约越界。  
5. 把 Layer 4 误写成“账号运营系统”：视为范围漂移。  
6. 采集了页面原文/私密输入明文：视为数据最小化违规。  
7. 跨 profile 共享可写基线导致污染：视为隔离违规。  
8. Layer 4 与 Layer 3 重复造状态机：视为并行真相源违规。  
9. 把 `require_reseed` 当成自动执行播种脚本：视为越过人工确认边界。  
10. 将 `FR-0020`（`#239`）未合入状态误标为 implementation-ready：视为流程违规。

## 验收标准

1. FR-0022 套件完整，至少包含 `spec.md`、`plan.md`、`TODO.md`、`research.md`、`risks.md`、`data-model.md`、`contracts/`。  
2. 文档已明确 Layer 4 的当前正式挂接为 `#423 -> #238`，并以 `FR-0020`（`#239`）作为验证前置。  
3. Layer 4 最小对象、状态机、漂移等级、决策建议已冻结。  
4. 文档已明确 Layer 4 不直接改写 `FR-0010/0011` 门禁真相源。  
5. 冷启动、学习期、ready、降级与 reseed 触发边界已冻结。  
6. 审计留痕与数据最小化边界已冻结。  
7. `goal_kind=read` 的 pure-read 动作约束已按 `FR-0019` 继承冻结。  
8. 下载链路进入 Layer 4 前的 `goal_kind` 映射已冻结，不再把 `download` 作为独立 Layer 4 goal 枚举。
9. 本 PR 边界明确为 spec review，不混入实现代码。

## 依赖与前置条件

- GitHub 事项：
  - `#423`
  - `#238`
  - `#239`
- 上游规约：
  - `FR-0003-min-session`
  - `FR-0010-xhs-risk-gates-hardening`
  - `FR-0011-xhs-min-anti-detection-execution`
  - `FR-0014-layer3-session-rhythm-engine`
  - `FR-0019-l2-first-usable-capability`
- 架构依据：
  - `docs/dev/architecture/anti-detection.md`
  - `docs/dev/architecture/system-design/account.md`
  - `docs/dev/architecture/system-design/execution.md`
  - `docs/dev/roadmap.md`
