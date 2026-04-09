# FR-0021 数据模型

本 FR 不新增完整持久化 schema，但需要冻结共享对象语义。

## 1. `DownloadAbilityRequest`

- `ability_ref`
- `target_url`
- `profile_ref`
- `download_goal`
- `output_policy`
- `requested_execution_layer`

## 2. `DownloadResultSummary`

- `download_ref`
- `result_state`
- `failure_class`
- `saved_artifact_refs`
- `resolved_output_path`
- `content_descriptor`

## 3. `OutputPolicy`

- `destination_root`
- `file_name_policy`
- `conflict_policy`

## 4. `ContentDescriptor`

- `content_kind`
- `mime_type`
- `size_bytes`

## 约束

- `result_state=downloaded` 时，`resolved_output_path` 与 `saved_artifact_refs` 必须同时存在。
- `partial` 只能用于已有可保留产物但整体未满足目标的场景。
- 下载能力进入 `FR-0017` 时，`ability_kind` 固定为 `download`。
