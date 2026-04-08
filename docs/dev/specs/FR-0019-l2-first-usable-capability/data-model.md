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

- 当前 read-first baseline 下，只有在形成实际读取结果后，才允许把本次 L2 路径标记为 `success=true`；reveal-only click、导航、定位、等待收敛都只能作为读取前的支持步骤。
- `success=true` 时，`result_summary` 必须携带满足 `output_contract_ref` 的结构化读取结果，且 `interaction_trace` 中必须至少出现一条 `action=extract` 的读取步骤。
- `first_usable_trace` 的最终成功步骤必须表示读取完成，不得停在展开、切换、打开详情或其他支持性交互。
- `interaction_semantics` 是正式机器字段，只允许 `neutral`、`reveal_only_click`。
- `interaction_semantics=neutral` 只允许与 `navigate`、`locate`、`extract`、`wait_settled` 这类非点击步骤一起出现；pure-read 成功路径不得上报 `neutral click`。
- `interaction_semantics=reveal_only_click` 只允许与 `action=click` 一起出现，且当前正式 `click_kind` 只允许 `expand_or_collapse`、`switch_content_tab`、`open_detail_view`、`load_more_or_paginate`。
- `click_kind` 只允许在 `interaction_semantics=reveal_only_click` 时出现；当前 pure-read 成功路径里的点击步骤必须显式携带该字段，其他交互不得伪造。
- request-side `allowed_actions=reveal_only_click` 与 trace-side `action=click + interaction_semantics=reveal_only_click` 是同一类受允许动作的正式翻译关系；两侧不得把同一动作写成无法互相映射的平行词汇。

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
- `contract_registry_seed`

### `candidate_shell_seed.contract_registry_seed`

最小字段：

- `ability_id`
- `entries`

`entries[*]` 最小字段：

- `contract_ref`
- `contract_kind`
- `contract_body`

补充约束：

- L2 首次可用成功态必须同时产出 `result_summary`、`first_usable_trace`、`interaction_trace`、`capture_hints`、`candidate_shell_seed`。
- 当前 FR 产出的 `candidate_shell_seed.ability_kind` 只允许 `read`；`write` / `download` 仍保留给上游共享模型与后续独立 FR。
- `candidate_shell_seed.ability_kind` 必须直接等于本次请求 `goal_kind=read`；若 handoff seed 与请求目标不一致，不得落成成功态结果。
- `candidate_shell_seed.execution_layer_support` 必须显式声明为单元素 `["L2"]`；成功 handoff 不得省略该字段，也不得以空数组冒充支持 L2。
- `candidate_shell_seed` 不仅要提供 descriptor 字段，还必须同时提供 `contract_registry_seed`，以便下游按 `FR-0017.candidate_ability_contract_registry` 的 resolver 正式解引用 `input_contract_ref`、`output_contract_ref`、`error_contract_ref`。
- `candidate_shell_seed.contract_registry_seed.ability_id` 必须直接等于 `candidate_shell_seed.ability_id`。
- `candidate_shell_seed.contract_registry_seed.entries[*].contract_ref` 必须至少覆盖 `input_contract_ref`、`output_contract_ref`、`error_contract_ref` 三个被引用的 ref；若任一 ref 缺少对应 entry，该 handoff 不得视为完成。
- `success=true` 还要求 `candidate_shell_seed.contract_registry_seed` 已满足 `FR-0017.candidate_ability_contract_registry` 的有效性规则：同一 `contract_ref` 不得出现多条冲突 entry，`contract_kind` 必须与 ref kind 一致，且对三类被引用 ref 的 lookup 必须都能得到唯一有效结果。
- `capture_artifact_refs` 如存在，只能作为 `capture_run_id` 下的补充 evidence refs；在上游等价 evidence carrier 正式冻结前，不得把它设为 handoff 成立的强制前置。

## 4. `interaction_safety_class`

用途：

- 把“目标类型是 read 还是 write”和“本次执行允许的动作纯度”拆成两个正式语义轴

最小字段：

- `interaction_safety_class`
- `allowed_actions`

允许值：

- `pure_read`

补充约束：

