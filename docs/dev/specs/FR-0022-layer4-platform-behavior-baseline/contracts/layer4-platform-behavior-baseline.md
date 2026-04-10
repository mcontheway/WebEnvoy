# FR-0022 契约：Layer 4 平台行为基线

## 1. `platform_behavior_signal_batch`

```ts
type GoalKind = "read" | "write"
type ActionType =
  | "navigate"
  | "locate"
  | "extract"
  | "click"
  | "wait_settled"
  | "type"
  | "submit"
  | "confirm"
  | "publish"
  | "purchase"
  | "dispatch"
  | "bind"
type InteractionSafetyClass = "pure_read" | "controlled_write" | "high_risk_write"
type InteractionSemantics = "reveal_only_click"
type BrowserChannel = "Google Chrome stable"
type ExecutionSurface = "real_browser" | "stub" | "fake_host" | "other"
type ClickKind =
  | "expand_or_collapse"
  | "switch_content_tab"
  | "open_detail_view"
  | "load_more_or_paginate"

interface ActionMix {
  navigate: number
  locate: number
  extract: number
  click: number
  wait_settled: number
  type: number
  submit: number
  confirm: number
  publish: number
  purchase: number
  dispatch: number
  bind: number
}

interface ClickKindMix {
  expand_or_collapse: number
  switch_content_tab: number
  open_detail_view: number
  load_more_or_paginate: number
}

interface TimingSummary {
  session_duration_ms: number
  active_window_bucket: string
  idle_ratio: number
  operation_interval_p50_ms: number
  operation_interval_p90_ms: number
}

interface RiskFeedbackSignals {
  captcha_count: number
  risk_popup_count: number
  silent_failure_count: number
  http_461_471_count: number
}

interface PlatformBehaviorSignalBatch {
  batch_id: string
  request_ref: string
  sample_ref: string
  record_ref: string
  run_id: string
  session_id?: string
  profile: string
  platform: string
  browser_channel: BrowserChannel
  execution_surface: ExecutionSurface
  effective_execution_mode: string
  probe_bundle_ref: string
  runtime_context_id: string
  target_domain: string
  goal_kind: GoalKind
  interaction_safety_class: InteractionSafetyClass
  observed_at: string
  action_mix: ActionMix
  click_kind_mix?: ClickKindMix
  timing_summary: TimingSummary
  risk_feedback_signals: RiskFeedbackSignals
}
```

约束：

- `run_id/profile/platform` 任一缺失时，必须拒绝入库。
- `session_id` 只在 runtime 已提供稳定会话坐标时回填；其缺失不得单独阻断合法的 Layer 4 signal batch。
- `observed_at` 必须是可解析时间戳。
- `browser_channel` 当前只允许 `Google Chrome stable`，且必须与 `FR-0015`、`FR-0016`、`FR-0020` 复用同一 canonical label。
- `execution_surface` 必须直接复用 `FR-0016` 的正式枚举，不得回退为本 FR 私有取值。
- `goal_kind` 与 `interaction_safety_class` 必须保持可解释映射，不得出现“高风险写动作却标成 `pure_read`”。
- `goal_kind=read` 时，`interaction_safety_class` 必须为 `pure_read`，且 `ActionMix` 仅允许 `navigate | locate | click | extract | wait_settled` 出现非零值。
- `ActionMix` 的最小稳定动作集合必须至少覆盖 `navigate | locate | click | extract | wait_settled | type | submit | confirm | publish | purchase | dispatch | bind`。
- `ActionMix.click` 与 `action_type=click` 只允许复用 `FR-0019` trace-side 的 `action=click + interaction_semantics=reveal_only_click`；request-side `allowed_actions=reveal_only_click` 是上游授权语义，不得在 Layer 4 被复制成新的 action enum。
- 当 `action_mix.click > 0` 时，`click_kind_mix` 必填，且其计数总和必须直接等于 `action_mix.click`。
- 只要 `type`、`submit`、`confirm`、`publish`、`purchase`、`dispatch`、`bind` 任一出现非零值，该批次就不得标记为 `pure_read`。
- 本 FR 不冻结 `download` 为独立 Layer 4 goal；下载链路在进入本对象前必须先完成 `read/write` 映射。
- 若下载链路仅包含 `navigate | locate | click | extract | wait_settled`，必须映射为 `goal_kind=read`。
- 若下载链路包含 `type`、`submit`、`confirm`、`publish`、`purchase`、`dispatch`、`bind` 或其他写入型交互，必须映射为 `goal_kind=write`，且不得标记为 `pure_read`。
- 下载链路进入 assessment 时，`action_type` 必须继续记录实际交互动作，不得再平行定义 `download` 作为新的 Layer 4 action shortcut。
- 该对象必须可回链到 `FR-0020.validation_scope=cross_layer_baseline` 的共享验证输入，不得独立形成第二套 baseline scope。
- `request_ref`、`sample_ref`、`record_ref` 必须直接引用同 scope 的 `FR-0020` formal objects；不得只靠 `run_id/runtime_context_id` 维持 Layer 4 lineage。
- `effective_execution_mode` 与 `probe_bundle_ref` 必须直接继承 `FR-0020` 的 formal baseline scope；不得把不同 recon/live scope 或不同 probe bundle 归一化到同一批 Layer 4 输入。
- 当前 Layer 4 formal contract 不把 proxy binding 作为必填输入；若未来要纳入 `proxy_binding_ref`，必须先由上游 formal contract 冻结 canonical 字段，再通过独立 spec review 引入。
- 只允许结构化摘要，不允许正文/敏感原文字段进入该契约。

