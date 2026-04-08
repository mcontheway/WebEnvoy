# FR-0019 数据模型

## 1. `first_usable_trace`

用途：

- 记录首次成功路径的最小步骤序列，供后续候选能力整理使用
- 正式类型为 `FirstUsableTraceStep[]`

最小字段：

- `step_id`
- `action`
- `target_hint`
- `result`

## 2. `interaction_trace`

用途：

- 记录本次 L2 首次可用过程中的最小交互序列
- 正式类型为 `InteractionTraceStep[]`

最小字段：

- `action`
- `target_ref`
- `settled`
- `interaction_semantics`

可选字段：

- `click_kind`

补充约束：

- `interaction_semantics` 是正式机器字段，只允许 `neutral`、`reveal_only_click`、`state_changing_write`。
- `interaction_semantics=reveal_only_click` 只允许与 `action=click` 一起出现，且当前正式 `click_kind` 只允许 `expand_or_collapse`、`switch_content_tab`、`open_detail_view`、`load_more_or_paginate`。
- `interaction_semantics=state_changing_write` 只允许出现在 `goal_kind=write` 的交互路径中。
- `click_kind` 只允许在 `interaction_semantics=reveal_only_click` 时出现；其他交互不得伪造该字段。

## 3. `candidate_shell_seed`

用途：

- 为 `FR-0017` 提供最小 handoff 输入

最小字段：

- `ability_id`
- `display_name`
- `ability_kind`
- `entrypoint`
- `platform_scope`
- `execution_layer_support=["L2"]`
- `input_contract_ref`
- `output_contract_ref`
- `error_contract_ref`
- `capture_origin="l2_first_usable_sample"`
- `capture_run_id`
- `capture_profile`
- `captured_at`
- `candidate_status="draft_candidate"`

补充约束：

- L2 首次可用成功态必须同时产出 `result_summary`、`first_usable_trace`、`interaction_trace`、`capture_hints`、`candidate_shell_seed`。
- 当前 FR 产出的 `candidate_shell_seed.ability_kind` 只允许 `read` / `write`；`download` 仍保留给上游共享模型与后续独立 FR。
- `candidate_shell_seed.ability_kind` 必须直接等于本次请求 `goal_kind`；若 handoff seed 与请求目标不一致，不得落成成功态结果。
- `capture_artifact_refs` 如存在，只能作为 `capture_run_id` 下的补充 evidence refs；在上游等价 evidence carrier 正式冻结前，不得把它设为 handoff 成立的强制前置。

## 4. `write_safety_boundary`

用途：

- 在未知站点 `goal_kind=write` 时，提供机器可读的最小安全边界，防止 L2 first-usable 进入不可逆 live-write 路径

最小字段：

- `irreversible_controls_blocked=true`
- `blocked_control_kinds=["submit" | "publish" | "purchase" | "confirm_final" | "destructive_action" | "financial_commitment" | "external_dispatch" | "account_binding"]`

补充约束：

- `write_safety_boundary` 只在 `goal_kind=write` 时出现，`goal_kind=read` 不得伪造。
- 命中 `blocked_control_kinds` 的未知站点控件不得被纳入 L2 first-usable 成功路径；实现层必须返回失败或 fallback，而不是继续推进不可逆动作。

## 5. `write_gate_audit_refs`

用途：

- 在未知站点 `goal_kind=write` 时，把审批与审计链路以机器可读引用留在通用 L2 写入门禁上，避免写路径脱离正式 gate/audit 体系

最小字段：

- `decision_id`
- `approval_record_ref`
- `audit_record_ref`

补充约束：

- `write_gate_audit_refs` 只在 `goal_kind=write` 时出现，`goal_kind=read` 不得伪造。
- 三个字段的正式语义必须分别对齐 `FR-0010.gate_outcome.decision_id`、`FR-0010.approval_record.approval_id`、`FR-0010.audit_record.event_id`。
- 三个字段必须回链到同一次 `gate_decision=allowed` 的放行结论；任一引用缺失、失配或不能回链到同一决策时，不得进入 L2 first-usable 成功路径。
- `write_gate_audit_refs` 只承担门禁追溯与审计回链，不替代 `write_safety_boundary` 对未知站点控件边界的限制。

## 6. `interaction_safety_class`

用途：

- 把“目标类型是 read 还是 write”和“本次执行允许的动作纯度”拆成两个正式语义轴

最小字段：

- `interaction_safety_class`

允许值：

- `pure_read`
- `state_changing_write`

补充约束：

