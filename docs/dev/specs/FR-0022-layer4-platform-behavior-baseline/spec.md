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
  - `FR-0022` 只把 `FR-0020` 已冻结的 formal object family 作为 shared upstream input：`anti_detection_validation_request`、`anti_detection_structured_sample`、`anti_detection_baseline_snapshot`、`anti_detection_baseline_registry_entry` 与 `anti_detection_validation_record`
  - `anti_detection_validation_view` 是上游派生读模型，不作为 Layer 4 baseline identity 的正式输入或真相源
  - `validation_scope=cross_layer_baseline` 是 Layer 4 唯一正式编码入口
  - `FR-0022` 允许拥有自己的 downstream behavior object family：`platform_behavior_signal_batch`、`platform_behavior_baseline_snapshot`、`platform_behavior_baseline_state`、`platform_behavior_assessment`；但不得重定义 `FR-0020` 已拥有的 baseline snapshot / registry / validation record 真相源
  - `FR-0022` 当前把 `target_fr_ref=FR-0022` 与 `validation_scope=cross_layer_baseline` 视为固定 lane 常量；`target_fr_ref` 必须继续复用 `FR-0020` 的 FR 标识语义，而不是改写成 GitHub issue 号；二者必须显式受上游 formal contract 约束，但不在 Layer 4 writable identity 中重复落库
  - `anti_detection_baseline_registry_entry.active_baseline_ref` 是 Layer 4 唯一允许消费的 active baseline 判定来源；不得仅凭 snapshot / validation record 自行宣布某条 baseline 仍为当前生效
  - `FR-0020` registry 的 shared upstream scope 固定为 `(target_fr_ref=FR-0022, validation_scope=cross_layer_baseline, profile_ref, browser_channel, execution_surface, effective_execution_mode, probe_bundle_ref)`；`platform`、`target_domain` 与 `goal_kind` 属于 `FR-0022` 自己的 downstream drift baseline scope，不得被倒灌成上游 registry key
  - 同一条上游 `active_baseline_ref` 可以被多个 `(platform, target_domain, goal_kind)` downstream scope 并行引用为 shared lineage input；但每个 downstream scope 都必须生成并维护自己的 `platform_behavior_baseline_snapshot` / `platform_behavior_baseline_state`，不得把多个 scope 的 drift baseline 折叠为同一条 `baseline_ref`
- Layer 4 输出只能作为 `risk decision hint`，不能直接覆盖门禁最终判定。
- `goal_kind=read` 时必须继承 `FR-0019` 的 `interaction_safety_class=pure_read` 语义：
  - 仅允许动作 `navigate | locate | click | extract | wait_settled`
  - 其中 Layer 4 的 `click` 只复用 `FR-0019` trace-side 的 `action=click + interaction_semantics=reveal_only_click`；request-side `allowed_actions=reveal_only_click` 仍留在上游授权语义，不在本 FR 内复制为新的 action enum
  - 只要出现 `type`、`submit`、`confirm`、`publish`、`purchase`、`dispatch` 或 `bind`，不得标记为 `pure_read`
- Layer 4 baseline identity 必须继续保留 `FR-0019.risk_gate_context.target_domain` 的正式域隔离，不得把不同域名的样本、基线或 assessment 混入同一条可写状态。
- 本 FR 当前只冻结 `goal_kind=read|write` 两类 Layer 4 输入；`download` 不作为独立 Layer 4 goal 枚举冻结。
- 下载链路在进入 Layer 4 前必须完成正式映射：
  - 若下载来源解析只包含 `navigate | locate | click | extract | wait_settled`，必须映射为 `goal_kind=read` 并继续满足 `pure_read`
  - 若下载链路包含 `type`、`submit`、`confirm`、`publish`、`purchase`、`dispatch`、`bind` 或其他写入型交互，必须映射为 `goal_kind=write`，且不得标记为 `pure_read`
- 下载链路进入 `platform_behavior_assessment` 后，`action_type` 必须继续记录实际交互动作（至少覆盖 `navigate`、`locate`、`click`、`extract`、`wait_settled`、`type`、`submit`、`confirm`、`publish`、`purchase`、`dispatch`、`bind`），不得平行引入 `download` 作为新的 Layer 4 action shortcut。

### 2. Layer 4 最小对象与状态机

