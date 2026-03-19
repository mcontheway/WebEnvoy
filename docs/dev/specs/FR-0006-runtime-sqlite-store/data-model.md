# FR-0006 数据模型（SQLite 最小运行记录）

## 模型边界

本模型只覆盖 Phase 1 的运行证据与审计记录，不覆盖平台业务正文数据，不覆盖实时会话状态机。

实时状态真相源仍是 `#143` 的 profile/session 路径；本模型只承载历史运行事实。

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
- `status` 只允许最小枚举：`running`、`succeeded`、`failed`。
- `ended_at` 在 `status = running` 时可空，其余状态必须非空。

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
- `created_at` TEXT NOT NULL

约束：

- `run_id` 必须关联 `runtime_runs.run_id`。
- `summary` 必须经过脱敏与截断。
- `diagnosis_category`、`failure_point` 仅在失败或诊断事件中可填。

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

- 与 `#143`：共享 `profile_name`、`session_id` 引用字段，但不共享实时状态主表。
- 与 `#154`：`diagnosis_category`、`failure_point` 与诊断摘要字段按最小映射对齐。
- 与 `#159`：`run_id`、`command`、`status`、`ended_at` 作为能力执行证据最小输入。
