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

可选字段：

- `seed_replay_input_ref`
- `capture_artifact_refs`

生命周期：

1. 一次成功路径被整理时，先生成 `draft_candidate`
2. 最小输入/输出/错误边界与来源证据补齐后，可提升为 `candidate_ready`
3. 验证结果与可信状态不在本模型内部承载，由后续 FR 承接

补充约束：

- `candidate_ability_descriptor` 必须自包含输入/输出/错误契约引用；不得再拆出独立 `ability_contract_binding` 或其他平行绑定对象。
- `ability_id` 是候选能力描述与 `FR-0007` 最小能力壳之间的正式绑定键。
- `execution_layer_support` 的共享正式枚举必须覆盖 `L1`、`L2`、`L3`；当前样本可只声明其中子集，但 descriptor 模型不得把未来 `L1` 候选层排除在外。
- `input_contract_ref`、`output_contract_ref`、`error_contract_ref` 必须是稳定、机器可读的契约标识；相同 ref 代表兼容的同一份契约边界，不兼容变化必须生成新的 ref。
- `*_contract_ref` 的 canonical namespace 固定为 `cad::<ability_id>::<input|output|error>::v<major>`；其中 owner 必须是当前 `ability_id`，契约种类必须与 ref 中的 `<input|output|error>` 一致。
- `candidate_ability_contract_registry` 是该 `ability_id` 下 `*_contract_ref` 的唯一正式解引用模型；它必须与 descriptor 同 owner 落库或原子发布。
- `*_contract_ref` 的 authoritative resolver 是该 `ability_id` 对应的 descriptor-owned `candidate_ability_contract_registry`；实现层只能按完整 ref 精确 lookup `entries[*].contract_ref`，并校验 `contract_kind`，不得把 ref 退化为路径推断、runtime-store 主键或私有缓存键。
- `seed_replay_input_ref` 如存在，是首个 replay 输入快照的正式引用字段；它必须稳定指向 `FR-0018.ReplayInputSnapshotRef.snapshot_ref`，但缺失时不得阻塞 `draft_candidate` 落库。
- `ability_kind=write` 时，`seed_replay_input_ref` 只允许作为 capture evidence 引用保留；在后续 FR 没有正式冻结 write replay 的 gate 元数据或 dry-run 语义前，不得把它解释为可执行 replay seed。
- `capture_artifact_refs` 如存在，只能作为 `capture_run_id` 下的补充 evidence refs；在上游等价 evidence carrier 正式冻结前，不得把它设为 descriptor 成立的强制前置。

## 2. 与既有对象的关系

- 与 `FR-0007`：
  - 继续复用最小能力壳
  - 调用入口中的 `ability` 仍为结构对象，至少包含 `id` / `layer` / `action`
  - 调用时的 `ability.layer` 必须属于 `candidate_ability_descriptor.execution_layer_support`
  - 调用时的 `ability.action` 必须直接等于 `candidate_ability_descriptor.ability_kind`；不一致时必须按结构化输入错误拒绝
  - 成功结果继续落在 `summary.capability_result`，不新增平行结果壳
- 与 `FR-0004`：
  - 继续复用最小诊断引用
- 与 `FR-0006`：
  - `capture_run_id` 通过 runtime-store 提供最小运行证据锚点
  - `capture_artifact_refs` 如存在，只能引用该 `capture_run_id` 对应运行的补充证据；FR-0017 不把 SQLite 或候选能力描述升级为 artifact 真相源