- 必须冻结以下正式对象：
  - `platform_behavior_signal_batch`
  - `platform_behavior_baseline_snapshot`
  - `platform_behavior_baseline_state`
  - `platform_behavior_assessment`
- `platform_behavior_baseline_snapshot` 的最小必填字段至少包含：
  - `baseline_ref`
  - `profile_ref`
  - `platform`
  - `target_domain`
  - `browser_channel`
  - `execution_surface`
  - `effective_execution_mode`
  - `probe_bundle_ref`
  - `goal_kind`
  - `upstream_active_baseline_ref`
  - `threshold_config_snapshot_ref`
  - `behavior_vector`
  - `source_batch_refs`
  - `captured_at`
- `platform_behavior_baseline_snapshot` 的正式边界必须冻结为：
  - `baseline_ref` 是 `FR-0022` 自有的 downstream drift baseline 标识，不得与 `FR-0020.anti_detection_baseline_snapshot.baseline_ref` 混用为同一对象
  - `upstream_active_baseline_ref` 必须记录生成该 downstream baseline 时所依赖的 `FR-0020` shared upstream active baseline
  - 多个 `(platform, target_domain, goal_kind)` downstream scope 可以共享同一条 `upstream_active_baseline_ref`，但必须拥有各自独立的 `baseline_ref`
  - `source_batch_refs` 必须非空，且只能引用同一 downstream scope 内、同一 shared upstream lineage 下的 `platform_behavior_signal_batch`
  - 当 `behavior_vector.action_mix.click > 0` 时，`behavior_vector.click_kind_mix` 必须存在，且总计数必须等于 `action_mix.click`
  - `goal_kind=read` 的 downstream baseline snapshot 只允许沉淀 `pure_read` 合法动作，不得把非读动作写入 read snapshot
- `platform_behavior_baseline_state` 的最小必填字段至少包含：
  - `profile_ref`
  - `platform`
  - `target_domain`
  - `browser_channel`
  - `execution_surface`
  - `effective_execution_mode`
  - `probe_bundle_ref`
  - `goal_kind`
  - `threshold_config_snapshot_ref`
  - `baseline_state`
  - `learned_sample_count`
  - `drift_level`
  - `reseed_required`
- `platform_behavior_baseline_state` 的条件字段必须固定为：
  - `learning_window_started_at`：仅 `baseline_state=learning|ready|degraded` 时必填；`unseeded` 时必须允许为空或缺失
  - `ready_at`：仅 `baseline_state=ready` 时必填
  - `last_assessed_at`：只要该状态对象已被至少一次 assessment 消费，就必须可回填
  - `baseline_ref`：当前状态已绑定到该 downstream scope 的 `platform_behavior_baseline_snapshot.baseline_ref` 时必填；它记录当前可写状态正在消费的下游 drift baseline，而不是 shared upstream baseline 本身；`unseeded | learning` 阶段允许为空
- `baseline_state=unseeded` 时，`learned_sample_count` 必须允许为 `0`，且不得伪造 `baseline_ref`、`ready_at` 或已开始学习窗口的时间戳。
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
  - 当前 `platform_behavior_baseline_state.baseline_ref` 所指向的 `platform_behavior_baseline_snapshot.upstream_active_baseline_ref` 已不再等于对应 shared upstream scope 的 `FR-0020.anti_detection_baseline_registry_entry.active_baseline_ref`
  - 检测到多个 `(platform, target_domain, goal_kind)` downstream scope 的样本、downstream baseline 或学习状态被错误折叠到同一条可写状态对象
  - 检测到跨 `(profile_ref, platform, target_domain, browser_channel, execution_surface, effective_execution_mode, probe_bundle_ref, goal_kind)` scope 的样本污染或隔离破坏
  - 同 scope 持续处于 `degraded`，或重复出现 `high|critical` 漂移，且已达到当前 `threshold_config_snapshot_ref` 定义的 reseed threshold
- 一旦 `reseed_required=true`，`baseline_state` 不得继续保持稳定 `ready`；下游 `decision_hint` 只能收敛到 `require_manual_review` 或 `require_reseed`，直到新学习周期重新建立。

### 3. 信号采集与归一化边界

