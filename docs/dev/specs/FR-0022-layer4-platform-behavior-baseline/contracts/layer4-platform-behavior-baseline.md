# FR-0022 契约：Layer 4 平台行为基线

## 1. `platform_behavior_signal_batch`

```ts
type GoalKind = "read" | "write" | "download"
type InteractionSafetyClass = "pure_read" | "controlled_write" | "high_risk_write"

interface ActionMix {
  navigate: number
  locate: number
  extract: number
  reveal_only_click: number
  type: number
  submit: number
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
  run_id: string
  session_id: string
  profile: string
  platform: string
  target_domain: string
  goal_kind: GoalKind
  interaction_safety_class: InteractionSafetyClass
  observed_at: string
  action_mix: ActionMix
  timing_summary: TimingSummary
  risk_feedback_signals: RiskFeedbackSignals
}
```

约束：

- `run_id/session_id/profile/platform` 任一缺失时，必须拒绝入库。
- `observed_at` 必须是可解析时间戳。
- `goal_kind` 与 `interaction_safety_class` 必须保持可解释映射，不得出现“高风险写动作却标成 `pure_read`”。
- 只允许结构化摘要，不允许正文/敏感原文字段进入该契约。

## 2. `platform_behavior_baseline_state`

```ts
type BaselineState = "unseeded" | "learning" | "ready" | "degraded" | "suspended"
type DriftLevel = "none" | "low" | "medium" | "high" | "critical"

interface PlatformBehaviorBaselineState {
  profile: string
  platform: string
  baseline_state: BaselineState
  baseline_version: string
  learned_sample_count: number
  learning_window_started_at: string
  ready_at?: string
  drift_level: DriftLevel
  last_assessed_at?: string
  reseed_required: boolean
}
```

约束：

- `(profile, platform)` 是可写隔离主键。
- `baseline_state=ready` 时，`learned_sample_count` 必须满足学习阈值且 `ready_at` 不得缺失。
- `reseed_required=true` 时，不得把状态当作稳定 ready 消费。

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
  baseline_state: BaselineState
  drift_level: DriftLevel
  decision_hint: DecisionHint
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
- 当 `drift_level=high|critical` 时，不得返回会扩大风险的建议（例如直接放行高风险 live write）。

