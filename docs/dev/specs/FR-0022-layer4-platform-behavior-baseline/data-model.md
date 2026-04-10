# FR-0022 数据模型

## 1. `platform_behavior_signal_batch`

用途：

- 承接 Layer 3/运行时产生的结构化行为摘要，作为 Layer 4 基线输入。

最小字段：

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

可选字段：

- `session_id`
- `click_kind_mix`

补充约束：

- 输入必须可回链 `runtime.audit`；缺少 `run_id/profile_ref/platform` 任一字段时拒绝入库。
- `session_id` 只在 runtime 已提供稳定会话坐标时回填；其缺失不得单独阻断合法 batch 入库。
- `browser_channel` 当前 formal baseline 只允许 `Google Chrome stable`，并必须与 `FR-0015`、`FR-0016`、`FR-0020` 共享同一 canonical label。
- `execution_surface` 当前 formal baseline 只允许 `real_browser`；`stub | fake_host | other` 仍属于 `FR-0016` 的上游证据枚举，但不得进入 FR-0022 formal input。
- `effective_execution_mode` 必须直接复用 `FR-0010/0011` 已冻结的 execution mode 枚举：`dry_run | recon | live_read_limited | live_read_high_risk | live_write`；不得在 signal batch 中退化为自由字符串。
- `profile_ref` 必须直接复用 `FR-0020` / `FR-0003` 的 canonical profile namespace，不得并行发明 `profile` 正式键。
- `target_domain` 必须直接复用 `FR-0019.risk_gate_context.target_domain`，并继续作为 downstream baseline / assessment identity 的正式域隔离键。
- 仅允许摘要字段，不允许页面正文、输入明文、媒体内容等高敏原文数据。
- `action_mix` 至少覆盖 `navigate`、`locate`、`extract`、`click`、`wait_settled`、`type`、`submit`、`confirm`、`publish`、`purchase`、`dispatch`、`bind` 的原始计数；不允许以 ratio/百分比替代正式输入。
- `goal_kind=read` 时，`interaction_safety_class` 必须为 `pure_read`，且只允许 `navigate | locate | click | extract | wait_settled` 出现非零值；若出现 `type`、`submit`、`confirm`、`publish`、`purchase`、`dispatch`、`bind` 任一动作，不得标记为 `pure_read`。
- `action_mix.click` 只允许复用 `FR-0019` trace-side 的 `action=click + interaction_semantics=reveal_only_click`；request-side `allowed_actions=reveal_only_click` 是上游授权语义，不得在 Layer 4 被复制为新的动作枚举。
- `click_kind_mix` 用于保留 `FR-0019` 的 `click_kind` 语义；当 `action_mix.click > 0` 时必填，且其计数总和必须等于 `action_mix.click`。
- 本 FR 当前只冻结 `goal_kind=read|write`；下载链路在进入 Layer 4 前必须先被映射到这两个 goal 之一。
- 若下载链路只包含 `navigate | locate | click | extract | wait_settled`，必须映射为 `goal_kind=read`；若包含 `type`、`submit`、`confirm`、`publish`、`purchase`、`dispatch`、`bind` 或其他写入型交互，必须映射为 `goal_kind=write`。
- 下载链路进入 `platform_behavior_assessment` 后，`action_type` 必须继续记录实际交互动作，不得另起 `download` 作为新的 Layer 4 action shortcut。
- 该对象只能承接已可回链到 `FR-0020.validation_scope=cross_layer_baseline` 的共享验证输入，不得自行扩写第二套 baseline 作用域。
- `request_ref`、`sample_ref`、`record_ref` 必须直接回链到同一条 `FR-0020` formal lineage：`sample_ref` 所指向的 structured sample 必须回链到同一个 `request_ref`，且 `record_ref` 所指向的 validation record 必须同时回链该 `request_ref` 并引用该 `sample_ref`；不得只依赖 `run_id/runtime_context_id` 维持 lineage。
- `request_ref` 与 `sample_ref` 的 formal ownership 仍分别属于 `FR-0020.anti_detection_validation_request` 与 `FR-0020.anti_detection_structured_sample`；Layer 4 只允许读取这些上游对象以完成 lineage 校验，不得在本 FR 中复制它们的真相源。
- `effective_execution_mode` 与 `probe_bundle_ref` 必须继续保留在 Layer 4 输入 identity 中；不得把不同 recon/live scope 或不同 probe bundle 的共享输入合并到同一条 baseline / assessment。
- 当前 formal baseline 不把 proxy binding 作为 Layer 4 必填输入；若未来需要纳入 `proxy_binding_ref`，必须先由上游 formal contract 冻结 canonical 字段，再通过独立 spec review 引入。
- 若后续评估需要解析当前 shared upstream lineage，必须先通过 `FR-0020.anti_detection_baseline_registry_entry.active_baseline_ref` 解析，再选择同 scope 的 `platform_behavior_baseline_snapshot` 作为实际 drift comparison object；不得直接把 upstream `active_baseline_ref` 当作下游比较对象。