- Layer 4 只接收结构化行为摘要，不接收页面原文、用户输入原文或媒体内容。
- `platform_behavior_signal_batch` 最小字段必须包含：
  - `batch_id`
  - `request_ref`
  - `sample_ref`
  - `record_ref`
  - `run_id`
  - `profile_ref`
  - `platform`
  - `browser_channel`
  - `execution_surface`
  - `effective_execution_mode`
  - `probe_bundle_ref`
  - `runtime_context_id`
  - `target_domain`
  - `goal_kind`
  - `interaction_safety_class`
  - `observed_at`
  - `action_mix`
  - `timing_summary`
  - `risk_feedback_signals`
- `click_kind_mix` 只在 `action_mix.click > 0` 时必填。
- `browser_channel` 在当前 formal baseline 下只允许 `Google Chrome stable`，并必须与 `FR-0015`、`FR-0016`、`FR-0020` 共享同一 canonical label。
- `execution_surface` 的语义必须复用 `FR-0016` 已冻结枚举；但当前 implementation-ready formal input 只接受 `real_browser`，`stub | fake_host | other` 只允许停留在上游 live evidence，不得进入 Layer 4 signal batch / baseline / assessment。
- `platform_behavior_signal_batch`、`platform_behavior_baseline_snapshot`、`platform_behavior_baseline_state`、`platform_behavior_assessment` 中的 `effective_execution_mode` 都必须直接复用 `FR-0010/0011` 已冻结的 execution mode 枚举：`dry_run | recon | live_read_limited | live_read_high_risk | live_write`；不得在 Layer 4 formal object 中退化为自由字符串。
- `profile_ref` 必须直接复用 `FR-0020` / `FR-0003` 的 canonical profile namespace，不得并行发明 `profile` 正式键。
- `target_domain` 必须直接复用 `FR-0019.risk_gate_context.target_domain` 的 canonical 域坐标，不得在 Layer 4 baseline identity 中被丢弃。
- `platform_behavior_signal_batch` 只能承接已可回链到 `FR-0020.validation_scope=cross_layer_baseline` 的运行摘要输入，不得独立形成并行 baseline 作用域。
- Layer 4 若需要判定当前 active baseline，必须通过 `FR-0020.anti_detection_baseline_registry_entry` 解析，而不是直接把任意 snapshot / record 当作当前生效基线。
- Layer 4 必须区分两层 scope：`FR-0020` registry 负责 shared upstream scope 的 active baseline ownership；`FR-0022` 自己负责 `(profile_ref, platform, target_domain, browser_channel, execution_surface, effective_execution_mode, probe_bundle_ref, goal_kind)` 的 downstream writable isolation。不得把 `platform/target_domain` 倒灌为上游 registry selector。
- `goal_kind=read` 与 `goal_kind=write` 的 Layer 4 baseline / assessment 不得共享同一条可写状态；同一平台与域名上的读历史不得被直接当作写路径基线，反之亦然。
- Layer 4 不得把不同 `effective_execution_mode` 或不同 `probe_bundle_ref` 的共享输入合并到同一条 baseline state / drift assessment。
- `request_ref`、`sample_ref`、`record_ref` 必须直接回链到同一条 `FR-0020` formal lineage：`sample_ref` 所指向的 structured sample 必须回链到同一个 `request_ref`，且 `record_ref` 所指向的 validation record 必须同时回链该 `request_ref` 并引用该 `sample_ref`；不得只靠 `run_id/runtime_context_id` 维持 Layer 4 lineage。
- `request_ref` 与 `sample_ref` 的 formal ownership 仍分别属于 `anti_detection_validation_request` 与 `anti_detection_structured_sample`；Layer 4 只允许读取这些上游对象以完成 lineage 校验，不得在本 FR 内复制它们的真相源。
- 当前 `FR-0022` 不把 proxy binding 纳入 implementation-ready formal 输入；若未来需要 canonical `proxy_binding_ref`，必须先由上游 formal contract 冻结后再进入独立 spec review。
- 信号必须可回链到 `runtime.audit` 与 session 证据，不允许“无来源信号”进入基线计算。
- `session_id` 只在 runtime 已提供稳定会话坐标时回填；缺少 `session_id` 不得单独阻断合法 batch 入库。
- 缺少 `run_id/profile_ref/platform` 任一主键坐标时，必须拒绝入库并输出结构化错误。
- `action_mix` 必须显式包含 `click`、`wait_settled`、`confirm`、`publish`、`purchase`、`dispatch`、`bind` 等动作计数，确保 `FR-0019` 的 trace 语义与 pure-read 禁止集合可以被稳定编码。
- 当 `action_mix.click > 0` 时，必须同时保留 `click_kind_mix`，其计数总和必须等于 `action_mix.click`，并只允许承接 `FR-0019` reveal-only click kinds。
- `platform_behavior_baseline_state` 可写主键必须为 `(profile_ref, platform, target_domain, browser_channel, execution_surface, effective_execution_mode, probe_bundle_ref, goal_kind)`。
- `runtime_context_id` 只允许作为 run/session 证据回链字段，不能进入可写基线主键。

