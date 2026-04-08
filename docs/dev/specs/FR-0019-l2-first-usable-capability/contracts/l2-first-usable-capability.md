# FR-0019 契约：L2 首次可用能力

## 1. `l2_first_usable_request`

说明：本 FR 只冻结站点无关的最小 `L2RiskGateContext`，不直接复用 `FR-0010.gate_input` 这类平台专用 gate 请求对象。

```ts
interface L2RiskGateContext {
  run_id: string
  session_id?: string
  profile: string
  target_domain: string
  target_tab_id: number
  target_page: string
  risk_state: "paused" | "limited" | "allowed"
}

type L2FirstUsableRequest =
  | {
      target_url: string
      goal_kind: "read"
      interaction_safety_class: "pure_read"
      goal_hint?: string
      risk_gate_context: L2RiskGateContext
      allowed_actions: Array<"navigate" | "locate" | "click" | "extract" | "wait_settled">
    }
  | {
      target_url: string
      goal_kind: "write"
      interaction_safety_class: "state_changing_write"
      goal_hint?: string
      risk_gate_context: L2RiskGateContext
      allowed_actions: Array<"navigate" | "locate" | "click" | "type" | "extract" | "wait_settled">
      write_gate_audit_refs: {
        decision_id: string
        approval_record_ref: string
        audit_record_ref: string
      }
      write_safety_boundary: {
        irreversible_controls_blocked: true
        blocked_control_kinds: Array<"submit" | "publish" | "purchase" | "confirm_final" | "destructive_action" | "financial_commitment" | "external_dispatch" | "account_binding">
      }
    }
```

约束：

- 共享能力目标类型仍为 `read` / `write` / `download`；当前 FR 的请求面只冻结 `read` / `write`，`download` 仍保留在上游共享模型中，但不属于本 FR 的可请求能力。
- `risk_gate_context` 是未知网站通用 L2 的最小门禁坐标对象，不是 `FR-0010.gate_input` 的别名；XHS 或其他平台专用 gate 请求对象如需复用，必须先映射到该最小上下文。
- `risk_gate_context.session_id` 只在 runtime 已产出稳定会话标识时携带；当前 formal baseline 下它不是构造通用 L2 请求的硬前置。
- `risk_gate_context.target_tab_id` 与 `risk_gate_context.target_page` 必须共同存在；`target_url` 的域名必须能回链到 `risk_gate_context.target_domain`。
- `goal_kind` 是本 FR 唯一正式的能力目标类型；`interaction_safety_class` 是与之分离的正式动作纯度字段；请求面不得引入 `irreversible_write`、`requested_execution_mode` 或平台专用 live lane 枚举。
- 若上游仍持有 `irreversible_write`、平台专用 live lane 或其他站点专用 gate 语义，必须在进入 `L2FirstUsableRequest` 前就阻断或归一化；FR-0019 不接受这类输入穿透到通用请求面。
- `goal_kind=read` 时，`interaction_safety_class` 必须固定为 `pure_read`；`goal_kind=write` 时，`interaction_safety_class` 必须固定为 `state_changing_write`。
- `goal_kind=read` 时，`allowed_actions` 只允许 `navigate`、`locate`、`click`、`extract`、`wait_settled`；其中 `click` 的正式语义必须固定为 `reveal_only_click`，只允许 `expand_or_collapse`、`switch_content_tab`、`open_detail_view`、`load_more_or_paginate`。
- `interaction_safety_class=pure_read` 时，不得放行 `type`、submit、confirm、publish、purchase、dispatch、bind，或任何会持久改变账号、内容或表单状态的点击。
- `goal_kind=write` 时，`write_gate_audit_refs` 必须存在，并且必须保留同一门禁结论上的 `decision_id`、`approval_record_ref`、`audit_record_ref` 三条机器回链；三者的正式语义必须分别对齐 `FR-0010.gate_outcome.decision_id`、`FR-0010.approval_record.approval_id`、`FR-0010.audit_record.event_id`。
- `goal_kind=write` 时，`write_gate_audit_refs` 只允许引用同一次 `gate_decision=allowed` 的门禁放行记录；缺少任一引用，或三者无法回链到同一放行决策时，不得进入成功路径。
- `goal_kind=write` 且 `risk_gate_context.risk_state` 不是 `allowed` 时，不得进入成功路径；实现层必须返回 `risk_gate_blocked` 或更早阻断。
- `goal_kind=write` 时，`write_safety_boundary` 必须存在，并且必须明确阻断不可逆控件；未知站点的 `write` 范围不允许覆盖 submit、publish、purchase、final confirm，以及更泛化的 destructive action、financial commitment、external dispatch、account binding 一类动作。

