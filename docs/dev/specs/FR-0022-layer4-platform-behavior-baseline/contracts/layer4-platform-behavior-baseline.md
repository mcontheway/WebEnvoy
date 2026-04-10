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
type ExecutionSurface = "real_browser"
type GateExecutionMode =
  | "dry_run"
  | "recon"
  | "live_read_limited"
  | "live_read_high_risk"
  | "live_write"
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
  profile_ref: string
  platform: string
  browser_channel: BrowserChannel
  execution_surface: ExecutionSurface
  effective_execution_mode: GateExecutionMode
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

- `run_id/profile_ref/platform` 任一缺失时，必须拒绝入库。
- `session_id` 只在 runtime 已提供稳定会话坐标时回填；其缺失不得单独阻断合法的 Layer 4 signal batch。
- `observed_at` 必须是可解析时间戳。
- `browser_channel` 当前只允许 `Google Chrome stable`，且必须与 `FR-0015`、`FR-0016`、`FR-0020` 复用同一 canonical label。
- `execution_surface` 当前只允许 `real_browser`；`stub | fake_host | other` 仍属于 `FR-0016` 的上游证据枚举，但不得进入 FR-0022 formal input。
- `effective_execution_mode` 必须直接复用 `FR-0010/0011` 已冻结的 execution mode 枚举：`dry_run | recon | live_read_limited | live_read_high_risk | live_write`；不得在 Layer 4 signal batch 中退化为自由字符串。
- `profile_ref` 必须直接复用 `FR-0020` / `FR-0003` 的 canonical profile namespace，不得并行发明 `profile` 正式键。
- `target_domain` 必须直接复用 `FR-0019.risk_gate_context.target_domain`，并继续作为 downstream baseline / assessment identity 的正式域隔离键。
- `FR-0020` registry 只负责 shared upstream scope `(target_fr_ref, validation_scope, profile_ref, browser_channel, execution_surface, effective_execution_mode, probe_bundle_ref)` 的 active baseline ownership；`platform`、`target_domain` 与 `goal_kind` 继续属于 `FR-0022` 的 downstream drift baseline scope，不得被倒灌为上游 registry selector。
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
- `FR-0022` 当前把 `target_fr_ref=FR-0022` 与 `validation_scope=cross_layer_baseline` 视为固定 lane 常量；`target_fr_ref` 必须继续复用 `FR-0020` 的 FR 标识语义，不得改写为 GitHub issue 号；二者必须受上游 formal contract 约束，但不在 Layer 4 writable identity 中重复落库。
- `request_ref`、`sample_ref`、`record_ref` 必须直接引用同一条 `FR-0020` formal lineage：`sample_ref` 所指向的 structured sample 必须回链到同一个 `request_ref`，且 `record_ref` 所指向的 validation record 必须同时回链该 `request_ref` 并引用该 `sample_ref`；不得只靠 `run_id/runtime_context_id` 维持 Layer 4 lineage。
- `request_ref` 与 `sample_ref` 的 formal ownership 仍分别属于 `FR-0020.anti_detection_validation_request` 与 `FR-0020.anti_detection_structured_sample`；Layer 4 只允许读取这些上游对象以完成 lineage 校验，不得在本 FR 中复制它们的真相源。
- `effective_execution_mode` 与 `probe_bundle_ref` 必须直接继承 `FR-0020` 的 formal baseline scope；不得把不同 recon/live scope 或不同 probe bundle 归一化到同一批 Layer 4 输入。
- 当前 Layer 4 formal contract 不把 proxy binding 作为必填输入；若未来要纳入 `proxy_binding_ref`，必须先由上游 formal contract 冻结 canonical 字段，再通过独立 spec review 引入。
- 只允许结构化摘要，不允许正文/敏感原文字段进入该契约。

## 2. `platform_behavior_baseline_snapshot`

```ts
interface BehaviorVector {
  action_mix: ActionMix
  click_kind_mix?: ClickKindMix
  timing_summary: TimingSummary
  risk_feedback_signals: RiskFeedbackSignals
}

interface PlatformBehaviorBaselineSnapshot {
  baseline_ref: string
  profile_ref: string
  platform: string
  target_domain: string
  browser_channel: BrowserChannel
  execution_surface: ExecutionSurface
  effective_execution_mode: GateExecutionMode
  probe_bundle_ref: string
  goal_kind: GoalKind
  upstream_active_baseline_ref: string
  threshold_config_snapshot_ref: string
  behavior_vector: BehaviorVector
  source_batch_refs: string[]
  captured_at: string
}
```

约束：