### 4. 偏移评估与输出边界

- 必须冻结 `platform_behavior_assessment` 输出对象，必填字段至少包含：
  - `assessment_id`
  - `profile_ref`
  - `platform`
  - `target_domain`
  - `browser_channel`
  - `execution_surface`
  - `probe_bundle_ref`
  - `goal_kind`
  - `runtime_context_id`
  - `baseline_state`
  - `drift_level`
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
- 当 `action_type=click` 时，还必须回填条件字段：
  - `interaction_semantics`
  - `click_kind`
- `decision_hint` 最小枚举：
  - `allow_read_only`
  - `no_additional_restriction`
  - `hold_live_write`
  - `require_manual_review`
  - `require_reseed`
- `decision_hint=no_additional_restriction` 只表示 Layer 4 对当前 write-path assessment 不新增额外降级/阻断建议；它不是 live write 自动放行信号，最终门禁状态仍必须由 `FR-0010/0011` 决定。
- `FR-0022` 是平台通用的 Layer 4 contract，不冻结 XHS 专用 `issue_scope`；若 `FR-0011` 等下游 gate consumer 需要 `issue_208 | issue_209 | shared` 之类的 issue taxonomy，必须在消费 assessment 时由 consumer context 派生或补充，不得写回 Layer 4 核心对象。
- `requested_execution_mode` 与 `effective_execution_mode` 必须直接复用 `FR-0010/0011` 已冻结的 execution mode 枚举：`dry_run | recon | live_read_limited | live_read_high_risk | live_write`；不得在 Layer 4 assessment 中扩写私有 mode。
- Layer 4 输出是“建议”而不是“门禁最终裁决”：
  - 不得直接把风险状态从 `paused|limited|allowed` 改写为其他值
  - 必须经 `FR-0010/0011` 既有门禁链路消费
- `baseline_ref` 必须指向本次 assessment 实际比较所用的 `platform_behavior_baseline_snapshot.baseline_ref`；只有在当前 scope 尚无可用 downstream drift baseline、assessment 处于冷启动/学习期保守判定时才允许为空。
- `threshold_config_snapshot_ref` 必须指向本次 assessment 使用的不可变阈值配置快照，确保漂移判定可重放、可审计。
- `platform_behavior_baseline_state` 也必须持久化 `threshold_config_snapshot_ref`，明确该状态最后一次被学习/降级/reseed 判定时使用的阈值快照；阈值变更后不得静默沿用旧状态解释新结果。
- `decision_id` 与 `audit_record_ref` 只允许作为门禁消费后的审计回链，不得被解释为新增 gate result。
- `action_type=click` 时，`interaction_semantics` 必须固定为 `reveal_only_click`，且 `click_kind` 必须保留对应的 `FR-0019` reveal-only click kind。
- `platform_behavior_assessment` 只能比较同一 `(profile_ref, platform, target_domain, browser_channel, execution_surface, effective_execution_mode, probe_bundle_ref, goal_kind)` downstream scope 内的 `platform_behavior_baseline_snapshot`；不得跨域、跨 mode、跨 probe bundle 或跨 goal 混用。
- `FR-0020.anti_detection_baseline_registry_entry.active_baseline_ref` 只负责 upstream active baseline ownership 与 lineage admission；它不是 Layer 4 drift evaluation 直接比较的 downstream baseline object。
- 多个 downstream scope 可以各自绑定到同一条 shared upstream `active_baseline_ref`，但每个 scope 都必须比较自己的 `platform_behavior_baseline_snapshot.baseline_ref`，不得因为上游 lineage 共用而复用同一条下游 drift baseline。

### 5. 冷启动（cold start）与学习期约束