## 2. `l2_first_usable_result`

```ts
interface FirstUsableTraceStep {
  step_id: string
  action: string
  target_hint: string
  result: string
}

interface InteractionTraceStep {
  action: "navigate" | "locate" | "click" | "type" | "extract" | "wait_settled"
  target_ref: string
  settled: boolean
  interaction_semantics: "neutral" | "reveal_only_click" | "state_changing_write"
  click_kind?: "expand_or_collapse" | "switch_content_tab" | "open_detail_view" | "load_more_or_paginate"
}

interface L1FallbackPayload {
  fallback_goal: "read" | "write"
  fallback_reason: "insufficient_semantic_structure" | "target_not_located" | "state_not_settled"
  recommended_strategy: "visual_reacquire" | "visual_state_check" | "visual_then_physical_act"
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
        ability_kind: "read" | "write"
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
      failure_class: "insufficient_semantic_structure" | "target_not_located" | "state_not_settled" | "risk_gate_blocked"
      result_summary?: Record<string, unknown>
      first_usable_trace?: FirstUsableTraceStep[]
      interaction_trace?: InteractionTraceStep[]
      capture_hints?: Record<string, unknown>
    }
  | {
      success: false
      failure_class: "requires_l1_fallback"
      l1_fallback_payload: L1FallbackPayload
      result_summary?: Record<string, unknown>
      first_usable_trace?: FirstUsableTraceStep[]
      interaction_trace?: InteractionTraceStep[]
      capture_hints?: Record<string, unknown>
    }
```

约束：

- `candidate_shell_seed` 只作为进入 `FR-0017` 的 handoff 输入。
- `candidate_shell_seed` 必须足以直接物化 `FR-0017.candidate_ability_descriptor` 的必填字段，不允许只留下松散 hint。
- `success=true` 时，`candidate_shell_seed.ability_kind` 必须直接等于本次请求的 `goal_kind`；若 handoff seed 与请求目标不一致，不得返回成功结果。
- `interaction_safety_class` 只描述本次首次可用路径的动作纯度，不改变 `candidate_shell_seed.ability_kind`；`pure_read` / `state_changing_write` 必须分别自然映射回 `read` / `write`。
- `candidate_shell_seed.platform_scope.platform_family` 必须使用稳定、归一化的平台键；L2 未知网站默认应落在 `generic_web`，不得把新的一等平台永久冻结进 `other`。
- `success=true` 时，`result_summary`、`first_usable_trace`、`interaction_trace`、`capture_hints`、`candidate_shell_seed` 必须同时存在。
- `success=false` 时，`failure_class` 必须存在，且不得返回 `candidate_shell_seed`；其余字段允许按失败停点最小化返回。
- `failure_class=requires_l1_fallback` 时，`l1_fallback_payload` 必须存在，并至少冻结 `fallback_goal`、`fallback_reason`、`recommended_strategy`；不得只返回自由文本建议。
- `l1_fallback_payload.fallback_reason` 只允许表达触发 L2 停止并移交 L1 的最小原因：语义结构不足、目标连续无法定位、或状态始终无法收敛。
- `l1_fallback_payload.recommended_strategy` 只描述 L1 下一步最小方向，不在本 FR 中扩张成完整 L1 工作流或自动切换编排。
- 非 `requires_l1_fallback` 的失败分支不得伪造 `l1_fallback_payload`。
- 当前 FR 只允许把 `read` / `write` 首次成功路径交给 `FR-0017`；`download` 如需进入 L2 first-usable，必须在独立 FR 中先冻结其最小执行语义与结果形态。
- `first_usable_trace` 与 `interaction_trace` 的正式类型都是结构化步骤对象数组，不允许在 contract / data-model 间一处写成对象、一处退回 `string[]`。
- `interaction_trace[*].interaction_semantics` 是正式机器字段：`reveal_only_click` 只允许出现在 `action=click` 且 `goal_kind=read` / `interaction_safety_class=pure_read` 的路径中；`state_changing_write` 只允许出现在 `goal_kind=write` 的路径中。
- `interaction_trace[*].click_kind` 只允许在 `interaction_semantics=reveal_only_click` 时出现，且必须显式落在 `expand_or_collapse`、`switch_content_tab`、`open_detail_view`、`load_more_or_paginate` 四类枚举之内。
- `failure_class` 只表达最小失败大类，不替代低层错误码或诊断全文。
