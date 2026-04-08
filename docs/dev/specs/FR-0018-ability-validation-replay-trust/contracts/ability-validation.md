# FR-0018 契约：能力验证、重放与可信判断

## 1. `ability_validation_request`

```ts
interface AbilityValidationRequest {
  ability_ref: string
  validation_mode: "smoke_validation"
  profile_ref: string
  requested_execution_layer: "L3" | "L2" | "L1"
  expected_capability_kind: "read" | "download"
  smoke_input: Record<string, unknown>
}
```

## 2. `ability_replay_request`

```ts
type AbilityReplayRequest =
  | {
      ability_ref: string
      profile_ref: string
      requested_execution_layer: "L3" | "L2" | "L1"
      expected_capability_kind: "read" | "download"
      replay_source: "last_success_input"
      replay_reason: string
    }
  | {
      ability_ref: string
      profile_ref: string
      requested_execution_layer: "L3" | "L2" | "L1"
      expected_capability_kind: "read" | "download"
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
  execution_layer: "L3" | "L2" | "L1"
  captured_input_contract_ref: string
  source_run_id: string
  payload_locator: string
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
  validated_execution_layer: "L3" | "L2" | "L1"
  baseline_descriptor: {
    entrypoint: string
    input_contract_ref: string
    output_contract_ref: string
    error_contract_ref: string
    profile_ref: string
    execution_layer_support: ["L3" | "L2" | "L1", ...Array<"L3" | "L2" | "L1">]
  }
  artifact_refs?: string[]
}

interface AbilityHealthView {
  ability_ref: string
  profile_ref: string
  execution_layer: "L3" | "L2" | "L1"
  health_state: "unknown" | "healthy" | "degraded" | "broken" | "stale"
  validation_coverage_state: "none" | "smoke_only" | "replay_only" | "smoke_plus_replay" | "divergent"
  latest_validations: LatestValidationByMode[]
  last_success_input_ref?: string
  divergence_reason?: "smoke_replay_mismatch"
}
```

约束：