- 新 profile + 新 platform 默认 `baseline_state=unseeded`。
- 未完成最小学习窗口前，必须保持保守策略：
  - 允许 read 路径评估采样
  - 不允许把 Layer 4 结果用于自动放行高风险 write/live
- 学习期进入 `ready` 必须同时满足：
  - 最小样本量阈值
  - 最小时间跨度阈值
  - 样本完整性阈值（关键字段覆盖率）
- `goal_kind=read` 且任一阈值未满足时，`decision_hint` 必须返回 `allow_read_only` 或 `require_manual_review`。
- `goal_kind=write` 且任一阈值未满足时，`decision_hint` 必须返回 `hold_live_write` 或 `require_manual_review`。
- `decision_hint=no_additional_restriction` 仅允许在 `goal_kind=write`、`baseline_state=ready`、`drift_level=none|low`、`reseed_required=false` 时出现；它的语义仅是“不新增 gate restriction”，不得被解释为 write-ready 例外规则或 `gate_decision=allowed` 代理。

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
  - `FR-0020` 已提供 `anti_detection_validation_request`
  - `FR-0020` 已提供 `anti_detection_structured_sample`
  - `FR-0020` 已提供 `anti_detection_baseline_snapshot`
  - `FR-0020` 已提供 `anti_detection_baseline_registry_entry`
  - `FR-0020` 已提供 `anti_detection_validation_record`
  - `FR-0020.validation_scope=cross_layer_baseline` 已可作为 Layer 4 正式输入
  - `FR-0019.risk_gate_context.target_domain` 已在 Layer 4 baseline identity 中被保留
  - 当前 formal input 已明确收紧到 `execution_surface=real_browser`
- 更细的阈值冻结、假阳性/漏报研究若需进入正式契约，必须通过后续独立 spec review，不得反向要求本 FR 先承诺这些细节已冻结。
- 若实现需要扩展 `FR-0010/0011` 正式字段，必须先补充 spec review，不得边实现边改主契约。

## GWT 验收场景

### 场景 1：冷启动 profile 不会被误判为 ready

Given 一个 profile 首次进入某平台且没有历史样本
When 触发 Layer 4 评估
Then `baseline_state` 必须是 `unseeded` 或 `learning`
And `decision_hint` 不能直接放行为高风险 live write
And `goal_kind=write` 时不得返回 `no_additional_restriction`
And 若 `baseline_state=unseeded`，则 `learning_window_started_at` 必须允许为空或缺失
And `learned_sample_count` 必须允许为 `0`
And `baseline_ref` 与 `ready_at` 不得被伪造为已学习/已就绪

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

Given 输入信号缺少 `run_id`
When 尝试写入 `platform_behavior_signal_batch`  
Then 系统必须拒绝入库  
And 返回结构化错误而不是静默跳过

Given 输入信号缺少 `session_id`
And 仍具备 `run_id/profile_ref/platform/request_ref/sample_ref/record_ref`
When 尝试写入 `platform_behavior_signal_batch`
Then 系统不得仅因缺少 `session_id` 就拒绝该批次
And 仍需保持 `runtime.audit` 回链与 `FR-0020` lineage keys 完整

### 场景 6：共享 upstream lineage 不会折叠下游 baseline

Given 同一 profile/browser/mode/probe bundle 下有两个不同的 `(platform, target_domain, goal_kind)` downstream scope
And 它们当前引用同一条 `FR-0020.anti_detection_baseline_registry_entry.active_baseline_ref`
When Layer 4 为这两个 scope 建立 drift baseline
Then 两者必须生成不同的 `platform_behavior_baseline_snapshot.baseline_ref`
And 两者的 `platform_behavior_baseline_state` 与 assessment 历史必须完全隔离

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
And 若存在 `click`，则必须同时保留 `interaction_semantics=reveal_only_click` 与对应 `click_kind`

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

1. 学习样本不足却输出 `ready + allow_read_only`，或 write-path 输出 `ready + no_additional_restriction`：视为学习阈值失效。
2. `goal_kind=write` 在 `drift_level=high|critical`、`reseed_required=true` 或其他保守条件下仍输出 `no_additional_restriction`：视为风险边界失效。
3. 把 `FR-0020.active_baseline_ref` 直接当作多个 platform/domain/goal scope 共用的 downstream `baseline_ref`：视为 drift baseline 边界设计错误。
4. assessment 无 `evidence_refs`：视为审计链断裂。
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
