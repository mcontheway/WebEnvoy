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
- 仅允许摘要字段，不允许页面正文、输入明文、媒体内容等高敏原文数据。
- `action_mix` 至少覆盖 `navigate`、`locate`、`extract`、`reveal_only_click`、`wait_settled`、`type`、`submit` 的计数或比率。
- `goal_kind=read` 时，`interaction_safety_class` 必须为 `pure_read`，且只允许 `navigate | locate | reveal_only_click | extract | wait_settled` 出现非零值；若出现 `type` 或 `submit`，不得标记为 `pure_read`。

## 2. `platform_behavior_baseline_state`

用途：

- 记录 `(profile, platform, browser_channel, execution_surface, proxy_binding_ref)` 维度的长期行为基线状态。

最小字段：

- `profile`
- `platform`
- `browser_channel`
- `execution_surface`
- `proxy_binding_ref`
- `baseline_state`
- `baseline_version`
- `learned_sample_count`
- `learning_window_started_at`
- `ready_at`
- `drift_level`
- `last_assessed_at`
- `reseed_required`

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

- `(profile, platform, browser_channel, execution_surface, proxy_binding_ref)` 是可写隔离主键，不允许跨 profile、浏览器通道、执行面或代理绑定共用同一可写状态对象。
- `runtime_context_id` 仅用于 run/session 证据回链，不进入可写基线主键。
- `ready` 只能在学习阈值达标后进入；阈值不足必须保持在 `learning` 或降级为 `degraded`。
- `reseed_required=true` 时不得把状态误报为稳定 `ready`。

## 3. `platform_behavior_assessment`

用途：

- 记录一次 Layer 4 偏移评估结果，供门禁链路消费为风险证据。

最小字段：

- `assessment_id`
- `profile`
- `platform`
- `browser_channel`
- `execution_surface`
- `runtime_context_id`
- `proxy_binding_ref`
- `baseline_state`
- `drift_level`
- `issue_scope`
- `action_type`
- `requested_execution_mode`
- `effective_execution_mode`
- `decision_hint`
- `decision_id`
- `audit_record_ref`
- `confidence`
- `evidence_refs`
- `assessed_at`
- `model_version`

`decision_hint` 允许值：

- `allow_read_only`
- `hold_live_write`
- `require_manual_review`
- `require_reseed`

补充约束：

- `decision_hint` 是建议，不是门禁最终结果；不得直接覆盖 `FR-0010/0011` 最终状态字段。
- `evidence_refs` 至少能回链到输入批次或运行审计记录，禁止“无证据评估”。
- `decision_id` 与 `audit_record_ref` 仅用于门禁消费后的审计回链，不构成新的 gate result 对象。
- `confidence` 必须在 `[0,1]`，用于表达评估可信度，不可当作放行开关。

## 4. 与既有对象的关系

- 与 `FR-0014`：
  - Layer 4 读取 session 节律摘要，但不重定义 Layer 3 状态机。
- 与 `FR-0010/0011`：
  - Layer 4 仅提供 `decision_hint` 与证据，不替代审批/门禁主链。
- 与 `FR-0019`：
  - read lane 必须继承 `goal_kind=read -> interaction_safety_class=pure_read`，且遵守 pure-read 动作白名单。
- 与 `FR-0003`：
  - `profile/session` 维度是 Layer 4 的身份坐标真相源。
