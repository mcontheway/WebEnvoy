# FR-0022 数据模型

## 1. `platform_behavior_signal_batch`

用途：

- 承接 Layer 3/运行时产生的结构化行为摘要，作为 Layer 4 基线输入。

最小字段：

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

补充约束：

- 输入必须可回链 `runtime.audit`；缺少 `run_id/session_id/profile/platform` 任一字段时拒绝入库。
- `browser_channel` 当前 formal baseline 只允许 `Google Chrome stable`，并必须与 `FR-0015`、`FR-0016`、`FR-0020` 共享同一 canonical label。
- `execution_surface` 必须复用 `FR-0016` 已冻结枚举：`real_browser | stub | fake_host | other`。
- 仅允许摘要字段，不允许页面正文、输入明文、媒体内容等高敏原文数据。
- `action_mix` 至少覆盖 `navigate`、`locate`、`extract`、`click`、`wait_settled`、`type`、`submit`、`confirm`、`publish`、`purchase`、`dispatch`、`bind` 的计数或比率。
- `goal_kind=read` 时，`interaction_safety_class` 必须为 `pure_read`，且只允许 `navigate | locate | click | extract | wait_settled` 出现非零值；若出现 `type`、`submit`、`confirm`、`publish`、`purchase`、`dispatch`、`bind` 任一动作，不得标记为 `pure_read`。
- `action_mix.click` 只允许复用 `FR-0019` trace-side 的 `action=click + interaction_semantics=reveal_only_click`；request-side `allowed_actions=reveal_only_click` 是上游授权语义，不得在 Layer 4 被复制为新的动作枚举。
- 本 FR 当前只冻结 `goal_kind=read|write`；下载链路在进入 Layer 4 前必须先被映射到这两个 goal 之一。
- 若下载链路只包含 `navigate | locate | click | extract | wait_settled`，必须映射为 `goal_kind=read`；若包含 `type`、`submit`、`confirm`、`publish`、`purchase`、`dispatch`、`bind` 或其他写入型交互，必须映射为 `goal_kind=write`。
- 下载链路进入 `platform_behavior_assessment` 后，`action_type` 必须继续记录实际交互动作，不得另起 `download` 作为新的 Layer 4 action shortcut。
- 该对象只能承接已可回链到 `FR-0020.validation_scope=cross_layer_baseline` 的共享验证输入，不得自行扩写第二套 baseline 作用域。
- `effective_execution_mode` 与 `probe_bundle_ref` 必须继续保留在 Layer 4 输入 identity 中；不得把不同 recon/live scope 或不同 probe bundle 的共享输入合并到同一条 baseline / assessment。
- `proxy_binding_ref` 只用于记录本次批次的代理绑定证据；当前不得把它提升为 `FR-0020` registry 并不存在的 active baseline scope key。
- 若后续评估需要选择当前 active baseline，必须先通过 `FR-0020.anti_detection_baseline_registry_entry.active_baseline_ref` 解析，再回链对应 snapshot / record。

## 2. `platform_behavior_baseline_state`

用途：

- 记录 `(profile, platform, browser_channel, execution_surface, effective_execution_mode, probe_bundle_ref)` 维度的长期行为基线状态。

最小字段：

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

条件字段：

- `ready_at`
  - 仅 `baseline_state=ready` 时必填
- `last_assessed_at`
  - 尚未形成 assessment 前允许为空
  - 一旦状态对象已被至少一次 assessment 消费，后续写回不得继续缺失

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

- `(profile, platform, browser_channel, execution_surface, effective_execution_mode, probe_bundle_ref)` 是可写隔离主键，不允许跨 profile、浏览器通道、执行面、执行模式或 probe bundle 共用同一可写状态对象。
- `runtime_context_id` 与 `proxy_binding_ref` 仅用于 run/session 证据回链，不进入可写基线主键。
- `ready` 只能在学习阈值达标后进入；阈值不足必须保持在 `learning` 或降级为 `degraded`。
- 若先前 `ready` 基线已超过当前阈值快照定义的 freshness window，或同 scope 最新 assessment 返回 `drift_level=high|critical`，则必须降级为 `degraded`。
- 若最新样本批次未通过字段完整性或证据回链校验，导致 ready 基线不再可直接信任，则必须降级为 `degraded` 或回退到 `learning`。
- 当 registry 已 supersede / invalidate 当前 baseline、检测到 scope 污染/隔离破坏，或同 scope 持续 `degraded`/重复 `high|critical` 已达到当前阈值快照定义的 reseed threshold 时，必须置 `reseed_required=true`。
- `reseed_required=true` 时不得把状态误报为稳定 `ready`。
- `reseed_required=true` 时，下游评估只能收敛到 `require_manual_review` 或 `require_reseed`，直到新学习周期重新建立。