## 2. `platform_behavior_baseline_snapshot`

用途：

- 记录某个 downstream scope 的 Layer 4 drift baseline 快照；它是 `FR-0022` 自有的比较对象，不等于 `FR-0020` 的 shared upstream baseline snapshot。

最小字段：

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

补充约束：

- `baseline_ref` 是 `FR-0022` 自有的 downstream drift baseline 标识，不得与 `FR-0020.anti_detection_baseline_snapshot.baseline_ref` 复用为同一对象。
- `effective_execution_mode` 必须继续直接复用 `FR-0010/0011` 已冻结的 execution mode 枚举；不得在 downstream baseline snapshot 中允许自由字符串覆盖 shared gate mode。
- `(profile_ref, platform, target_domain, browser_channel, execution_surface, effective_execution_mode, probe_bundle_ref, goal_kind, baseline_ref)` 必须唯一；不同 downstream scope 不得共享同一条 `baseline_ref`。
- `upstream_active_baseline_ref` 必须直接记录生成该 downstream baseline 时，对应 shared upstream scope 的 `FR-0020.anti_detection_baseline_registry_entry.active_baseline_ref`。
- 多个 downstream scope 允许并行引用同一条 `upstream_active_baseline_ref`，但必须各自拥有独立的 `baseline_ref`。
- `source_batch_refs` 必须非空，且只能引用同一 downstream scope 内、同一 shared upstream lineage 下的 `platform_behavior_signal_batch`。
- `behavior_vector` 只允许保留结构化聚合字段，不得退化为页面正文、私密输入或自由文本摘要。
- 当 `behavior_vector.action_mix.click > 0` 时，`behavior_vector.click_kind_mix` 必须存在，且总计数必须等于 `behavior_vector.action_mix.click`。
- `goal_kind=read` 的 downstream baseline snapshot 只允许沉淀 `pure_read` 合法动作，不得把非读动作写入 read snapshot。

## 3. `platform_behavior_baseline_state`

用途：

- 记录 `(profile_ref, platform, target_domain, browser_channel, execution_surface, effective_execution_mode, probe_bundle_ref, goal_kind)` 维度的长期行为基线状态。

最小字段：

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

条件字段：

- `ready_at`
  - 仅 `baseline_state=ready` 时必填
- `learning_window_started_at`
  - 仅 `baseline_state=learning|ready|degraded` 时必填
  - `baseline_state=unseeded` 时必须允许为空或缺失
- `last_assessed_at`
  - 尚未形成 assessment 前允许为空
  - 一旦状态对象已被至少一次 assessment 消费，后续写回不得继续缺失
- `baseline_ref`
  - 当前状态已绑定到该 downstream scope 的 `platform_behavior_baseline_snapshot.baseline_ref` 时必填
  - 记录当前可写状态正在消费的下游 drift baseline，而不是 shared upstream baseline 本身
  - `unseeded | learning` 阶段允许为空

`baseline_state` 允许值：

- `unseeded`
- `learning`
- `ready`
- `degraded`

`drift_level` 允许值：

- `none`
- `low`
- `medium`
- `high`
- `critical`

补充约束：

