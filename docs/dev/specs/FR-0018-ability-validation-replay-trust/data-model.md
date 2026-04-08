# FR-0018 数据模型

## 1. `ability_validation_record`

核心字段：

- `ability_ref`
- `profile_ref`
- `health_state`
- `latest_validations`
- `divergence_reason`

说明：

- 本模型冻结“每个能力的聚合健康视图 + 按 mode 的 latest 结果子视图”，不要求在本 FR 中定义完整历史版本表。
- 聚合健康视图必须按 `ability_ref + profile_ref` 唯一隔离；不同 profile 的验证结果不得互相覆盖。
- `health_state` 必须按 `unknown/verified/degraded/broken/stale` 的最小判定标准生成，不能由调用方自由解释。
- `latest_validations` 中每个 `validation_mode` 最多只能保留一条 latest 记录；它们共同构成当前能力的正式 latest-validation truth source。
- `ability_validation_record` 是每个 `ability_ref + profile_ref` 的唯一聚合健康视图；其 ownership 属于 FR-0018 验证层，而不是 FR-0006 runtime-store。
- 存储 / 查询边界：实现层必须为每个 `ability_ref + profile_ref` 维护单条聚合视图，并在该视图下维护按 mode 的 latest 结果；查询最新健康状态时只能读取该视图，不得直接扫描 runtime-store 原始运行记录充当 truth source。

### `latest_validations[*]`

核心字段：

- `validation_mode`
- `result_state`
- `failure_class`
- `validated_at`
- `run_id`
- `artifact_refs`

说明：

- `validation_mode` 只允许 `smoke_validation` 或 `replay_validation`。
- `result_state` 只允许 `verified`、`broken`、`stale`；顶层 `degraded` 只在聚合视图中表达，不作为 mode latest 的原子状态。
- `validated_at`、`run_id`、`artifact_refs` 是 latest 记录成立的必填证据字段；缺少任一字段时不得落成 `latest_validations[*]`。
- `failure_class` 在 `result_state=broken` 时必填，在 `result_state=verified` 时必须为空；`stale` 只允许在解释过期原因时保留兼容的大类信息。

## 2. `ability_replay_binding`

核心字段：

- `ability_ref`
- `replay_source`
- `replay_input_ref`
- `replay_reason`

说明：

- 重放对象只说明“这次重放从哪里来的输入”，不承担自动修复语义。

## 3. 与既有对象的关系

- 与 `FR-0017`：
  - `ability_ref` 必须引用已存在的候选能力描述
- 与 `FR-0004`：
  - 最小失败大类可以继续引用最小诊断结果，但不在本 FR 中扩展诊断 schema
- 与 `FR-0006`：
  - `run_id` 提供最小运行证据锚点
  - `artifact_refs` 的正式 truth source 是该 `run_id` 对应验证运行的 run-scoped 证据载体；FR-0018 不把 SQLite 升级为 artifact 或 validation state 真相源
