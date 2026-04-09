# FR-0021 契约：下载能力最小闭环

## 对象

### `download_ability_request`

- `ability_ref`
- `target_url`
- `profile_ref`
- `download_goal`
- `output_policy`
- `requested_execution_layer`

### `download_result_summary`

- `download_ref`
- `result_state`
- `failure_class`
- `saved_artifact_refs`
- `resolved_output_path`
- `content_descriptor`

### `output_policy`

- `destination_root`
- `file_name_policy`
- `conflict_policy`

## 契约约束

- 下载结果不得只返回远程 URL。
- 下载能力不得绕过浏览器内执行边界。
- 下载能力必须继续进入统一能力模型与普通 `read|download` trust 域。
