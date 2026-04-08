# FR-0018 契约：能力验证、重放与可信判断

## 1. `ability_validation_request`

```ts
interface AbilityValidationRequest {
  ability_ref: string
  validation_mode: "smoke_validation" | "replay_validation"
  input_source: "last_success_input" | "explicit_input_snapshot"
  profile_ref?: string
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
interface AbilityHealthView {
  ability_ref: string
  health_state: "unknown" | "verified" | "degraded" | "broken" | "stale"
  failure_class?: "page_changed" | "auth_or_session_required" | "gate_blocked" | "environment_mismatch" | "runtime_error"
  validated_at?: string
  run_id?: string
  artifact_refs?: string[]
}
```

约束：

- `health_state` 只表达最小可信判断，不表达是否可交付。
- `failure_class` 只表达用户可读的大类，不替代低层错误码。
- `run_id` / `artifact_refs` 必须引用既有运行证据，不建立第二套真相源。
- `artifact_refs` 的正式 truth source 是与 `run_id` 同属一次验证运行的 run-scoped 证据载体；FR-0018 只保留 opaque ref，不定义新的 artifact 存储。
- `verified`：最近一次验证成功，且同时具备 `run_id` 与 `artifact_refs`。
- `degraded`：最近一次验证完成但仅部分满足预期，或 smoke / replay 结果出现分叉，仍需人工关注。
- `broken`：最近一次验证失败，且必须给出 `failure_class`。
- `stale`：存在历史验证结果，但因 freshness 过期或 descriptor/runtime/profile 基线变化，当前不能继续宣称可信。
