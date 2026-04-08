# FR-0017 数据模型

## 1. `candidate_ability_descriptor`

核心字段：

- `ability_id`
- `display_name`
- `ability_kind`
- `entrypoint`
- `platform_scope`
- `execution_layer_support`
- `input_contract_ref`
- `output_contract_ref`
- `error_contract_ref`
- `capture_origin`
- `candidate_status`
- `capture_run_id`
- `capture_profile`
- `captured_at`

生命周期：

1. 一次成功路径被整理时，先生成 `draft_candidate`
2. 最小输入/输出/错误边界与来源证据补齐后，可提升为 `candidate_ready`
3. 验证结果与可信状态不在本模型内部承载，由后续 FR 承接

补充约束：

- `candidate_ability_descriptor` 必须自包含输入/输出/错误契约引用；不得再拆出独立 `ability_contract_binding` 或其他平行绑定对象。
- `ability_id` 是候选能力描述与 `FR-0007` 最小能力壳之间的正式绑定键。
- `capture_artifact_refs` 如存在，只能作为 `capture_run_id` 下的补充 evidence refs；在上游等价 evidence carrier 正式冻结前，不得把它设为 descriptor 成立的强制前置。

## 2. 与既有对象的关系

- 与 `FR-0007`：
  - 继续复用最小能力壳
  - 调用入口中的 `ability` 仍为结构对象，至少包含 `id` / `layer` / `action`
  - 成功结果继续落在 `summary.capability_result`，不新增平行结果壳
- 与 `FR-0004`：
  - 继续复用最小诊断引用
- 与 `FR-0006`：
  - `capture_run_id` 通过 runtime-store 提供最小运行证据锚点
  - `capture_artifact_refs` 如存在，只能引用该 `capture_run_id` 对应运行的补充证据；FR-0017 不把 SQLite 或候选能力描述升级为 artifact 真相源
