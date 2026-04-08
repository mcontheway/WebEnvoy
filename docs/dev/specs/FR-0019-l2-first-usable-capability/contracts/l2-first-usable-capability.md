# FR-0019 契约：L2 首次可用能力

## 1. `l2_first_usable_request`

```ts
interface L2FirstUsableRequest {
  target_url: string
  goal_kind: "read" | "write" | "download"
  goal_hint?: string
  allowed_actions: Array<"navigate" | "snapshot" | "click" | "type" | "extract" | "wait_settled">
}
```

约束：

- `goal_kind` 必须与 Phase 2 共享能力面保持一致：`read` / `write` / `download`。
- 本 FR 中的最小基础交互统一归入 `write`，但不等于恢复高风险 live 写路径或账号敏感提交。
- `download` 在当前 FR 中允许保持模型预留，但不得从对象边界中缺位。

## 2. `l2_first_usable_result`

```ts
interface FirstUsableTraceStep {
  step_id: string
  action: string
  target_hint: string
  result: string
}

interface InteractionTraceStep {
  action: string
  target_ref: string
  settled: boolean
}

type L2FirstUsableResult =
  | {
      success: true
      result_summary: Record<string, unknown>
      first_usable_trace: FirstUsableTraceStep[]
      interaction_trace: InteractionTraceStep[]
      capture_hints: Record<string, unknown>
      candidate_shell_seed: {
        ability_id: string
        display_name: string
        ability_kind: "read" | "write" | "download"
        entrypoint: string
        platform_scope: {
          platform_family: string
          site_pattern?: string
        }
        execution_layer_support: Array<"L2">
        input_contract_ref: string
        output_contract_ref: string
        error_contract_ref: string
        capture_origin: "l2_first_usable_sample"
        capture_run_id: string
        capture_profile: string
        capture_artifact_refs?: string[]
        captured_at: string
        candidate_status: "draft_candidate"
      }
    }
  | {
      success: false
      failure_class: "insufficient_semantic_structure" | "target_not_located" | "state_not_settled" | "risk_gate_blocked" | "requires_l1_fallback"
      result_summary?: Record<string, unknown>
      first_usable_trace?: FirstUsableTraceStep[]
      interaction_trace?: InteractionTraceStep[]
      capture_hints?: Record<string, unknown>
      candidate_shell_seed?: {
        ability_id: string
        display_name: string
        ability_kind: "read" | "write" | "download"
        entrypoint: string
        platform_scope: {
          platform_family: string
          site_pattern?: string
        }
        execution_layer_support: Array<"L2">
        input_contract_ref: string
        output_contract_ref: string
        error_contract_ref: string
        capture_origin: "l2_first_usable_sample"
        capture_run_id: string
        capture_profile: string
        capture_artifact_refs?: string[]
        captured_at: string
        candidate_status: "draft_candidate"
      }
    }
```

约束：

- `candidate_shell_seed` 只作为进入 `FR-0017` 的 handoff 输入。
- `candidate_shell_seed` 必须足以直接物化 `FR-0017.candidate_ability_descriptor` 的必填字段，不允许只留下松散 hint。
- `candidate_shell_seed.platform_scope.platform_family` 必须使用稳定、归一化的平台键；L2 未知网站默认应落在 `generic_web`，不得把新的一等平台永久冻结进 `other`。
- `success=true` 时，`result_summary`、`first_usable_trace`、`interaction_trace`、`capture_hints`、`candidate_shell_seed` 必须同时存在。
- `success=false` 时，`failure_class` 必须存在；其余字段允许按失败停点最小化返回。
- `first_usable_trace` 与 `interaction_trace` 的正式类型都是结构化步骤对象数组，不允许在 contract / data-model 间一处写成对象、一处退回 `string[]`。
- `failure_class` 只表达最小失败大类，不替代低层错误码或诊断全文。