- `goal_kind=read` 时必须固定映射到 `interaction_safety_class=pure_read`；`goal_kind=write` 时必须固定映射到 `interaction_safety_class=state_changing_write`。
- `interaction_safety_class=pure_read` 的允许动作集合只允许 `navigate`、`locate`、`click`、`extract`、`wait_settled`；其中 `click` 的正式语义必须收敛为 `reveal_only_click`。
- `reveal_only_click` 只允许 `expand_or_collapse`、`switch_content_tab`、`open_detail_view`、`load_more_or_paginate` 四类揭示型点击。
- `interaction_safety_class=pure_read` 明确禁止 `type`、submit、confirm、publish、purchase、dispatch、bind，以及任何会持久改变账号、内容或表单状态的点击。
- `interaction_safety_class=state_changing_write` 时，允许动作集合可以包含 `navigate`、`locate`、`click`、`type`、`extract`、`wait_settled`，但仍必须受 `risk_state=allowed`、`write_gate_audit_refs` 与 `write_safety_boundary` 约束。
- `interaction_safety_class` 只描述动作纯度，不改变 `candidate_shell_seed.ability_kind`；后者必须继续直接等于 `goal_kind`，并自然回落到 `FR-0017.ability_kind=read|write`。

## 7. `risk_gate_context`

用途：

- 作为未知网站 L2 首次可用请求的站点无关最小门禁上下文，向请求面提供统一坐标与风险状态

最小字段：

- `run_id`
- `profile`
- `target_domain`
- `target_tab_id`
- `target_page`
- `risk_state`

可选字段：

- `session_id`

补充约束：

- `risk_gate_context` 只冻结站点无关的最小字段，不直接复用 `FR-0010.gate_input`、`requested_execution_mode` 或其他平台专用 gate 请求对象。
- `session_id` 如存在，只能作为已建立会话的补充坐标；在当前 runtime baseline 仍允许其缺失时，不得把它升级为请求成立前置。
- `goal_kind` 是本 FR 唯一正式的能力目标类型；`target_url` 必须能够回链到 `risk_gate_context.target_domain`。
- `risk_gate_context.target_tab_id` 与 `risk_gate_context.target_page` 必须共同存在；任一缺失都不得进入 L2 首次可用请求。
- `risk_state` 只表达统一风险状态机的站点无关输入状态；当前最小集合为 `paused | limited | allowed`。
- 若上游门禁仍持有 `irreversible_write`、平台专用 live lane 或其他站点专用 gate 语义，必须在进入本 FR 请求面前完成阻断或归一化。
- `goal_kind=write` 且 `risk_gate_context.risk_state` 不是 `allowed` 时，不得进入成功路径；实现层必须返回 `risk_gate_blocked` 或更早阻断。

## 8. `failure_result`

用途：

- 记录 L2 首次可用未完成时的最小失败回传边界

最小字段：

- `success=false`
- `failure_class`

补充约束：

- 失败结果一旦返回，就必须包含稳定的 `failure_class`；不得只返回自由文本错误或空失败对象。
- 失败结果不得包含 `candidate_shell_seed`；只有首次成功路径才能向 `FR-0017` 交付 handoff 输入。
- `failure_class` 只允许 `insufficient_semantic_structure`、`target_not_located`、`state_not_settled`、`risk_gate_blocked`、`requires_l1_fallback`。

## 9. `l1_fallback_payload`

用途：

- 在 `failure_class=requires_l1_fallback` 时，向 L1 明确交接“为什么停止 L2”以及“下一步最小应做什么”

最小字段：

- `fallback_goal`
- `fallback_reason`
- `recommended_strategy`

补充约束：

- `l1_fallback_payload` 只在 `failure_class=requires_l1_fallback` 时出现，其他失败分支不得伪造。
- `fallback_goal` 只允许 `read` / `write`，用于说明 L1 继续承接的目标类型。
- `fallback_reason` 只允许 `insufficient_semantic_structure`、`target_not_located`、`state_not_settled`，用于说明触发 L2 停止的最小原因。
- `recommended_strategy` 只允许 `visual_reacquire`、`visual_state_check`、`visual_then_physical_act`，用于冻结 L1 的最小方向，而不是完整 L1 工作流。

## 10. 与既有对象的关系

- 与 `FR-0017`：
  - `candidate_shell_seed` 必须已经包含可直接物化 `candidate_ability_descriptor` 必填字段的结构化值
  - `candidate_shell_seed.ability_kind` 必须继续直接等于本次请求 `goal_kind`；`interaction_safety_class` 不能引入新的共享能力类型
- 与 `FR-0004`：
  - 失败大类可以引用最小诊断，但不扩展诊断 schema
- 与 `FR-0010/0011`：
  - `risk_gate_context` 只继承站点无关的风险门禁原则与最小坐标，不直接复用 `FR-0010.gate_input`
  - `write_gate_audit_refs` 继续沿用 `FR-0010` 的 `decision_id` / `approval_record_ref` / `audit_record_ref` 语义，不得派生第二套私有审批或审计字段
  - 平台专用 gate 请求对象如需进入本 FR，必须先映射为站点无关的最小门禁上下文
