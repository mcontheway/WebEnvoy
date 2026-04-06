# FR-0006 数据模型（SQLite 最小运行记录）

## 模型边界

本模型只覆盖 Phase 1 的运行证据与审计记录，不覆盖平台业务正文数据，不覆盖实时会话状态机，也不覆盖能力主数据。

实时状态真相源仍是 FR-0003 的 profile/session 路径；能力输入 / 输出 / 错误壳真相源仍是 FR-0007；本模型只承载历史运行事实。

## 共享映射冻结

- `run_id`：跨 FR-0003 / FR-0004 / FR-0007 的最小关联键。由上游运行时生成并传入 store；SQLite 只持久化，不分配新值。
- `profile_name`：来自 FR-0003 的最小已冻结引用字段，用于把运行记录关联回 Profile。
- `session_id`：在 Phase 1 中仅作为 optional pending field；缺失不影响本 FR 验收，也不允许据此反向推导会话状态。
- 诊断字段：只保存 FR-0004 诊断对象的最小 projection，不承诺持久层结果可 1:1 还原完整诊断对象。
- 能力侧映射：FR-0006 只保证 `run_id`、`command`、`profile_name`、`status`、`ended_at` 可被 FR-0007 复用，不新增能力主数据列。

## 核心实体

### 1. `runtime_runs`

用途：

- 记录一次 CLI 命令运行的主事实，作为事件时间线锚点。

关键字段：

- `run_id` TEXT NOT NULL UNIQUE
- `session_id` TEXT NULL
- `profile_name` TEXT NOT NULL
- `command` TEXT NOT NULL
- `status` TEXT NOT NULL
- `started_at` TEXT NOT NULL
- `ended_at` TEXT NULL
- `error_code` TEXT NULL
- `created_at` TEXT NOT NULL
- `updated_at` TEXT NOT NULL

约束：

- `run_id` 全局唯一。
- `run_id` 由上游运行时提供，SQLite 不生成新值。
- `status` 只允许最小枚举：`running`、`succeeded`、`failed`。
- `ended_at` 在 `status = running` 时可空，其余状态必须非空。
- `session_id` 在当前阶段只作为可空引用字段；为空不构成写入失败。

索引：

- `ux_runtime_runs_run_id` (`run_id`) UNIQUE
- `idx_runtime_runs_profile_started` (`profile_name`, `started_at` DESC)
- `idx_runtime_runs_command_started` (`command`, `started_at` DESC)

### 2. `runtime_events`

用途：

- 记录同一 `run_id` 下的关键阶段事件与最小诊断摘要。

关键字段：

- `id` INTEGER PRIMARY KEY AUTOINCREMENT
- `run_id` TEXT NOT NULL
- `event_time` TEXT NOT NULL
- `stage` TEXT NOT NULL
- `component` TEXT NOT NULL
- `event_type` TEXT NOT NULL
- `diagnosis_category` TEXT NULL
- `failure_point` TEXT NULL
- `summary` TEXT NULL
- `summary_truncated` INTEGER NOT NULL DEFAULT 0
- `created_at` TEXT NOT NULL

约束：

- `run_id` 必须关联 `runtime_runs.run_id`。
- `summary` 必须经过脱敏与截断。
- `summary_truncated` 只允许取值 `0` 或 `1`。
- `diagnosis_category`、`failure_point` 仅在失败或诊断事件中可填。
- 不允许把完整 `error.diagnosis` 对象或等价 JSON blob 直接作为 Phase 1 默认列落库。

索引：

- `idx_runtime_events_run_time` (`run_id`, `event_time` ASC)
- `idx_runtime_events_type_time` (`event_type`, `event_time` DESC)

## 生命周期

1. 命令开始时创建或幂等更新一条 `runtime_runs`（`status = running`）。
2. 命令执行中按阶段追加 `runtime_events`。
3. 命令结束时更新同一条 `runtime_runs` 为 `succeeded` 或 `failed`，并写入 `ended_at`。
4. 查询时按 `run_id` 先读主记录，再读事件时间线。

## 数据保留与清理

- Phase 1 先不引入复杂 TTL 作业。
- 只要求预留按 `started_at` 批量清理的查询条件与索引。
- 清理策略在后续 FR 单独定义，不在本 FR 扩张。

## 与其他 FR 的模型关系

- 与 FR-0003：共享 `profile_name`、`session_id` 引用字段，但不共享实时状态主表。
- 与 FR-0004：`diagnosis_category`、`failure_point`、`component`、`summary`、`summary_truncated` 按最小 projection 对齐。
- 与 FR-0007：`run_id`、`command`、`profile_name`、`status`、`ended_at` 作为能力执行证据最小锚点；SQLite 不承接能力目录、版本、健康度或 `summary.capability_result` 真相源。
