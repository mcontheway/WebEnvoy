# FR-0019 契约：L2 首次可用能力

## 1. `l2_first_usable_request`

说明：本 FR 只冻结站点无关的最小 `L2RiskGateContext`，并保持 read-first 基线；不直接复用 `FR-0010.gate_input` 这类平台专用 gate 请求对象。

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

interface L2FirstUsableRequest {
  target_url: string
  goal_kind: "read"
  interaction_safety_class: "pure_read"
  goal_hint?: string
  risk_gate_context: L2RiskGateContext
  allowed_actions: Array<"navigate" | "locate" | "reveal_only_click" | "extract" | "wait_settled">
}
```

约束：

- 共享能力目标类型仍为 `read` / `write` / `download`；当前 FR 的请求面只冻结 `read`，`write` / `download` 仍保留在上游共享模型中，但不属于本 FR 的可请求能力。
- `risk_gate_context` 是未知网站通用 L2 的最小门禁坐标对象，不是 `FR-0010.gate_input` 的别名；XHS 或其他平台专用 gate 请求对象如需复用，必须先映射到该最小上下文。
- `risk_gate_context.session_id` 只在 runtime 已产出稳定会话标识时携带；当前 formal baseline 下它不是构造通用 L2 请求的硬前置。
- `risk_gate_context.target_tab_id` 与 `risk_gate_context.target_page` 必须共同存在；`target_url` 的域名必须能回链到 `risk_gate_context.target_domain`。
- 当前 FR 保持 read-first；未知站点通用 `write` lane 不在本次 formal baseline 内冻结，如需进入正式请求面，必须在未来独立 FR 中同时补齐验证与治理路径。
- `goal_kind` 在当前 FR 中固定为 `read`；`interaction_safety_class` 在当前 FR 中固定为 `pure_read`。
- `risk_gate_context.risk_state=paused` 时，请求必须直接返回 `failure_class=risk_gate_blocked`，不得进入 read-first 执行路径。
- `risk_gate_context.risk_state=limited` 在本 FR 中表示“只允许受控范围”；当前 formal baseline 下，`goal_kind=read + interaction_safety_class=pure_read` 属于允许执行的受控路径，不得因状态为 `limited` 而默认阻断。
- `risk_gate_context.risk_state=allowed` 时，同样允许执行当前 read-first 路径；因此对本 FR 而言，可执行状态固定为 `limited | allowed`，阻断状态固定为 `paused`。
- `allowed_actions` 只允许 `navigate`、`locate`、`reveal_only_click`、`extract`、`wait_settled`；request-side 不再允许裸 `click`，以便在执行前就把揭示型点击和状态改变点击区分开。`reveal_only_click` 只允许 `expand_or_collapse`、`switch_content_tab`、`open_detail_view`、`load_more_or_paginate`。
- `goal_kind=read` 时，`allowed_actions` 必须显式包含 `extract`；若请求没有授权 `extract`，则它与 `success=true` 所要求的读取完成条件冲突，必须在请求阶段按结构化输入错误拒绝。
- request-side `allowed_actions=reveal_only_click` 与 trace-side `interaction_trace[*].action=click + interaction_semantics=reveal_only_click` 是同一类受允许动作的正式翻译关系；bare `action=click` 且没有 `interaction_semantics=reveal_only_click` 不得被当作已授权的 pure-read 点击。
- `interaction_safety_class=pure_read` 时，不得放行 `type`、submit、confirm、publish、purchase、dispatch、bind，或任何会持久改变账号、内容或表单状态的点击。
- 若上游门禁请求仍携带平台专用 write lane、`irreversible_write` 或其他站点专用 gate 语义，必须在进入 `L2FirstUsableRequest` 前直接被阻断；FR-0019 当前不消费这类输入。

## 2. `l2_first_usable_result`

```ts
interface FirstUsableTraceStep {
  step_id: string
  action: string
  target_hint: string
  result: string
}

interface NonClickInteractionTraceStep {
  action: "navigate" | "locate" | "extract" | "wait_settled"
  target_ref: string
  settled: boolean
  interaction_semantics: "neutral"
}

interface RevealOnlyClickInteractionTraceStep {
  action: "click"
  target_ref: string
  settled: boolean
  interaction_semantics: "reveal_only_click"
  click_kind: "expand_or_collapse" | "switch_content_tab" | "open_detail_view" | "load_more_or_paginate"
}

type InteractionTraceStep = NonClickInteractionTraceStep | RevealOnlyClickInteractionTraceStep

interface L1FallbackPayload {
  fallback_goal: "read"
  fallback_reason: "insufficient_semantic_structure" | "target_not_located" | "state_not_settled"
  recommended_strategy: "visual_reacquire" | "visual_state_check" | "visual_then_physical_act"
}

