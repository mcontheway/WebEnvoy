# FR-0018 契约：能力验证、重放与可信判断

## 1. `ability_validation_request`

```ts
interface AbilityValidationRequest {
  ability_ref: string
  validation_mode: "smoke_validation"
  profile_ref: string
  expected_capability_kind: "read" | "write" | "download"
  smoke_input: Record<string, unknown>
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

## 3. `replay_input_snapshot_ref`

```ts
interface ReplayInputSnapshotRef {
  snapshot_ref: string
  ability_ref: string
  profile_ref: string
  source_run_id: string
  captured_at: string
}
```

## 4. `ability_health_view`

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
  divergence_reason?: "smoke_replay_mismatch" | "missing_mode_evidence"
}
```

约束：

- `health_state` 只表达最小可信判断，不表达是否可交付。
- `failure_class` 只表达用户可读的大类，不替代低层错误码。
- `validation_mode=smoke_validation` 时，`smoke_input` 必须存在，且必须满足 `FR-0017.candidate_ability_descriptor.input_contract_ref` 的最小输入边界。
- `expected_capability_kind` 如保留在请求面，必须直接等于 `FR-0017.candidate_ability_descriptor.ability_kind`；若不一致，验证层必须以结构化输入错误拒绝请求，不得自行容忍或改写。
- `replay_source=explicit_input_snapshot` 时，`ability_replay_request.replay_input_ref` 必须存在；`replay_source=last_success_input` 时不得伪造显式 snapshot 引用。
- `ability_ref` 在本 FR 中必须直接等于 `FR-0017.candidate_ability_descriptor.ability_id`；FR-0018 不再引入独立的 ability 引用命名空间或二次映射对象。
- `replay_input_ref` 只允许出现在 `replay_source=explicit_input_snapshot` 分支，且只能引用既有的 `ReplayInputSnapshotRef.snapshot_ref`；`replay_source=last_success_input` 分支必须缺省该字段。
- 对新进入 `FR-0018` 的能力，若 `FR-0017.candidate_ability_descriptor.seed_replay_input_ref` 已存在，则它必须作为首个 `ReplayInputSnapshotRef` 的正式上游 seed，且只允许落在 `capture_profile` 对应的健康视图内。
- `ability_validation_request` 是唯一的 smoke 请求契约；所有 replay 执行必须只通过 `ability_replay_request` 发起，`latest_validations.validation_mode=replay_validation` 也只能由 replay 请求结果写入。
- 若上游未提供 `seed_replay_input_ref`，则同一 `ability_ref + profile_ref` 下首次成功的 `smoke_validation.smoke_input` 或成功 replay 的已解析输入必须物化为首个 `ReplayInputSnapshotRef`，并回写为 `ability_health_view.last_success_input_ref`。
- 非 `capture_profile` 的其他 profile 视图不得继承这条初始 seed；它们只能在各自 profile 下首次成功验证/重放后刷新自己的 `last_success_input_ref`。
- `profile_ref` 是 `ability_health_view` 的正式隔离维度；不同 profile 不得共享同一条聚合健康视图。
- `ability_replay_request.profile_ref` 必须与目标 `ability_health_view.profile_ref` 一致；不得在 replay 时跨 profile 读取 `last_success_input`。
- `last_success_input` 的正式 truth source 是同一 `ability_ref + profile_ref` 视图内的 `ability_health_view.last_success_input_ref`；该值为空时，请求不得被视为可执行 replay。
- `ability_health_view.last_success_input_ref` 如存在，也必须指向同一 `ability_ref + profile_ref` 视图内的 `ReplayInputSnapshotRef.snapshot_ref`。
- `run_id` 是最近一次验证成立的最小硬证据锚点，不建立第二套运行真相源。
- `artifact_refs` 只作为补充的 run-scoped evidence refs；在上游等价 evidence carrier 正式冻结前，不得把它当作 latest 记录成立的前置条件。
- 在同一 `ability_ref + profile_ref` 视图内，`latest_validations` 中每个 `validation_mode` 最多只能出现一条 latest 记录。
- `latest_validations[*]` 一旦存在，就必须同时具备 `validated_at` 与 `run_id`；若存在 run-scoped evidence refs，可再补充 `artifact_refs`。
- `latest_validations[*].baseline_descriptor` 必须冻结该条 latest 结果生成时的 descriptor/profile 基线，至少包含 `entrypoint`、`input_contract_ref`、`output_contract_ref`、`error_contract_ref`、`profile_ref`。
- `result_state=verified`：该 mode 最近一次验证成功，且 `failure_class` 必须为空。
- `result_state=broken`：该 mode 最近一次验证失败，且必须给出 `failure_class`。
- `result_state=stale`：该 mode 存在历史验证结果，但因 `validated_at` 超过 7 天 freshness window，或当前 descriptor 基线与 `baseline_descriptor` 不一致，当前不能继续宣称可信；该记录仍必须保留最近一次已完成验证的证据字段。
- `ability_health_view.health_state` 必须按以下顺序判定，后续分支不得覆盖前序已命中的状态：
  1. `unknown`：不存在任何 mode latest 记录
  2. `stale`：存在 mode latest，且全部现存 latest 都是 `stale`
  3. `verified`：`smoke_validation` 与 `replay_validation` 的 latest 都存在，且都为 `verified`
  4. `broken`：不存在任何 `verified` latest，且所有非 `stale` latest 都是 `broken`
  5. `degraded`：除以上情况外的其余所有视图
- `smoke_validation` 成功可以作为“能力仍可用”的最小证据，也可以建立首个 `last_success_input_ref`，但在缺少 `replay_validation` latest 时不得单独把顶层健康状态提升为 `verified`。
- `degraded` 场景中，若 smoke/replay 之一缺失，则 `divergence_reason` 必须是 `missing_mode_evidence`；若两个 mode 都存在但结果不一致，`divergence_reason` 必须是 `smoke_replay_mismatch`。
