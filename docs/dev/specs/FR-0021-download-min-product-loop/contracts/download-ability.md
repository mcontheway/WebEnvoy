# FR-0021 契约：下载能力最小闭环

## 对象

### `download_ability_request`

- `ability_ref`
- `target_url`
- `profile_ref`
- `download_goal`
- `output_policy`
- `requested_execution_layer`

### `download_result_summary`

- `download_ref`
- `result_state`
- `failure_class`
- `saved_artifact_refs`
- `resolved_output_path`
- `source_url`
- `file_name_hint`
- `content_descriptor`

### `candidate_shell_seed`

- `ability_id`
- `ability_kind=download`
- `entrypoint`
- `contract_registry_seed`
- `input_contract_ref`
- `output_contract_ref`
- `error_contract_ref`
- `execution_layer_support`

### `output_policy`

- `destination_root`
- `file_name_policy`
- `conflict_policy`

## 契约约束

- 下载结果不得只返回远程 URL。
- 下载能力不得绕过浏览器内执行边界。
- 下载能力必须继续进入统一能力模型与普通 `read|download` trust 域。
- `download_ability_request` 只能挂接在 `FR-0007.params.input`，能力外层调用壳仍固定为 `params.ability/input/options`；不得新增下载专用顶层请求结构。
- `params.ability.id` 必须直接等于 `download_ability_request.ability_ref`，`params.ability.action` 必须固定为 `download`。
- `download_result_summary` 不得新增平行顶层返回结构；必须挂接到 `FR-0007.summary.capability_result` 的下载结果语义中，且 `action=download`、`outcome` 与 `result_state` 映射一致（`downloaded->success`，`partial->partial`）。
- 在 artifact carrier 尚未正式冻结前，`saved_artifact_refs` 只允许作为可选的 run-scoped evidence refs，不得被提升为新的正式真相源。
- `result_state=downloaded` 时，`source_url` 与 `file_name_hint` 必须存在，用于最小审计与复现定位。
- `candidate_shell_seed.input_contract_ref`、`output_contract_ref`、`error_contract_ref` 必须遵循 `cad::<ability_id>::<input|output|error>::v<major>` canonical namespace；不兼容语义变化必须递增 `v<major>`。
- `candidate_shell_seed.contract_registry_seed` 必须继承 `FR-0017.candidate_ability_contract_registry` 的有效性规则：
  - `contract_registry_seed.ability_id` 必须直接等于 `candidate_shell_seed.ability_id`
  - `entries[*].contract_ref` 至少覆盖 `input_contract_ref`、`output_contract_ref`、`error_contract_ref`
  - 同一 `contract_ref` 不得出现冲突 entry，且 `contract_kind` 必须与 ref kind 一致
  - 三类 `*_contract_ref` 必须都能唯一解引用；否则不得上报成功 handoff
