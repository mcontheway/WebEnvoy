# FR-0018 契约：能力验证、重放与可信判断

## 1. `ability_validation_request`

```ts
interface AbilityValidationRequest {
  ability_ref: string
  validation_mode: "smoke_validation" | "replay_validation"
  input_source: "last_success_input" | "explicit_input_snapshot"
  profile_ref: string
  expected_capability_kind: "read" | "write" | "download"
}
```

## 2. `ability_replay_request`

```ts
interface AbilityReplayRequest {
  ability_ref: string
  replay_source: "last_success_input" | "explicit_input_snapshot"
  replay_input_ref?: string
  replay_reason: string
}
```

## 3. `ability_health_view`

```ts
interface LatestValidationByMode {
  validation_mode: "smoke_validation" | "replay_validation"
  result_state: "verified" | "broken" | "stale"
  failure_class?: "page_changed" | "auth_or_session_required" | "gate_blocked" | "environment_mismatch" | "runtime_error"
  validated_at: string
  run_id: string
  artifact_refs: string[]
}

interface AbilityHealthView {
  ability_ref: string
  profile_ref: string
  health_state: "unknown" | "verified" | "degraded" | "broken" | "stale"
  latest_validations: LatestValidationByMode[]
  divergence_reason?: "smoke_replay_mismatch"
}
```

约束：

- `health_state` 只表达最小可信判断，不表达是否可交付。
- `failure_class` 只表达用户可读的大类，不替代低层错误码。
- `profile_ref` 是 `ability_health_view` 的正式隔离维度；不同 profile 不得共享同一条聚合健康视图。
- `run_id` / `artifact_refs` 必须引用既有运行证据，不建立第二套真相源。
- `artifact_refs` 的正式 truth source 是与 `run_id` 同属一次验证运行的 run-scoped 证据载体；FR-0018 只保留 opaque ref，不定义新的 artifact 存储。
- `latest_validations` 中每个 `validation_mode` 最多只能出现一条 latest 记录。
- `latest_validations[*]` 一旦存在，就必须同时具备 `validated_at`、`run_id` 与 `artifact_refs`；缺少任一证据字段时不得宣称该 mode latest 已成立。
- `result_state=verified`：该 mode 最近一次验证成功，且 `failure_class` 必须为空。
- `result_state=broken`：该 mode 最近一次验证失败，且必须给出 `failure_class`。
- `result_state=stale`：该 mode 存在历史验证结果，但因 freshness 过期或 descriptor/runtime/profile 基线变化，当前不能继续宣称可信；该记录仍必须保留最近一次已完成验证的证据字段。
- 顶层 `health_state=verified`：已有 mode latest 记录全部为 `verified`，且不存在分叉。
- 顶层 `health_state=broken`：已有 mode latest 记录全部为 `broken`，或唯一 latest 记录为 `broken`。
- 顶层 `health_state=degraded`：至少存在一个 mode latest 记录，但 smoke / replay 结果分叉，或成功/失败并存，`divergence_reason` 必须填写。
- 顶层 `health_state=unknown`：尚不存在任何完成态 latest 记录。
- 顶层 `health_state=stale`：已有 mode latest 记录全部为 `stale`，且当前没有新的 verified/broken 结果。
