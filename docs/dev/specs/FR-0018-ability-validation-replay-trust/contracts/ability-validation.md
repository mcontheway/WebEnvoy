# FR-0018 契约：能力验证、重放与可信判断

## 1. `ability_validation_request`

```ts
interface AbilityValidationRequest {
  ability_ref: string
  validation_mode: "smoke_validation" | "replay_validation"
  input_source: "last_success_input" | "explicit_input_snapshot"
  replay_input_ref?: string
  profile_ref: string
  expected_capability_kind: "read" | "write" | "download"
}
```

## 2. `ability_replay_request`

```ts
type AbilityReplayRequest =
  | {
      ability_ref: string
      profile_ref: string
      replay_source: "last_success_input"
      replay_reason: string
    }
  | {
      ability_ref: string
      profile_ref: string
      replay_source: "explicit_input_snapshot"
      replay_input_ref: string
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
  baseline_descriptor: {
    entrypoint: string
    input_contract_ref: string
    output_contract_ref: string
    error_contract_ref: string
    profile_ref: string
  }
  artifact_refs?: string[]
}

interface AbilityHealthView {
  ability_ref: string
  profile_ref: string
  health_state: "unknown" | "verified" | "degraded" | "broken" | "stale"
  latest_validations: LatestValidationByMode[]
  last_success_input_ref?: string
  divergence_reason?: "smoke_replay_mismatch"
}
```

约束：

- `health_state` 只表达最小可信判断，不表达是否可交付。
- `failure_class` 只表达用户可读的大类，不替代低层错误码。
- `validation_mode=replay_validation && input_source=explicit_input_snapshot` 时，`replay_input_ref` 必须存在；`input_source=last_success_input` 时不得伪造显式 snapshot 引用。
- `replay_source=explicit_input_snapshot` 时，`ability_replay_request.replay_input_ref` 必须存在；`replay_source=last_success_input` 时不得伪造显式 snapshot 引用。
- `profile_ref` 是 `ability_health_view` 的正式隔离维度；不同 profile 不得共享同一条聚合健康视图。
- `ability_replay_request.profile_ref` 必须与目标 `ability_health_view.profile_ref` 一致；不得在 replay 时跨 profile 读取 `last_success_input`。
- `last_success_input` 的正式 truth source 是同一 `ability_ref + profile_ref` 视图内的 `ability_health_view.last_success_input_ref`；该值为空时，请求不得被视为可执行 replay。
- `run_id` 是最近一次验证成立的最小硬证据锚点，不建立第二套运行真相源。
- `artifact_refs` 只作为补充的 run-scoped evidence refs；在上游等价 evidence carrier 正式冻结前，不得把它当作 latest 记录成立的前置条件。
- 在同一 `ability_ref + profile_ref` 视图内，`latest_validations` 中每个 `validation_mode` 最多只能出现一条 latest 记录。
- `latest_validations[*]` 一旦存在，就必须同时具备 `validated_at` 与 `run_id`；若存在 run-scoped evidence refs，可再补充 `artifact_refs`。
- `latest_validations[*].baseline_descriptor` 必须冻结该条 latest 结果生成时的 descriptor/profile 基线，至少包含 `entrypoint`、`input_contract_ref`、`output_contract_ref`、`error_contract_ref`、`profile_ref`。
- `result_state=verified`：该 mode 最近一次验证成功，且 `failure_class` 必须为空。
- `result_state=broken`：该 mode 最近一次验证失败，且必须给出 `failure_class`。
- `result_state=stale`：该 mode 存在历史验证结果，但因 `validated_at` 超过 7 天 freshness window，或当前 descriptor 基线与 `baseline_descriptor` 不一致，当前不能继续宣称可信；该记录仍必须保留最近一次已完成验证的证据字段。
- 在同一 `ability_ref + profile_ref` 视图内，顶层 `health_state=verified`：已有 mode latest 记录全部为 `verified`，且不存在分叉。
- 在同一 `ability_ref + profile_ref` 视图内，顶层 `health_state=broken`：已有 mode latest 记录全部为 `broken`，或唯一 latest 记录为 `broken`。
- 在同一 `ability_ref + profile_ref` 视图内，顶层 `health_state=degraded`：至少存在一个 mode latest 记录，但 smoke / replay 结果分叉，或成功/失败并存，`divergence_reason` 必须填写。
- 在同一 `ability_ref + profile_ref` 视图内，顶层 `health_state=unknown`：尚不存在任何完成态 latest 记录。
- 在同一 `ability_ref + profile_ref` 视图内，顶层 `health_state=stale`：已有 mode latest 记录全部为 `stale`，且当前没有新的 verified/broken 结果。