- `baseline_ref` 是 `FR-0022` 自有的 downstream drift baseline 标识，不得与 `FR-0020.anti_detection_baseline_snapshot.baseline_ref` 复用为同一对象。
- `effective_execution_mode` 必须直接复用 `FR-0010/0011` 已冻结的 execution mode 枚举；不得在 downstream baseline snapshot 中以自由字符串存储 shared gate mode。
- `(profile_ref, platform, target_domain, browser_channel, execution_surface, effective_execution_mode, probe_bundle_ref, goal_kind, baseline_ref)` 必须唯一；不同 downstream scope 不得共享同一条 `baseline_ref`。
- `upstream_active_baseline_ref` 必须直接记录生成该 downstream baseline 时，对应 shared upstream scope 的 `FR-0020.anti_detection_baseline_registry_entry.active_baseline_ref`。
- 多个 downstream scope 允许并行引用同一条 `upstream_active_baseline_ref`，但必须各自拥有独立的 `baseline_ref`。
- `source_batch_refs` 必须非空，且只能引用同一 downstream scope 内、同一 shared upstream lineage 下的 `platform_behavior_signal_batch`。
- `behavior_vector` 只允许保留结构化聚合字段，不得退化为页面正文、私密输入或自由文本摘要。
- 当 `behavior_vector.action_mix.click > 0` 时，`behavior_vector.click_kind_mix` 必须存在，且总计数必须等于 `behavior_vector.action_mix.click`。
- `goal_kind=read` 的 downstream baseline snapshot 只允许沉淀 `pure_read` 合法动作，不得把非读动作写入 read snapshot。

## 3. `platform_behavior_baseline_state`

```ts
type BaselineState = "unseeded" | "learning" | "ready" | "degraded"
type DriftLevel = "none" | "low" | "medium" | "high" | "critical"

interface PlatformBehaviorBaselineState {
  profile_ref: string
  platform: string
  target_domain: string
  browser_channel: BrowserChannel
  execution_surface: ExecutionSurface
  effective_execution_mode: GateExecutionMode
  probe_bundle_ref: string
  goal_kind: GoalKind
  threshold_config_snapshot_ref: string
  baseline_state: BaselineState
  baseline_ref?: string
  learned_sample_count: number
  learning_window_started_at?: string
  ready_at?: string
  drift_level: DriftLevel
  last_assessed_at?: string
  reseed_required: boolean
}
```

约束：

- `(profile_ref, platform, target_domain, browser_channel, execution_surface, effective_execution_mode, probe_bundle_ref, goal_kind)` 是可写隔离主键。
- `effective_execution_mode` 必须直接复用 `FR-0010/0011` 已冻结的 execution mode 枚举；不得在 baseline state 中允许任意 mode 标签写入该隔离主键。
- `runtime_context_id` 仅属于 run/session 证据回链，不得进入可写基线主键。
- `baseline_ref` 在当前状态已绑定到该 downstream scope 的 `platform_behavior_baseline_snapshot.baseline_ref` 时必填；它记录当前可写状态正在消费的下游 drift baseline，而不是 shared upstream baseline 本身；`unseeded | learning` 阶段允许为空。
- `learning_window_started_at` 仅在 `baseline_state=learning|ready|degraded` 时必填；`baseline_state=unseeded` 时必须允许为空或缺失。
- `baseline_state=unseeded` 时，`learned_sample_count` 必须允许为 `0`，且不得伪造 `baseline_ref`、`ready_at` 或已开始学习窗口的时间戳。
- 多个 `(platform, target_domain, goal_kind)` 下游状态对象允许并行引用同一条 shared upstream `upstream_active_baseline_ref` 作为 lineage 输入；需要禁止的是把这些 scope 的学习/ready/degraded/reseed 历史折叠到同一条可写状态对象，或让它们共用同一条 downstream `baseline_ref`。
- `threshold_config_snapshot_ref` 必须指向最近一次生成该状态所用的不可变阈值快照；阈值快照变化后，不得静默沿用旧状态解释新漂移结果。
- 不同 `effective_execution_mode` 或不同 `probe_bundle_ref` 的 Layer 4 baseline 不得共享同一条可写状态对象。
- 不同 `goal_kind` 的 Layer 4 baseline 不得共享同一条可写状态对象；`read` 与 `write` 必须分别学习与评估。
- `baseline_state=ready` 时，`learned_sample_count` 必须满足学习阈值且 `ready_at` 不得缺失。
- `baseline_state!=ready` 时，`ready_at` 不得伪装为稳定就绪时间。
- `last_assessed_at` 在尚未形成 assessment 前允许为空；一旦该状态对象被 assessment 消费，后续写回不得继续缺失。
- 若先前 `ready` 基线的 `last_assessed_at` 已超过当前 `threshold_config_snapshot_ref` 定义的 freshness window，或同 scope 最新 assessment 返回 `drift_level=high|critical`，状态必须降级为 `degraded`。
- 若最新样本批次未通过字段完整性或证据回链校验，导致 ready 基线不再可直接信任，状态必须降级为 `degraded` 或重新进入 `learning`。
- 当当前 `baseline_ref` 所指向的 `platform_behavior_baseline_snapshot.upstream_active_baseline_ref` 已不再等于对应 shared upstream scope 的 `FR-0020.anti_detection_baseline_registry_entry.active_baseline_ref`、检测到 scope 污染/隔离破坏，或同 scope 持续 `degraded`/重复 `high|critical` 已达到当前阈值快照定义的 reseed threshold 时，`reseed_required` 必须置为 `true`。
- `reseed_required=true` 时，不得把状态当作稳定 ready 消费。
- `reseed_required=true` 时，`baseline_state` 不得继续保持稳定 `ready`。

