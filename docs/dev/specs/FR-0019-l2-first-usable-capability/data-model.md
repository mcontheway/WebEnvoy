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
- `capture_artifact_refs` 如存在，只能作为 `capture_run_id` 下的补充 evidence refs；在上游等价 evidence carrier 正式冻结前，不得把它设为 handoff 成立的强制前置。

## 4. `failure_result`

用途：

- 记录 L2 首次可用未完成时的最小失败回传边界

最小字段：

- `success=false`
- `failure_class`

补充约束：

- 失败结果一旦返回，就必须包含稳定的 `failure_class`；不得只返回自由文本错误或空失败对象。
- 失败结果不得包含 `candidate_shell_seed`；只有首次成功路径才能向 `FR-0017` 交付 handoff 输入。
- `failure_class` 只允许 `insufficient_semantic_structure`、`target_not_located`、`state_not_settled`、`risk_gate_blocked`、`requires_l1_fallback`。

## 5. 与既有对象的关系

- 与 `FR-0017`：
  - `candidate_shell_seed` 必须已经包含可直接物化 `candidate_ability_descriptor` 必填字段的结构化值
- 与 `FR-0004`：
  - 失败大类可以引用最小诊断，但不扩展诊断 schema
- 与 `FR-0010/0011`：
  - 只继承站点无关的风险门禁结果语义，不继承 XHS 专用 gate 条件