## 2. `platform_behavior_baseline_state`

```ts
type BaselineState = "unseeded" | "learning" | "ready" | "degraded"
type DriftLevel = "none" | "low" | "medium" | "high" | "critical"

interface PlatformBehaviorBaselineState {
  profile: string
  platform: string
  browser_channel: BrowserChannel
  execution_surface: ExecutionSurface
  effective_execution_mode: string
  probe_bundle_ref: string
  baseline_state: BaselineState
  baseline_ref?: string
  learned_sample_count: number
  learning_window_started_at: string
  ready_at?: string
  drift_level: DriftLevel
  last_assessed_at?: string
  reseed_required: boolean
}
```

约束：

- `(profile, platform, browser_channel, execution_surface, effective_execution_mode, probe_bundle_ref)` 是可写隔离主键。
- `runtime_context_id` 仅属于 run/session 证据回链，不得进入可写基线主键。
- `baseline_ref` 在当前状态已对应到 `FR-0020` registry 的 active baseline 时必填，并且必须直接等于该 scope 的 `active_baseline_ref`；`unseeded | learning` 阶段允许为空。
- 不同 `effective_execution_mode` 或不同 `probe_bundle_ref` 的 Layer 4 baseline 不得共享同一条可写状态对象。
- `baseline_state=ready` 时，`learned_sample_count` 必须满足学习阈值且 `ready_at` 不得缺失。
- `baseline_state!=ready` 时，`ready_at` 不得伪装为稳定就绪时间。
- `last_assessed_at` 在尚未形成 assessment 前允许为空；一旦该状态对象被 assessment 消费，后续写回不得继续缺失。
- 若先前 `ready` 基线的 `last_assessed_at` 已超过当前 `threshold_config_snapshot_ref` 定义的 freshness window，或同 scope 最新 assessment 返回 `drift_level=high|critical`，状态必须降级为 `degraded`。
- 若最新样本批次未通过字段完整性或证据回链校验，导致 ready 基线不再可直接信任，状态必须降级为 `degraded` 或重新进入 `learning`。
- 当 registry 已 supersede / invalidate 当前 baseline、检测到 scope 污染/隔离破坏，或同 scope 持续 `degraded`/重复 `high|critical` 已达到当前阈值快照定义的 reseed threshold 时，`reseed_required` 必须置为 `true`。
- `reseed_required=true` 时，不得把状态当作稳定 ready 消费。
- `reseed_required=true` 时，`baseline_state` 不得继续保持稳定 `ready`。

## 3. `platform_behavior_assessment`

```ts
type DecisionHint =
  | "allow_read_only"
  | "hold_live_write"
  | "require_manual_review"
  | "require_reseed"

interface PlatformBehaviorAssessment {
  assessment_id: string
  profile: string
  platform: string
  browser_channel: BrowserChannel
  execution_surface: ExecutionSurface
  probe_bundle_ref: string
  runtime_context_id: string
  baseline_ref?: string
  baseline_state: BaselineState
  drift_level: DriftLevel
  issue_scope: string
  action_type: ActionType
  interaction_semantics?: InteractionSemantics
  click_kind?: ClickKind
  requested_execution_mode: string
  effective_execution_mode: string
  threshold_config_snapshot_ref: string
  decision_hint: DecisionHint
  decision_id?: string
  audit_record_ref?: string
  confidence: number
  evidence_refs: string[]
  assessed_at: string
  model_version: string
}
```

约束：

- `confidence` 必须位于 `[0,1]`。
- `evidence_refs` 不得为空，且至少包含一条可回链信号批次或审计记录的引用。
- `decision_hint` 仅为建议输出，不能直接改写 `FR-0010/0011` 的门禁最终状态。
- `baseline_ref` 必须指向本次 assessment 实际比较所用的 baseline snapshot；仅在当前 scope 尚无 active baseline、assessment 处于冷启动/学习期保守判定时允许为空。
- `threshold_config_snapshot_ref` 必须指向本次 assessment 使用的不可变阈值配置快照。
- `decision_id` 与 `audit_record_ref` 仅用于门禁消费后的回链，不得被解释为新增 gate result。
- `decision_id` 与 `audit_record_ref` 必须同进同退：门禁尚未消费时二者都为空；门禁已消费并形成正式决策/审计对象后二者都必须可回填。
- `action_type` 的最小稳定动作集合必须至少覆盖 `navigate | locate | click | extract | wait_settled | type | submit | confirm | publish | purchase | dispatch | bind`，不得并行引入 `download` 等新的 Layer 4 动作快捷值。
- 当 `action_type=click` 时，`interaction_semantics` 必须固定为 `reveal_only_click`，且 `click_kind` 必填。
- 该对象只能比较同一 `(profile, platform, browser_channel, execution_surface, effective_execution_mode, probe_bundle_ref)` scope 内、由 `FR-0020.anti_detection_baseline_registry_entry.active_baseline_ref` 选中的 active baseline。
- 当 `drift_level=high|critical` 时，不得返回会扩大风险的建议（例如直接放行高风险 live write）。
