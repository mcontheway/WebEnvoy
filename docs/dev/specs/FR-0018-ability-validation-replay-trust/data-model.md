# FR-0018 数据模型

## 1. `ability_validation_record`

核心字段：

- `ability_ref`
- `profile_ref`
- `health_state`
- `validation_coverage_state`
- `latest_validations`
- `last_success_input_ref`
- `divergence_reason`

说明：

- 本模型冻结“每个 `ability_ref + profile_ref` 的聚合健康视图 + 按 mode 的 latest 结果子视图”，不要求在本 FR 中定义完整历史版本表。
- 聚合健康视图必须按 `ability_ref + profile_ref` 唯一隔离；不同 profile 的验证结果不得互相覆盖。
- `health_state` 与 `validation_coverage_state` 是两个独立的正式字段：前者表达“现在是否可用”，后者表达“验证覆盖做到哪里”；两者都不能由调用方自由解释。
- 在同一 `ability_ref + profile_ref` 视图内，`latest_validations` 中每个 `validation_mode` 最多只能保留一条 latest 记录；它们共同构成当前能力的正式 latest-validation truth source。
- `ability_validation_record` 是每个 `ability_ref + profile_ref` 的唯一聚合健康视图；其 ownership 属于 FR-0018 验证层，而不是 FR-0006 runtime-store。
- 存储 / 查询边界：实现层必须为每个 `ability_ref + profile_ref` 维护单条聚合视图，并在该视图下维护按 mode 的 latest 结果；查询最新健康状态时只能读取该视图，不得直接扫描 runtime-store 原始运行记录充当 truth source。
- `ability_ref` 在本模型中必须直接等于 `FR-0017.candidate_ability_descriptor.ability_id`；FR-0018 不定义独立 ability ref 命名空间。
- `last_success_input_ref` 是 `replay_source=last_success_input` 的正式 truth source；它只能由同一 `ability_ref + profile_ref` 下最近一次成功验证/重放刷新。
- 当 `FR-0017.candidate_ability_descriptor.ability_kind=write` 时，`last_success_input_ref` 不得被冻结为可执行 replay truth source；写能力的输入快照只能作为 capture evidence 保留，不能自动升级为无门禁 replay 种子。
- `divergence_reason` 只允许 `smoke_replay_mismatch`，且只能用于表达 smoke/replay current latest 的真实冲突。
- 顶层 `health_state` 必须按固定顺序计算：`unknown -> stale -> healthy -> degraded -> broken`；一旦命中前序状态，后续状态不得再覆盖。
- `health_state=stale` 只允许在全部现存 latest 都为 `stale` 时出现；`health_state=healthy` 只允许在至少存在一条 current `verified` latest 且不存在任何 current `broken` latest 时出现；`health_state=degraded` 只允许在 current `verified` 与 current `broken` latest 并存时出现；`health_state=broken` 只允许在不存在任何 current `verified` latest 且至少存在一条 current `broken` latest 时出现。
- 顶层 `validation_coverage_state` 必须按固定顺序计算：`none -> smoke_only -> replay_only -> smoke_plus_replay -> divergent`；其中 `none` 只允许在不存在任何 current latest 时出现，`smoke_only`/`replay_only` 只允许在单一 mode current latest 为 `verified` 时出现，`smoke_plus_replay` 只允许在 smoke/replay current latest 都为 `verified` 时出现，其余存在 current latest 的组合一律归入 `divergent`。
- 只有 smoke current latest 为 `verified` 时，必须生成 `health_state=healthy + validation_coverage_state=smoke_only`；只有 replay current latest 为 `verified` 时，必须生成 `health_state=healthy + validation_coverage_state=replay_only`；只有 stale latest 时必须生成 `health_state=stale + validation_coverage_state=none`。

### `latest_validations[*]`

核心字段：

- `validation_mode`
- `result_state`
- `failure_class`
- `validated_at`
- `run_id`
- `baseline_descriptor`
- `artifact_refs`

说明：