## 4. `platform_behavior_assessment`

```ts
type DecisionHint =
  | "allow_read_only"
  | "no_additional_restriction"
  | "hold_live_write"
  | "require_manual_review"
  | "require_reseed"

interface PlatformBehaviorAssessment {
  assessment_id: string
  profile_ref: string
  platform: string
  target_domain: string
  browser_channel: BrowserChannel
  execution_surface: ExecutionSurface
  probe_bundle_ref: string
  goal_kind: GoalKind
  runtime_context_id: string
  baseline_ref?: string
  baseline_state: BaselineState
  drift_level: DriftLevel
  action_type: ActionType
  interaction_semantics?: InteractionSemantics
  click_kind?: ClickKind
  requested_execution_mode: GateExecutionMode
  effective_execution_mode: GateExecutionMode
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
- `decision_hint=no_additional_restriction` 只表示 Layer 4 对当前 write-path assessment 不新增额外降级/阻断建议，不等于 live write 自动放行。
- `FR-0022` 是平台通用的 Layer 4 contract，不冻结 XHS 专用 `issue_scope`；若 `FR-0011` 等下游 gate consumer 需要 `issue_208 | issue_209 | shared` 之类的 issue taxonomy，必须在消费 assessment 时由 consumer context 派生或补充，不得写回 Layer 4 核心对象。
- `requested_execution_mode` 与 `effective_execution_mode` 必须直接复用 `FR-0010/0011` 已冻结的 execution mode 枚举：`dry_run | recon | live_read_limited | live_read_high_risk | live_write`；不得在 Layer 4 assessment 中扩写私有 mode。
- `baseline_ref` 必须指向本次 assessment 实际比较所用的 `platform_behavior_baseline_snapshot.baseline_ref`；仅在当前 scope 尚无可用 downstream drift baseline、assessment 处于冷启动/学习期保守判定时允许为空。
- `threshold_config_snapshot_ref` 必须指向本次 assessment 使用的不可变阈值配置快照。
- `decision_id` 与 `audit_record_ref` 仅用于门禁消费后的回链，不得被解释为新增 gate result。
- `decision_id` 与 `audit_record_ref` 必须同进同退：门禁尚未消费时二者都为空；门禁已消费并形成正式决策/审计对象后二者都必须可回填。
- `action_type` 的最小稳定动作集合必须至少覆盖 `navigate | locate | click | extract | wait_settled | type | submit | confirm | publish | purchase | dispatch | bind`，不得并行引入 `download` 等新的 Layer 4 动作快捷值。
- 当 `action_type=click` 时，`interaction_semantics` 必须固定为 `reveal_only_click`，且 `click_kind` 必填。
- 该对象只能比较同一 `(profile_ref, platform, target_domain, browser_channel, execution_surface, effective_execution_mode, probe_bundle_ref, goal_kind)` downstream scope 内的 `platform_behavior_baseline_snapshot`。
- `FR-0020.anti_detection_baseline_registry_entry.active_baseline_ref` 只负责 upstream active baseline ownership 与 lineage admission；它不是 Layer 4 drift evaluation 直接比较的 downstream baseline object。
- 同一条 shared upstream `active_baseline_ref` 可以被多个 downstream scope 的 assessment 并行引用，但每个 scope 都必须比较自己的 `platform_behavior_baseline_snapshot.baseline_ref`，不得因此合并不同 scope 的状态历史或审计对象。
- `anti_detection_validation_view` 是上游派生读模型，不作为该 assessment 对象的正式输入或回写真相源。
- 当 `drift_level=high|critical` 时，不得返回会扩大风险的建议（例如直接放行高风险 live write）。
- `decision_hint=no_additional_restriction` 仅允许在 `goal_kind=write`、对应 downstream `platform_behavior_baseline_state` 已处于 `ready`、未标记 `reseed_required=true`，并且本次 assessment 的 `drift_level=none|low` 时出现；它不得被解释为 write-ready 例外规则或 `gate_decision=allowed` 代理。
