# Runtime Store 最小契约

## 边界名称与适用范围

边界名称：`runtime-store`

适用范围：

- CLI 运行时向 SQLite 写入最小运行证据
- CLI 按 `run_id` 查询运行主记录与事件时间线
- 与 `#154` 诊断字段的最小落库映射

不在本契约范围：

- 平台业务原始数据存储
- 实时会话状态判定
- 能力版本发布与分发

## 生产者 / 消费者

生产者：

- CLI 运行时记录器（command runtime layer）

消费者：

- CLI 诊断查询路径
- `#154` 诊断输出映射层
- `#159` 能力壳运行证据聚合层

## 输入

### 1. UpsertRunInput

- `run_id` string（必填，稳定唯一）
- `session_id` string | null（可空）
- `profile_name` string（必填）
- `command` string（必填）
- `status` enum（`running` | `succeeded` | `failed`）
- `started_at` string（ISO8601，必填）
- `ended_at` string | null（`running` 时可空）
- `error_code` string | null

### 2. AppendRunEventInput

- `run_id` string（必填，必须已存在于运行主记录）
- `event_time` string（ISO8601，必填）
- `stage` string（必填，如 `boot` / `transport` / `command` / `finalize`）
- `component` string（必填，如 `cli` / `extension` / `content_script` / `runtime`）
- `event_type` string（必填，如 `started` / `succeeded` / `failed` / `diagnosis`）
- `diagnosis_category` string | null
- `failure_point` string | null
- `summary` string | null（写入前必须脱敏与截断）

### 3. GetRunTraceInput

- `run_id` string（必填）

## 输出

### 1. UpsertRunResult

- `run_id` string
- `status` enum（同输入）
- `created` boolean（`true` 表示首次创建，`false` 表示幂等更新）
- `updated_at` string（ISO8601）

### 2. AppendRunEventResult

- `run_id` string
- `event_id` number
- `event_time` string

### 3. GetRunTraceResult

- `run` object | null
- `events` array（按 `event_time` 升序）

## 错误 / 状态返回

错误码在运行层统一映射，store 层至少返回以下类型：

- `ERR_RUNTIME_STORE_UNAVAILABLE`：数据库不可用或连接失败
- `ERR_RUNTIME_STORE_SCHEMA_MISMATCH`：schema 版本不匹配
- `ERR_RUNTIME_STORE_CONFLICT`：写入冲突且重试后仍失败
- `ERR_RUNTIME_STORE_INVALID_INPUT`：输入字段非法
- `ERR_RUNTIME_STORE_RUN_NOT_FOUND`：事件追加时找不到主记录或查询无结果

状态约束：

- 同一 `run_id` 不允许出现多条主记录。
- `append event` 不允许写入孤儿事件。

## 兼容与版本策略

- Phase 1 采用单版本 schema，不做跨版本自动迁移。
- 新字段仅允许向后兼容追加；已存在字段语义不得静默重定义。
- 若未来出现破坏性变更，必须通过新 FR 升级 data-model 与迁移策略。

## 最小示例

### upsert run（开始）

```json
{
  "run_id": "run_20260319_001",
  "session_id": "sess_001",
  "profile_name": "xhs_main",
  "command": "runtime.ping",
  "status": "running",
  "started_at": "2026-03-19T11:05:00Z",
  "ended_at": null,
  "error_code": null
}
```

### append event（失败诊断）

```json
{
  "run_id": "run_20260319_001",
  "event_time": "2026-03-19T11:05:04Z",
  "stage": "transport",
  "component": "extension",
  "event_type": "failed",
  "diagnosis_category": "runtime_unavailable",
  "failure_point": "native_bridge_open",
  "summary": "heartbeat timeout after retry budget"
}
```