- `validation_mode` 只允许 `smoke_validation` 或 `replay_validation`。
- `validation_mode=smoke_validation` 的 latest 只允许来自 `ability_validation_request`；`validation_mode=replay_validation` 的 latest 只允许来自 `ability_replay_request`。
- `result_state` 只允许 `verified`、`broken`、`stale`；顶层 `degraded` 只在聚合视图中表达，不作为 mode latest 的原子状态。
- `validated_at` 与 `run_id` 是 latest 记录成立的必填证据字段；缺少任一字段时不得落成 `latest_validations[*]`。
- `baseline_descriptor` 必须冻结该条 latest 结果生成时的 descriptor/profile 基线，至少包含 `entrypoint`、`input_contract_ref`、`output_contract_ref`、`error_contract_ref`、`profile_ref`。
- `artifact_refs` 只作为补充的 run-scoped evidence refs；在上游等价 evidence carrier 正式冻结前，不得把它设为 latest 记录成立的强制前置。
- `failure_class` 在 `result_state=broken` 时必填，在 `result_state=verified` 时必须为空；`stale` 只允许在解释过期原因时保留兼容的大类信息。
- `stale` 计算规则冻结为：`validated_at` 超过 7 天 freshness window，或当前 descriptor/view 基线与 `baseline_descriptor` 任一字段不一致。

## 2. `ability_replay_request_projection`

核心字段：

- `ability_ref`
- `profile_ref`
- `replay_source`
- `replay_reason`
- `replay_input_ref`（仅在 `replay_source=explicit_input_snapshot` 时出现）

说明：

- 本对象只是 `ability_replay_request` 的存储投影，不是第二套正式 replay 请求契约。
- 投影对象只说明“这次重放从哪里来的输入”，不承担自动修复语义，也不得额外引入 `ready` 一类未在 `spec.md` / `contracts/` 冻结的独立状态。
- `profile_ref` 是 replay 绑定的正式作用域；当 `replay_source=last_success_input` 时，必须只在同一 `ability_ref + profile_ref` 下解析最近成功输入。
- 当 `replay_source=explicit_input_snapshot` 时，`replay_input_ref` 必须存在，且只能指向已保存的显式输入快照。
- 当 `replay_source=last_success_input` 时，`replay_input_ref` 必须缺省，并改由同一视图内的 `last_success_input_ref` 解引用输入快照。

## 3. `replay_input_snapshot_ref`

核心字段：

- `snapshot_ref`
- `ability_ref`
- `profile_ref`
- `source_run_id`
- `captured_at`

说明：

- `replay_input_ref` 与 `last_success_input_ref` 的正式 truth source 都是该输入快照引用对象。
- 输入快照引用对象的 ownership 属于 FR-0018 replay 层，而不是 FR-0006 runtime-store。
- `snapshot_ref` 只能在同一 `ability_ref + profile_ref` 范围内被 replay 解析。
- 对新进入 `FR-0018` 的能力，若 `FR-0017.candidate_ability_descriptor.seed_replay_input_ref` 已存在，则它必须直接指向首个输入快照引用对象；该 ref 必须与 `capture_run_id + capture_profile` 对应的成功捕获输入同源。
- 生成后的首个 `snapshot_ref` 必须立即回写为同一 `ability_ref + capture_profile` 视图的初始 `last_success_input_ref`；其他 profile 视图不得复用该 seed。
- 若上游未提供 `seed_replay_input_ref`，则同一 `ability_ref + profile_ref` 下首次成功的 `smoke_validation.smoke_input` 或成功 replay 输入必须物化为首个输入快照引用对象；仅当 `candidate_ability_descriptor.ability_kind` 属于非状态变更能力时，才允许继续把它回写为 `last_success_input_ref`。在此之前不得把 `replay_source=last_success_input` 视为已具备可执行输入来源。
- 当 `FR-0017.candidate_ability_descriptor.ability_kind=write` 时，上述输入快照引用对象只能作为 capture evidence 保留；当前 formal baseline 下不得把它解析为可执行 replay 输入来源，也不得自动回写 `last_success_input_ref`。

## 4. 与既有对象的关系

- 与 `FR-0017`：
  - `ability_ref` 必须直接等于已存在 `candidate_ability_descriptor.ability_id`
  - `expected_capability_kind` 如保留在请求面，只允许作为对 `candidate_ability_descriptor.ability_kind` 的显式断言；不一致请求不得写入 `latest_validations`
- 与 `FR-0004`：
  - 最小失败大类可以继续引用最小诊断结果，但不在本 FR 中扩展诊断 schema
- 与 `FR-0006`：
  - `run_id` 提供最小运行证据锚点
  - `artifact_refs` 如存在，只能引用该 `run_id` 对应验证运行的补充证据；FR-0018 不把 SQLite 升级为 artifact 或 validation state 真相源
