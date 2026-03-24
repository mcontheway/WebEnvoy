# FR-0014 数据模型（Layer 3 完整 session 行为节律引擎）

## 范围说明

本模型描述 `#237` 在规约阶段必须冻结的共享对象与生命周期。它在 `FR-0010/0011/#226` 的基础上追加 Layer 3 所需的阶段、窗口、事件、决策和状态视图模型，但不重定义既有审批、审计与风险状态对象。

## 真相源与衍生输出

### 正式真相源

1. `approval_record`
   - 人工审批与检查项真相源
2. `audit_record`
   - 门禁结果、状态迁移与审批留痕真相源
3. `session_rhythm_window_state`
   - 当前 session 节律窗口与阶段真相源
4. `session_rhythm_event`
   - 节律事件链真相源

### 衍生输出

1. `runtime.audit.risk_state_output`
2. `runtime.audit.session_rhythm_status`
3. `session_rhythm_status_view`

约束：
- 衍生输出只能由真相源聚合生成，不得反向写回。

## 实体 1：ProfileRhythmBinding

- `profile` TEXT NOT NULL
- `platform` TEXT NOT NULL
- `issue_scope` TEXT NOT NULL
- `policy_version` TEXT NOT NULL
- `distribution_profile` ENUM NOT NULL（`conservative` | `balanced` | `aggressive_blocked`）
- `action_spacing_floor_ms` INTEGER NOT NULL
- `experiment_interval_floor_ms` INTEGER NOT NULL
- `created_at` TEXT NOT NULL
- `updated_at` TEXT NOT NULL

约束：
- 这是 profile 级最小节律绑定，不等于 Layer 4 persona。
- 不允许存储独立健康评分、长期养号画像或平台行为模型字段。

## 实体 2：SessionRhythmEngineInput

- `run_id` TEXT NOT NULL
- `session_id` TEXT NOT NULL
- `profile` TEXT NOT NULL
- `platform` TEXT NOT NULL
- `issue_scope` ENUM NOT NULL（`issue_208` | `issue_209`）
- `risk_state` ENUM NOT NULL（`paused` | `limited` | `allowed`）
- `requested_execution_mode` TEXT NOT NULL
- `action_type` TEXT NOT NULL
- `triggered_at` TEXT NOT NULL
- `approval_record_ref` TEXT NULL
- `latest_audit_event_id` TEXT NULL

约束：
- `risk_state`、`requested_execution_mode` 与 `action_type` 的正式语义一律继承 `FR-0010/0011`。

## 实体 3：SessionRhythmWindowState

- `window_id` TEXT NOT NULL
- `profile` TEXT NOT NULL
- `platform` TEXT NOT NULL
- `issue_scope` TEXT NOT NULL
- `session_id` TEXT NOT NULL
- `current_phase` ENUM NOT NULL
  - `warmup`
  - `steady`
  - `cooldown`
  - `recovery_probe`
  - `afterglow_hook`
- `risk_state` ENUM NOT NULL（`paused` | `limited` | `allowed`）
- `window_started_at` TEXT NOT NULL
- `window_deadline_at` TEXT NOT NULL
- `cooldown_until` TEXT NULL
- `recovery_probe_due_at` TEXT NULL
- `stability_window_until` TEXT NULL
- `risk_signal_count` INTEGER NOT NULL
- `last_event_id` TEXT NULL
- `source_run_id` TEXT NOT NULL
- `updated_at` TEXT NOT NULL

约束：
- 同一 `(profile, platform, issue_scope)` 同时只能有一个可写 `SessionRhythmWindowState`。
- `cooldown` 时 `cooldown_until` 必填。
- `recovery_probe` 时 `recovery_probe_due_at` 必填。
- 存在稳定观察时 `stability_window_until` 必填。

## 实体 4：SessionRhythmEvent

- `event_id` TEXT NOT NULL
- `profile` TEXT NOT NULL
- `platform` TEXT NOT NULL
- `issue_scope` TEXT NOT NULL
- `session_id` TEXT NOT NULL
- `window_id` TEXT NOT NULL
- `event_type` ENUM NOT NULL
  - `risk_signal`
  - `cooldown_started`
  - `cooldown_extended`
  - `recovery_probe_started`
  - `recovery_probe_passed`
  - `recovery_probe_failed`
  - `stability_window_passed`
  - `manual_approval_recorded`
  - `window_closed`
- `phase_before` TEXT NOT NULL
- `phase_after` TEXT NOT NULL
- `risk_state_before` TEXT NOT NULL
- `risk_state_after` TEXT NOT NULL
- `source_audit_event_id` TEXT NULL
- `reason` TEXT NOT NULL
- `recorded_at` TEXT NOT NULL

约束：
- `source_audit_event_id` 在由门禁判定触发的事件中必须可回链。
- `manual_approval_recorded` 不承载审批真相本身，只引用 `approval_record` 已成立这一事实。

## 实体 5：SessionRhythmDecision

- `decision_id` TEXT NOT NULL
- `window_id` TEXT NOT NULL
- `run_id` TEXT NOT NULL
- `session_id` TEXT NOT NULL
- `profile` TEXT NOT NULL
- `current_phase` TEXT NOT NULL
- `current_risk_state` TEXT NOT NULL
- `next_phase` TEXT NOT NULL
- `next_risk_state` TEXT NOT NULL
- `effective_execution_mode` TEXT NOT NULL
- `decision` ENUM NOT NULL（`allowed` | `blocked` | `deferred`）
- `reason_codes` ARRAY NOT NULL
- `requires` ARRAY NOT NULL
- `decided_at` TEXT NOT NULL

约束：
- `effective_execution_mode` 的正式枚举仍继承 `FR-0010/0011`。
- `decision=allowed` 且涉及 live 时，必须能追溯到完整 `approval_record` 与对应 `audit_record`。
- `decision=deferred` 用于窗口未满足但不触发新的风险降级；不得被解释为放行。

## 实体 6：SessionRhythmStatusView

- `profile` TEXT NOT NULL
- `platform` TEXT NOT NULL
- `issue_scope` TEXT NOT NULL
- `current_phase` TEXT NOT NULL
- `current_risk_state` TEXT NOT NULL
- `window_state` ENUM NOT NULL（`active` | `cooldown` | `recovery_probe` | `stability` | `closed`）
- `cooldown_until` TEXT NULL
- `stability_window_until` TEXT NULL
- `latest_event_id` TEXT NULL
- `latest_reason` TEXT NULL
- `derived_at` TEXT NOT NULL

约束：
- `SessionRhythmStatusView` 是读模型，不直接持久化为单独真相源。

## 生命周期

1. `ProfileRhythmBinding`：profile 创建或升级策略版本时创建；仅低频更新。
2. `SessionRhythmWindowState`：session 开始时创建，窗口推进时更新，session 收敛时关闭。
3. `SessionRhythmEvent`：每次节律事件发生时追加，禁止就地覆盖。
4. `SessionRhythmDecision`：每次引擎做出可审计判定时生成，可被 `audit_record` 引用。
5. `SessionRhythmStatusView`：查询时基于真相源投影生成。

## 跨 FR 继承约束

- `approval_record`、`audit_record`、`consumer_gate_result` 继续沿用 `FR-0010/0011` 语义。
- `paused|limited|allowed` 继续是唯一正式风险状态集合。
- `cooldown_strategy=exponential_backoff` 与 `resume_probe_mode=recon_only` 继续继承 `#226` 最小基线。
- FR-0014 只追加窗口、阶段、事件、决策和状态视图对象；任何字段语义变更必须走独立 spec review。
