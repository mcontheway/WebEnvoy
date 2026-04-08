# FR-0018 数据模型

## 1. `ability_validation_record`

核心字段：

- `ability_ref`
- `validation_mode`
- `health_state`
- `failure_class`
- `validated_at`
- `run_id`
- `artifact_refs`

说明：

- 本模型只冻结“最近一次验证结果”的最小视图，不要求在本 FR 中定义完整历史版本表。
- `health_state` 必须按 `unknown/verified/degraded/broken/stale` 的最小判定标准生成，不能由调用方自由解释。
- `ability_validation_record` 是每个 `ability_ref` 的唯一 latest-validation 正式 truth source；其 ownership 属于 FR-0018 验证层，而不是 FR-0006 runtime-store。
- 存储 / 查询边界：实现层必须为每个 `ability_ref` 维护单条 latest-view 记录；查询最新健康状态时只能读取该视图，不得直接扫描 runtime-store 原始运行记录充当 truth source。

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