interface CandidateContractRegistrySeedEntry {
  contract_ref: string
  contract_kind: "input" | "output" | "error"
  contract_body: Record<string, unknown>
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
        ability_kind: "read"
        entrypoint: string
        platform_scope: {
          platform_family: string
          site_pattern?: string
        }
        execution_layer_support: ["L2"]
        input_contract_ref: string
        output_contract_ref: string
        error_contract_ref: string
        capture_origin: "l2_first_usable_sample"
        capture_run_id: string
        capture_profile: string
        capture_artifact_refs?: string[]
        captured_at: string
        candidate_status: "draft_candidate"
        contract_registry_seed: {
          ability_id: string
          entries: CandidateContractRegistrySeedEntry[]
        }
      }
    }
  | {
      success: false
      failure_class: "risk_gate_blocked"
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
- `candidate_shell_seed` 必须足以直接物化 `FR-0017.candidate_ability_descriptor` 的必填字段，并同时提供 descriptor-owned `candidate_ability_contract_registry` 的最小 seed，不允许只留下松散 hint 或无法解引用的 `*_contract_ref`。
- `success=true` 时，`candidate_shell_seed.ability_kind` 必须直接等于本次请求的 `goal_kind=read`；若 handoff seed 与请求目标不一致，不得返回成功结果。
- `interaction_safety_class` 只描述本次首次可用路径的动作纯度，不改变 `candidate_shell_seed.ability_kind`；当前 formal baseline 下，`pure_read` 必须自然映射回 `read`。
- `candidate_shell_seed.execution_layer_support` 必须显式声明为单元素 `["L2"]`；成功 handoff 不得省略该字段，也不得以空数组冒充支持 L2。
- `candidate_shell_seed.platform_scope.platform_family` 必须使用稳定、归一化的平台键；L2 未知网站默认应落在 `generic_web`，不得把新的一等平台永久冻结进 `other`。
- `candidate_shell_seed.contract_registry_seed.ability_id` 必须直接等于 `candidate_shell_seed.ability_id`；`entries[*].contract_ref` 必须至少覆盖 `input_contract_ref`、`output_contract_ref`、`error_contract_ref` 三个被引用的正式 contract ref。
- `success=true` 还要求 `candidate_shell_seed.contract_registry_seed` 先满足 `FR-0017.candidate_ability_contract_registry` 的有效性规则：同一 `contract_ref` 不得出现多条冲突 entry，`entries[*].contract_kind` 必须与 ref kind 一致，且下游对 `input_contract_ref`、`output_contract_ref`、`error_contract_ref` 的 lookup 都必须能得到唯一有效结果。
- `success=true` 时，`result_summary`、`first_usable_trace`、`interaction_trace`、`capture_hints`、`candidate_shell_seed` 必须同时存在。
- 当前 read-first baseline 下，`success=true` 必须已经完成实际读取，而不是只完成 reveal-only click、导航、定位或等待收敛等支持步骤。
- `success=true` 时，`result_summary` 必须携带满足 `output_contract_ref` 的实际读取结果，且 `interaction_trace` 中必须至少出现一条 `action=extract` 的读取步骤。
- `reveal_only_click` 仍然合法，但只允许作为 `extract` 之前的支持步骤；不得单独充当 `success=true` 的证明。
- `success=false` 时，`failure_class` 必须存在，且不得返回 `candidate_shell_seed`；其余字段允许按失败停点最小化返回。
- `failure_class=requires_l1_fallback` 时，`l1_fallback_payload` 必须存在，并至少冻结 `fallback_goal`、`fallback_reason`、`recommended_strategy`；不得只返回自由文本建议。
- 当 L2 因 `insufficient_semantic_structure`、`target_not_located`、`state_not_settled` 三类原因停止时，顶层 `failure_class` 必须统一写成 `requires_l1_fallback`，并通过 `l1_fallback_payload.fallback_reason` 细分，不得再平铺成独立失败分支。
- `l1_fallback_payload.fallback_reason` 只允许表达触发 L2 停止并移交 L1 的最小原因：语义结构不足、目标连续无法定位、或状态始终无法收敛。
- `l1_fallback_payload.recommended_strategy` 只描述 L1 下一步最小方向，不在本 FR 中扩张成完整 L1 工作流或自动切换编排。
- 非 `requires_l1_fallback` 的失败分支不得伪造 `l1_fallback_payload`。
- 当前 FR 只允许把 `read` 首次成功路径交给 `FR-0017`；`write` / `download` 如需进入 L2 first-usable，必须在独立 FR 中先冻结其最小执行语义、验证与治理边界。
- `first_usable_trace` 与 `interaction_trace` 的正式类型都是结构化步骤对象数组，不允许在 contract / data-model 间一处写成对象、一处退回 `string[]`。
- `interaction_trace[*].interaction_semantics` 是正式机器字段：`neutral` 只允许出现在非点击步骤；`reveal_only_click` 只允许出现在 `action=click` 且 `goal_kind=read` / `interaction_safety_class=pure_read` 的路径中。
- `interaction_trace[*].click_kind` 只允许在 `interaction_semantics=reveal_only_click` 时出现，且当前 pure-read 成功路径中的点击步骤必须显式落在 `expand_or_collapse`、`switch_content_tab`、`open_detail_view`、`load_more_or_paginate` 四类枚举之内。
- 当 request-side `allowed_actions` 里放行 `reveal_only_click` 时，trace-side 必须把该动作编码为 `action=click + interaction_semantics=reveal_only_click`；两侧不得各自发明平行动作词汇。
- `failure_class` 只表达最小失败大类，不替代低层错误码或诊断全文。