- `(profile_ref, platform, target_domain, browser_channel, execution_surface, effective_execution_mode, probe_bundle_ref, goal_kind)` 是可写隔离主键，不允许跨 profile、域名、浏览器通道、执行面、执行模式、probe bundle 或 read/write 目标共用同一可写状态对象。
- `effective_execution_mode` 必须继续直接复用 `FR-0010/0011` 已冻结的 execution mode 枚举；不得在 baseline state 中允许任意 mode 标签进入可写隔离主键。
- `runtime_context_id` 仅用于 run/session 证据回链，不进入可写基线主键。
- `baseline_ref` 一旦存在，必须引用同 scope 的 `platform_behavior_baseline_snapshot.baseline_ref`，不得再用未定义的 `baseline_version` 作为并行标识。
- `platform`、`target_domain` 与 `goal_kind` 是 `FR-0022` 自己的 downstream writable scope keys，不属于 `FR-0020` registry 的 shared upstream scope；同一条上游 `active_baseline_ref` 可以被多个 downstream scope 作为 shared lineage 输入并行引用，但不得把这些 scope 的学习状态、漂移状态或 assessment 历史折叠到同一条可写状态对象，也不得共用同一条 downstream `baseline_ref`。
- `threshold_config_snapshot_ref` 必须指向最近一次生成该状态所用的不可变阈值快照；若阈值快照变化，必须重新评估该状态是否继续有效，必要时降级或触发 reseed。
- `baseline_state=unseeded` 时，`learned_sample_count` 必须允许为 `0`，且不得伪造 `baseline_ref`、`ready_at` 或已开始学习窗口的时间戳。
- `ready` 只能在学习阈值达标后进入；阈值不足必须保持在 `learning` 或降级为 `degraded`。
- 若先前 `ready` 基线已超过当前阈值快照定义的 freshness window，或同 scope 最新 assessment 返回 `drift_level=high|critical`，则必须降级为 `degraded`。
- 若最新样本批次未通过字段完整性或证据回链校验，导致 ready 基线不再可直接信任，则必须降级为 `degraded` 或回退到 `learning`。
- 当当前 `baseline_ref` 所指向的 `platform_behavior_baseline_snapshot.upstream_active_baseline_ref` 已不再等于对应 shared upstream scope 的 `FR-0020.anti_detection_baseline_registry_entry.active_baseline_ref`、检测到 scope 污染/隔离破坏，或同 scope 持续 `degraded`/重复 `high|critical` 已达到当前阈值快照定义的 reseed threshold 时，必须置 `reseed_required=true`。
- `reseed_required=true` 时不得把状态误报为稳定 `ready`。
- `reseed_required=true` 时，下游评估只能收敛到 `require_manual_review` 或 `require_reseed`，直到新学习周期重新建立。

## 4. `platform_behavior_assessment`

用途：

- 记录一次 Layer 4 偏移评估结果，供门禁链路消费为风险证据。

最小字段：

- `assessment_id`
- `profile_ref`
- `platform`
- `target_domain`
- `browser_channel`
- `execution_surface`
- `probe_bundle_ref`
- `goal_kind`
- `runtime_context_id`
- `threshold_config_snapshot_ref`
- `baseline_state`
- `drift_level`
- `action_type`
- `requested_execution_mode`
- `effective_execution_mode`
- `decision_hint`
- `confidence`
- `evidence_refs`
- `assessed_at`
- `model_version`

条件字段：

- `baseline_ref`
  - 本次 assessment 实际比较了 `platform_behavior_baseline_snapshot` 时必填
  - 仅在当前 scope 尚无可用 downstream drift baseline、assessment 处于冷启动/学习期保守判定时允许为空
- `decision_id`
- `audit_record_ref`
  - 仅在门禁链路已消费 assessment 并产出正式决策/审计对象时必填
  - 未消费前必须同时为空
- `interaction_semantics`
- `click_kind`
  - 仅在 `action_type=click` 时必填
  - `interaction_semantics` 当前只允许 `reveal_only_click`

`decision_hint` 允许值：

- `allow_read_only`
- `no_additional_restriction`
- `hold_live_write`
- `require_manual_review`
- `require_reseed`

补充约束：

- `decision_hint` 是建议，不是门禁最终结果；不得直接覆盖 `FR-0010/0011` 最终状态字段。
- `decision_hint=no_additional_restriction` 只表示 Layer 4 对当前 write-path assessment 不新增额外降级/阻断建议，不等于 live write 自动放行。
- `FR-0022` 作为平台通用的 Layer 4 assessment 数据模型，不冻结 XHS 专用 `issue_scope`；若 `FR-0011` 等下游 gate consumer 需要 `issue_208 | issue_209 | shared` 之类的 issue taxonomy，必须在消费 assessment 时由 consumer context 派生或补充，不得写回 Layer 4 核心对象。
- `requested_execution_mode` 与 `effective_execution_mode` 必须直接复用 `FR-0010/0011` 已冻结的 execution mode 枚举：`dry_run | recon | live_read_limited | live_read_high_risk | live_write`；不得在 Layer 4 assessment 中扩写私有 mode。
- `decision_hint=no_additional_restriction` 仅允许在 `goal_kind=write`、对应 downstream `platform_behavior_baseline_state` 已处于 `ready`、未标记 `reseed_required=true`，并且本次 assessment 的 `drift_level=none|low` 时出现；它不得被解释为 write-ready 例外规则或 `gate_decision=allowed` 代理。
- `evidence_refs` 至少能回链到输入批次或运行审计记录，禁止“无证据评估”。
- `threshold_config_snapshot_ref` 必须指向本次 assessment 使用的不可变阈值配置快照，确保漂移判定可重放、可审计。
- `decision_id` 与 `audit_record_ref` 仅用于门禁消费后的审计回链，不构成新的 gate result 对象。
- `action_type` 必须落在稳定动作集合 `navigate | locate | click | extract | wait_settled | type | submit | confirm | publish | purchase | dispatch | bind` 内，不得并行引入 `download` 等新的 Layer 4 动作快捷值。
- `action_type=click` 时，`interaction_semantics` 必须固定为 `reveal_only_click`，且 `click_kind` 必须保留对应的 `FR-0019` reveal-only click kind。
- `platform_behavior_assessment` 只能比较同一 `(profile_ref, platform, target_domain, browser_channel, execution_surface, effective_execution_mode, probe_bundle_ref, goal_kind)` downstream scope 内的 `platform_behavior_baseline_snapshot`。
- `FR-0020.anti_detection_baseline_registry_entry.active_baseline_ref` 只负责 upstream active baseline ownership 与 lineage admission；它不是 Layer 4 drift evaluation 直接比较的 downstream baseline object。
- 同一条 shared upstream `active_baseline_ref` 可以被多个 downstream scope 的 assessment 并行引用，但不得因此合并不同 scope 的学习/ready/degraded/reseed 状态，也不得共用同一条 downstream `baseline_ref`。
- `confidence` 必须在 `[0,1]`，用于表达评估可信度，不可当作放行开关。

