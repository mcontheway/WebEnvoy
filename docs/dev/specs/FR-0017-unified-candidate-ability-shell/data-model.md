# FR-0017 数据模型

## 1. `candidate_ability_descriptor`

核心字段：

- `ability_id`
- `display_name`
- `ability_kind`
- `entrypoint`
- `platform_scope`
- `execution_layer_support`
- `capture_origin`
- `candidate_status`
- `capture_run_id`
- `capture_profile`
- `capture_artifact_refs`
- `captured_at`

生命周期：

1. 一次成功路径被整理时，先生成 `draft_candidate`
2. 最小输入/输出/错误边界与来源证据补齐后，可提升为 `candidate_ready`
3. 验证结果与可信状态不在本模型内部承载，由后续 FR 承接

## 2. `ability_contract_binding`

用途：

- 把候选能力描述绑定到最小能力壳与后续验证入口

最小字段：

- `descriptor_ref`
- `input_contract_ref`
- `output_contract_ref`
- `error_contract_ref`

## 3. 与既有对象的关系

- 与 `FR-0007`：
  - 继续复用最小能力壳
  - 调用入口中的 `ability` 仍为结构对象，至少包含 `id` / `layer` / `action`
- 与 `FR-0004`：
  - 继续复用最小诊断引用
- 与 `FR-0006`：
  - `capture_run_id` 通过 runtime-store 提供最小运行证据锚点
  - `capture_artifact_refs` 的正式 truth source 是该 `capture_run_id` 对应运行的 run-scoped 证据载体；FR-0017 不把 SQLite 或候选能力描述升级为 artifact 真相源