- `health_state` 只表达“现在是否可用”的最小可信判断，不表达是否可交付；`validation_coverage_state` 只表达验证覆盖度，不替代顶层可用性判断。
- `failure_class` 只表达用户可读的大类，不替代低层错误码。
- `FR-0018` 当前 formal trust domain 只覆盖 `candidate_ability_descriptor.ability_kind=read|download`；`write` descriptor 必须停留在 FR-0017 的 capture evidence 域，当前不得物化普通 `ability_health_view`、`latest_validations` 或 `last_success_input_ref`。
- `validation_mode=smoke_validation` 时，`smoke_input` 必须存在，且必须满足 `FR-0017.candidate_ability_descriptor.input_contract_ref` 的最小输入边界。
- `ability_validation_request.requested_execution_layer` 必须存在，且必须落在目标 `candidate_ability_descriptor.execution_layer_support` 之内；请求不得在未显式指定执行层时宣称“当前可用”。
- `validation_mode=smoke_validation` 在当前 formal baseline 下只允许用于 `expected_capability_kind=read|download`；`write` 如需最小验证，必须在未来独立 FR 中冻结新的请求形态与 gate 元数据。
- `expected_capability_kind` 如保留在请求面，必须直接等于 `FR-0017.candidate_ability_descriptor.ability_kind`；若不一致，验证层必须以结构化输入错误拒绝请求，不得自行容忍或改写。
- `ability_replay_request.expected_capability_kind` 在当前 formal baseline 下也只允许 `read|download`，并且必须直接等于目标 `candidate_ability_descriptor.ability_kind`；不一致时不得执行 replay，也不得写入 `replay_validation` latest。
- `ability_replay_request.requested_execution_layer` 必须存在，且必须落在目标 `candidate_ability_descriptor.execution_layer_support` 之内；重放资格必须按 execution layer 作用域单独判断。
- `replay_source=explicit_input_snapshot` 时，`ability_replay_request.replay_input_ref` 必须存在；`replay_source=last_success_input` 时不得伪造显式 snapshot 引用。
- `ability_ref` 在本 FR 中必须直接等于 `FR-0017.candidate_ability_descriptor.ability_id`；FR-0018 不再引入独立的 ability 引用命名空间或二次映射对象。
- `replay_input_ref` 只允许出现在 `replay_source=explicit_input_snapshot` 分支，且只能引用既有的 `ReplayInputSnapshotRef.snapshot_ref`；`replay_source=last_success_input` 分支必须缺省该字段。
- 对新进入 `FR-0018` 的能力，若 `FR-0017.candidate_ability_descriptor.seed_replay_input_ref` 已存在，则它必须作为首个 `ReplayInputSnapshotRef` 的正式上游 seed，且只允许落在 `capture_profile + capture_origin` 对应执行层的健康视图内；descriptor 其他受支持执行层不得因此自动获得 replay eligibility。
- `ReplayInputSnapshotRef.payload_locator` 是 replay snapshot 的正式可解析 payload 边界；重放层必须通过该 locator 重新取回保存输入，不得仅靠 `source_run_id`、artifact refs 或带外扫描临时反推。
- `ReplayInputSnapshotRef.payload_locator` 必须是 FR-0018 replay-store owned 的稳定 locator，而不是临时文件路径、进程内句柄或 run-scoped artifact URL；消费者只能通过该 replay-store resolver 把它解析为唯一的 captured input payload。
- `ReplayInputSnapshotRef.payload_locator` 的有效期必须至少与所属 `snapshot_ref` 一致；只要该 snapshot 仍可被 `replay_input_ref` 或 `last_success_input_ref` 引用，locator 就不得被提前删除、覆写或回收。
- `ReplayInputSnapshotRef.payload_locator` 的 cleanup 只能发生在所属 `snapshot_ref` 已正式退休，且不再被任何当前 `replay_input_ref` / `last_success_input_ref` 引用之后；在此之前，实现不得把 cleanup 留给临时目录生命周期或 run artifact 保留策略碰运气。
- `ReplayInputSnapshotRef.captured_input_contract_ref` 必须记录该快照满足的 `input_contract_ref` 版本；当前 descriptor 的 `input_contract_ref` 发生不兼容变化后，旧 snapshot 不得继续作为可执行 replay 输入。
- `ability_validation_request` 是唯一的 smoke 请求契约；所有 replay 执行必须只通过 `ability_replay_request` 发起，`latest_validations.validation_mode=replay_validation` 也只能由 replay 请求结果写入。
- 任何 replay 持久化 / 投影对象都只能表达 `ability_replay_request` 的存储投影，不得再冻结第二套 replay 请求契约或 `ready` 一类独立状态位。
- 若上游未提供 `seed_replay_input_ref`，则同一 `ability_ref + profile_ref + requested_execution_layer` 下首次成功的 `smoke_validation.smoke_input` 或成功 replay 的已解析输入必须物化为首个 `ReplayInputSnapshotRef`；仅当 `candidate_ability_descriptor.ability_kind` 属于非状态变更能力时，才允许继续回写为同 layer 视图的 `ability_health_view.last_success_input_ref`。
- 非 `capture_profile` 的其他 profile 视图，或 descriptor 其他受支持 execution layer 视图，都不得继承这条初始 seed；它们只能在各自作用域下首次成功验证/重放后刷新自己的 `last_success_input_ref`。
- `candidate_ability_descriptor.ability_kind=write` 时，当前 formal baseline 不允许把 `seed_replay_input_ref`、`last_success_input_ref`、`replay_source=last_success_input` 或 `replay_source=explicit_input_snapshot` 解释为可执行 replay 入口；显式 snapshot 也只能作为 capture evidence 保留，不能绕过当前缺失的 `requested_execution_mode`、`effective_execution_mode` 与 gate / audit 元数据。
- `profile_ref` 与 `execution_layer` 共同构成 `ability_health_view` 的正式隔离维度；不同 profile 或不同 execution layer 都不得共享同一条聚合健康视图。该规则只适用于当前 FR-0018 支持域内的 `read|download` descriptor 视图。
- `ability_replay_request.profile_ref` 与 `ability_replay_request.requested_execution_layer` 都必须与目标 `ability_health_view` 一致；不得在 replay 时跨 profile 或跨 execution layer 读取 `last_success_input`。
- `last_success_input` 的正式 truth source 是同一 `ability_ref + profile_ref + execution_layer` 视图内的 `ability_health_view.last_success_input_ref`；该值为空时，请求不得被视为可执行 replay。
- `ability_health_view.last_success_input_ref` 如存在，也必须指向同一 `ability_ref + profile_ref + execution_layer` 视图内的 `ReplayInputSnapshotRef.snapshot_ref`，并且该 snapshot 的 `captured_input_contract_ref` 必须直接等于当前 descriptor 的 `input_contract_ref`；否则必须拒绝复用并要求 fresh smoke/replay capture。
- `health_state=unknown` 只允许用于当前 FR-0018 支持域内、尚不存在任何 mode latest 的 `read|download` descriptor；`write` 不得被压扁成普通 `unknown`。
- `run_id` 是最近一次验证成立的最小硬证据锚点，不建立第二套运行真相源。
- `artifact_refs` 只作为补充的 run-scoped evidence refs；在上游等价 evidence carrier 正式冻结前，不得把它当作 latest 记录成立的前置条件。
- 在同一 `ability_ref + profile_ref + execution_layer` 视图内，`latest_validations` 中每个 `validation_mode` 最多只能出现一条 latest 记录。
- `latest_validations[*]` 一旦存在，就必须同时具备 `validated_at` 与 `run_id`；若存在 run-scoped evidence refs，可再补充 `artifact_refs`。
- `latest_validations[*].validated_execution_layer` 必须记录该条 latest 实际跑通的执行层；它来自 invocation layer，而不是 descriptor 的支持层集合，并且必须直接等于所在 `ability_health_view.execution_layer`。
- `latest_validations[*].baseline_descriptor` 必须冻结该条 latest 结果生成时的 descriptor/profile 基线，至少包含 `entrypoint`、`input_contract_ref`、`output_contract_ref`、`error_contract_ref`、`profile_ref`、`execution_layer_support`；其中 `execution_layer_support` 在 layer-scoped health 模型里仍要被记录为证据快照，但不再要求与当前 support set 完整相等才算 current。
- `result_state=verified`：该 mode 最近一次验证成功，且 `failure_class` 必须为空。
- `result_state=broken`：该 mode 最近一次验证失败，且必须给出 `failure_class`。
- `result_state=stale`：该 mode 存在历史验证结果，但因 `validated_at` 超过 7 天 freshness window，或当前 descriptor 基线中的 `entrypoint` / contract refs / `profile_ref` 与 `baseline_descriptor` 不一致，或当前 `execution_layer_support` 已不再覆盖 `validated_execution_layer`，当前不能继续宣称可信；该记录仍必须保留最近一次已完成验证的证据字段。
- “current latest” 只指 `latest_validations[*].result_state` 不为 `stale` 的 mode latest；其 freshness window 与 `baseline_descriptor` 一致性由 stale 规则统一收敛。
- 当需要判断当前 `execution_layer_support` 是否仍覆盖 `validated_execution_layer` 时，比较必须按归一化集合语义完成，而不是按数组顺序比较。
- 若当前 `execution_layer_support` 只是新增或删除了与该视图 `execution_layer` 无关的其他支持层，而 `validated_execution_layer` 仍被覆盖，则该条 latest 不得仅因 support set 变化而失效为 `stale`。
- 每条 latest 只证明自己的 `validated_execution_layer` 曾被验证；不得把同一条 latest 自动外推为 descriptor 其他支持层也已被验证。
- `ability_health_view.health_state` 必须按以下顺序判定，后续分支不得覆盖前序已命中的状态：
  1. `unknown`：不存在任何 mode latest 记录
  2. `stale`：存在 mode latest，且全部现存 latest 都是 `stale`
  3. `healthy`：至少存在一条 current latest 为 `verified`，且不存在任何 current latest 为 `broken`
  4. `degraded`：同时存在 current `verified` latest 与 current `broken` latest
  5. `broken`：不存在任何 current `verified` latest，但至少存在一条 current latest 为 `broken`