## 5. 与既有对象的关系

- 与 `FR-0020`：
  - Layer 4 只消费 `anti_detection_validation_request`、`anti_detection_structured_sample`、`anti_detection_baseline_snapshot`、`anti_detection_baseline_registry_entry` 与 `anti_detection_validation_record`。
  - `anti_detection_validation_view` 是上游派生读模型，不作为 Layer 4 baseline identity 的正式输入或真相源。
  - `validation_scope=cross_layer_baseline` 是唯一正式输入入口；`FR-0022` 可以拥有自己的 downstream `platform_behavior_baseline_snapshot`，但不得并行重定义 `FR-0020` 已拥有的 baseline snapshot / registry / validation record 真相源。
  - `FR-0022` 当前把 `target_fr_ref=FR-0022` 与 `validation_scope=cross_layer_baseline` 视为固定 lane 常量；`target_fr_ref` 必须继续复用 `FR-0020` 的 FR 标识语义，不得改写为 GitHub issue 号；二者必须受上游 formal contract 约束，但不在 Layer 4 writable identity 中重复落库。
  - active baseline 的唯一正式判定来源是 `anti_detection_baseline_registry_entry.active_baseline_ref`；Layer 4 不得仅凭 snapshot / record 自行宣布某条 baseline 仍为当前生效。
  - `FR-0020` registry 的 shared upstream scope 只有 `(target_fr_ref, validation_scope, profile_ref, browser_channel, execution_surface, effective_execution_mode, probe_bundle_ref)`；`platform`、`target_domain` 与 `goal_kind` 只属于 `FR-0022` downstream writable scope，不得被倒灌为上游 registry key。
  - 同一条 shared upstream `active_baseline_ref` 可以被多个 `(platform, target_domain, goal_kind)` downstream scope 作为共同 lineage 输入并行引用；隔离要求约束的是下游 `platform_behavior_baseline_snapshot` / `platform_behavior_baseline_state` / assessment 对象与历史，不是禁止共享该上游引用本身。
  - `platform_behavior_signal_batch` 必须携带 `request_ref`、`sample_ref`、`record_ref`，并保持三者属于同一条 `FR-0020` formal lineage。
  - `effective_execution_mode` 与 `probe_bundle_ref` 是 shared scope keys；Layer 4 baseline identity 必须保留这两个维度，不得把不同 mode / bundle 的 baseline 混写到同一状态对象。
  - 当前 `FR-0022` 不把 proxy binding 纳入 implementation-ready formal 输入；若未来需要 canonical `proxy_binding_ref`，必须先由上游 formal contract 暴露后再进入独立 spec review。
- 与 `FR-0014`：
  - Layer 4 读取 session 节律摘要，但不重定义 Layer 3 状态机。
- 与 `FR-0010/0011`：
  - Layer 4 仅提供 `decision_hint` 与证据，不替代审批/门禁主链。
- 与 `FR-0019`：
  - read lane 必须继承 `goal_kind=read -> interaction_safety_class=pure_read`，且遵守 pure-read 动作白名单。
  - `risk_gate_context.target_domain` 是 read/write 域隔离的正式坐标；Layer 4 baseline identity 必须继续保留该字段，不能把不同域名的样本混入同一 scope。
  - `action_mix.click` 与 `action_type=click` 必须继续保留 `interaction_semantics=reveal_only_click` 与对应 `click_kind`，不得把 reveal-only click 退化成不可解释的裸点击计数。
  - `type`、`submit`、`confirm`、`publish`、`purchase`、`dispatch`、`bind` 都属于当前 formal baseline 必须稳定编码的非读动作；只要出现，均不得继续落在 `pure_read`。
- 与 `FR-0003`：
  - `profile_ref/session` 维度是 Layer 4 的身份坐标真相源。