## 3. `platform_behavior_assessment`

用途：

- 记录一次 Layer 4 偏移评估结果，供门禁链路消费为风险证据。

最小字段：

- `assessment_id`
- `profile`
- `platform`
- `browser_channel`
- `execution_surface`
- `probe_bundle_ref`
- `runtime_context_id`
- `proxy_binding_ref`
- `threshold_config_snapshot_ref`
- `baseline_state`
- `drift_level`
- `issue_scope`
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
  - 本次 assessment 实际比较了 active baseline 时必填
  - 仅在当前 scope 尚无 active baseline、assessment 处于冷启动/学习期保守判定时允许为空
- `decision_id`
- `audit_record_ref`
  - 仅在门禁链路已消费 assessment 并产出正式决策/审计对象时必填
  - 未消费前必须同时为空

`decision_hint` 允许值：

- `allow_read_only`
- `hold_live_write`
- `require_manual_review`
- `require_reseed`

补充约束：

- `decision_hint` 是建议，不是门禁最终结果；不得直接覆盖 `FR-0010/0011` 最终状态字段。
- `evidence_refs` 至少能回链到输入批次或运行审计记录，禁止“无证据评估”。
- `threshold_config_snapshot_ref` 必须指向本次 assessment 使用的不可变阈值配置快照，确保漂移判定可重放、可审计。
- `decision_id` 与 `audit_record_ref` 仅用于门禁消费后的审计回链，不构成新的 gate result 对象。
- `action_type` 必须落在稳定动作集合 `navigate | locate | click | extract | wait_settled | type | submit | confirm | publish | purchase | dispatch | bind` 内，不得并行引入 `download` 等新的 Layer 4 动作快捷值。
- `proxy_binding_ref` 只用于记录本次 assessment 所对应批次的代理绑定证据，不参与 active baseline 选择。
- `platform_behavior_assessment` 只能比较同一 `(profile, platform, browser_channel, execution_surface, effective_execution_mode, probe_bundle_ref)` scope 内、由 `FR-0020.anti_detection_baseline_registry_entry.active_baseline_ref` 选中的 active baseline。
- `confidence` 必须在 `[0,1]`，用于表达评估可信度，不可当作放行开关。

## 4. 与既有对象的关系

- 与 `FR-0020`：
  - Layer 4 只消费 `anti_detection_baseline_snapshot`、`anti_detection_baseline_registry_entry` 与 `anti_detection_validation_record`。
  - `validation_scope=cross_layer_baseline` 是唯一正式输入入口；`FR-0022` 不得并行定义第二套 baseline snapshot / validation record 真相源。
  - active baseline 的唯一正式判定来源是 `anti_detection_baseline_registry_entry.active_baseline_ref`；Layer 4 不得仅凭 snapshot / record 自行宣布某条 baseline 仍为当前生效。
  - `effective_execution_mode` 与 `probe_bundle_ref` 是 shared scope keys；Layer 4 baseline identity 必须保留这两个维度，不得把不同 mode / bundle 的 baseline 混写到同一状态对象。
  - 在 `FR-0020` registry scope 未正式扩展前，Layer 4 不得把 `proxy_binding_ref` 升格为并行的 active baseline key；代理差异只能通过 signal batch / assessment 证据回链表达。
- 与 `FR-0014`：
  - Layer 4 读取 session 节律摘要，但不重定义 Layer 3 状态机。
- 与 `FR-0010/0011`：
  - Layer 4 仅提供 `decision_hint` 与证据，不替代审批/门禁主链。
- 与 `FR-0019`：
  - read lane 必须继承 `goal_kind=read -> interaction_safety_class=pure_read`，且遵守 pure-read 动作白名单。
  - `type`、`submit`、`confirm`、`publish`、`purchase`、`dispatch`、`bind` 都属于当前 formal baseline 必须稳定编码的非读动作；只要出现，均不得继续落在 `pure_read`。
- 与 `FR-0003`：
  - `profile/session` 维度是 Layer 4 的身份坐标真相源。