- `goal_kind=read` 时必须固定映射到 `interaction_safety_class=pure_read`。
- `interaction_safety_class=pure_read` 的允许动作集合只允许 `navigate`、`locate`、`reveal_only_click`、`extract`、`wait_settled`；request-side 不再允许裸 `click`，以便在执行前就把揭示型点击与状态改变点击区分开。
- `goal_kind=read` 的 request-side `allowed_actions` 必须显式包含 `extract`；缺少该动作时，请求不得进入执行，因为它无法满足当前 formal baseline 的读取成功条件。
- `reveal_only_click` 只允许 `expand_or_collapse`、`switch_content_tab`、`open_detail_view`、`load_more_or_paginate` 四类揭示型点击。
- `interaction_safety_class=pure_read` 明确禁止 `type`、submit、confirm、publish、purchase、dispatch、bind，以及任何会持久改变账号、内容或表单状态的点击。
- 当前 formal baseline 下，未知站点通用 `write` lane 不在本 FR 的正式数据模型内；如需纳入，必须在未来独立 FR 中补齐其 execution、validation 与治理边界。
- `interaction_safety_class` 只描述动作纯度，不改变 `candidate_shell_seed.ability_kind`；当前 formal baseline 下，后者必须继续直接等于 `goal_kind=read`。

## 5. `risk_gate_context`

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

- `risk_gate_context` 只冻结站点无关的最小字段，不直接复用 `FR-0010.gate_input` 或其他平台专用 gate 请求对象。
- `session_id` 如存在，只能作为已建立会话的补充坐标；在当前 runtime baseline 仍允许其缺失时，不得把它升级为请求成立前置。
- `goal_kind` 在当前 FR 中固定为 `read`；`target_url` 必须能够回链到 `risk_gate_context.target_domain`。
- `risk_gate_context.target_tab_id` 与 `risk_gate_context.target_page` 必须共同存在；任一缺失都不得进入 L2 首次可用请求。
- `risk_state` 只表达统一风险状态机的站点无关输入状态；当前最小集合为 `paused | limited | allowed`。
- `risk_state=paused` 时，请求必须直接返回 `failure_class=risk_gate_blocked`，不得进入 read-first 执行路径。
- `risk_state=limited` 在本 FR 中表示“只允许受控范围”；当前 formal baseline 下，`goal_kind=read + interaction_safety_class=pure_read` 属于允许执行的受控路径，不得因状态为 `limited` 而默认阻断。
- `risk_state=allowed` 时，同样允许执行当前 read-first 路径；因此本 FR 的可执行状态固定为 `limited | allowed`，阻断状态固定为 `paused`。
- 若上游门禁仍持有 `irreversible_write`、平台专用 write lane 或其他站点专用 gate 语义，必须在进入本 FR 请求面前完成阻断。

## 6. `failure_result`

用途：

- 记录 L2 首次可用未完成时的最小失败回传边界

最小字段：

- `success=false`
- `failure_class`

补充约束：

- 失败结果一旦返回，就必须包含稳定的 `failure_class`；不得只返回自由文本错误或空失败对象。
- 失败结果不得包含 `candidate_shell_seed`；只有首次成功路径才能向 `FR-0017` 交付 handoff 输入。
- `failure_class` 只允许 `risk_gate_blocked`、`requires_l1_fallback`。
- 当 L2 因 `insufficient_semantic_structure`、`target_not_located`、`state_not_settled` 停止并移交 L1 时，顶层 `failure_class` 必须统一写成 `requires_l1_fallback`；这三类停点原因只允许出现在 `l1_fallback_payload.fallback_reason` 中。

## 7. `l1_fallback_payload`

用途：

- 在 `failure_class=requires_l1_fallback` 时，向 L1 明确交接“为什么停止 L2”以及“下一步最小应做什么”

最小字段：

- `fallback_goal`
- `fallback_reason`
- `recommended_strategy`

补充约束：

- `l1_fallback_payload` 只在 `failure_class=requires_l1_fallback` 时出现，其他失败分支不得伪造。
- `fallback_goal` 只允许 `read`，用于说明 L1 继续承接的目标类型。
- `fallback_reason` 只允许 `insufficient_semantic_structure`、`target_not_located`、`state_not_settled`，用于说明触发 L2 停止的最小原因。
- `recommended_strategy` 只允许 `visual_reacquire`、`visual_state_check`、`visual_then_physical_act`，用于冻结 L1 的最小方向，而不是完整 L1 工作流。

## 8. 与既有对象的关系

- 与 `FR-0017`：
  - `candidate_shell_seed` 必须已经包含可直接物化 `candidate_ability_descriptor` 必填字段的结构化值
  - `candidate_shell_seed.contract_registry_seed` 必须能直接物化同 owner 的 `candidate_ability_contract_registry`
  - `candidate_shell_seed.ability_kind` 必须继续直接等于本次请求 `goal_kind=read`；`interaction_safety_class` 不能引入新的共享能力类型
- 与 `FR-0004`：
  - 失败大类可以引用最小诊断，但不扩展诊断 schema
- 与 `FR-0010/0011`：
  - `risk_gate_context` 只继承站点无关的风险门禁原则与最小坐标，不直接复用 `FR-0010.gate_input`
  - 平台专用 gate 请求对象如需进入本 FR，必须先被阻断或收敛到当前 read-first 边界