- `ability_health_view.validation_coverage_state` 必须按以下顺序判定，后续分支不得覆盖前序已命中的状态：
  1. `none`：不存在任何 current latest
  2. `smoke_only`：只有 `smoke_validation` 的 current latest 为 `verified`
  3. `replay_only`：只有 `replay_validation` 的 current latest 为 `verified`
  4. `smoke_plus_replay`：`smoke_validation` 与 `replay_validation` 的 current latest 都存在，且都为 `verified`
  5. `divergent`：除以上情况外的其余所有 current latest 组合，包括任一 current latest 为 `broken`，或 smoke/replay current latest 结果不一致
- `smoke_validation` 成功可以作为“能力仍可用”的最小证据；但当前 formal baseline 下它只适用于非状态变更能力。仅当 `candidate_ability_descriptor.ability_kind` 属于非状态变更能力时，才允许建立首个 `last_success_input_ref`，并在只有 smoke current latest 为 `verified` 时呈现 `health_state=healthy + validation_coverage_state=smoke_only`。
- 如未来要支持 `ability_kind=write` 的最小验证，必须先在独立 FR 中冻结显式 `requested_execution_mode`、`effective_execution_mode` 与 gate / audit 元数据；在此之前，任何 write smoke 结果都不得被消费为 current healthy evidence。
- `divergence_reason` 只允许在 `validation_coverage_state=divergent` 的真实冲突场景出现；当前正式枚举只允许 `smoke_replay_mismatch`。
