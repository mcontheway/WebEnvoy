# FR-0021 数据模型

本 FR 不新增完整持久化 schema，但需要冻结共享对象语义。

## 1. `DownloadAbilityRequest`

- `ability_ref`
- `download_source`
- `profile_ref`
- `download_goal`
- `output_policy`
- `requested_execution_layer`

### `download_source` 语义

- `direct_url`：调用方直接提供 `target_url`。
- `page_blob`：调用方必须提供页面执行面内可解析的 `blob_locator`，用于桥接读取页面内 `Blob`；`blob_url` 如存在，只作为浏览器侧来源标识或审计线索。
- `page_derived`：调用方提供页面导出/执行线索，由浏览器执行面在运行时解析最终下载对象。
- `download_source` 只用于表达当前浏览器执行上下文内可解析的请求输入，不是新的全局 artifact/ref 真相源。
- `page_blob` 不得只靠 `blob_url` 构成充分输入；浏览器执行面必须仍能通过 `blob_locator` 物化可交给 CLI 落盘的 Blob 内容。`page_derived` 至少需要 `trigger_hint` 或 `page_context_hint` 其一。

## 2. `DownloadResultSummary`

- 始终必填：
  - `download_ref`
  - `result_state`
  - `content_descriptor`
- `result_state=downloaded` 时条件必填：
  - `resolved_output_path`
  - `source_url`
  - `file_name_hint`
- `result_state=partial` 时条件必填：
  - `resolved_output_path` 与 `saved_artifact_refs` 至少其一
- 可选：
  - `saved_artifact_refs`

### `saved_artifact_refs` 语义

- 在 artifact carrier 尚未由上游 FR 正式冻结前，`saved_artifact_refs` 只作为可选的 run-scoped evidence refs。
- `saved_artifact_refs` 不得被解释为新的正式产物注册表、全局 resolver 或长期真相源。

## 3. `OutputPolicy`

- `destination_root`
- `file_name_policy`
- `conflict_policy`

### `destination_root` 语义

- `destination_root` 只允许表达 CLI-owned trusted download base 内的目标子目录，不得直接表达任意宿主绝对路径。
- 实现必须先对 `destination_root` 做本地规范化，再与 trusted download base 拼接；若输入为绝对路径、`..`、`~`、Windows drive/UNC 前缀，或规范化后逃逸 trusted base，必须在 `input_validation` 阶段拒绝。
- `resolved_output_path` 必须是最终仍位于 trusted download base 内的实际落盘路径。

## 4. `ContentDescriptor`

- `content_kind`
- `mime_type`
- `size_bytes`（可选）

## 约束

- `download_ability_request` 只能作为 `FR-0007.params.input` 下的下载输入对象；能力外层调用仍固定为 `params.ability/input/options`。
- `params.ability.id` 必须等于 `download_ability_request.ability_ref`，且 `params.ability.action` 固定为 `download`。
- `params.ability.layer` 是本次 invocation 的权威执行层；`download_ability_request.requested_execution_layer` 只是下载输入对象内的镜像字段，必须与 `params.ability.layer` 严格相等。
- 若 `params.ability.layer` 与 `requested_execution_layer` 不一致，请求必须在 `input_validation` 阶段直接拒绝。
- `result_state=downloaded` 时，`resolved_output_path` 必须存在；`saved_artifact_refs` 仅在运行期已有可用 run-scoped evidence refs 时返回。
- `result_state=downloaded` 时，`source_url` 与 `file_name_hint` 必须存在；其中 `source_url` 用于回传本次下载最终使用的浏览器侧来源标识，可为 direct URL、`blob:` URL 或页面执行后解析出的最终来源。
- `partial` 只能用于已有可保留产物但整体未满足目标的场景。
- `requested_execution_layer` 的共享正式枚举必须保留 `L1/L2/L3`；当前最小实现可优先 `L3/L2`，但 formal 约束不得排除 `L1`。
- 下载能力进入 `FR-0017` 时，`ability_kind` 固定为 `download`。
- `candidate_shell_seed` 必须足以直接物化 `FR-0017.candidate_ability_descriptor` 的必填字段；除 `ability_id/ability_kind/entrypoint/execution_layer_support/*_contract_ref` 外，还必须显式提供 `display_name`、`platform_scope`、`capture_origin`、`capture_run_id`、`capture_profile`、`captured_at`、`candidate_status`；`capture_artifact_refs` 保持可选。
- `candidate_shell_seed.execution_layer_support` 必须使用 `L1/L2/L3` 共享枚举并保持非空集合。
- `candidate_shell_seed.platform_scope.platform_family` 必须使用稳定、归一化的平台键；站点无关下载能力默认应落在 `generic_web`。
- `download_result_summary` 不得成为新的顶层返回壳；其正式暴露位置必须是 `FR-0007.summary.capability_result.download_result_summary`，且 `action=download`、`outcome` 与 `result_state` 映射一致（`downloaded->success`，`partial->partial`）。
- `summary.capability_result.data_ref` 如存在，只能承载 opaque `download_ref` 或等价引用，不是 `download_result_summary` 的真相源，也不承诺结构化回读能力。
- 下载失败路径必须复用 `FR-0007` 的错误壳：`status=error` + `error.*`；不得把失败结果继续挂到 `summary.capability_result` 下。
- `candidate_shell_seed.input_contract_ref`、`output_contract_ref`、`error_contract_ref` 必须遵循 `cad::<ability_id>::<input|output|error>::v<major>` 命名空间；发生不兼容语义变更时必须递增 `v<major>`。
- `candidate_shell_seed.contract_registry_seed` 必须满足 `FR-0017.candidate_ability_contract_registry` 的有效性规则：
  - `contract_registry_seed.ability_id` 必须直接等于 `candidate_shell_seed.ability_id`
  - `entries[*].contract_ref` 至少覆盖 `input_contract_ref`、`output_contract_ref`、`error_contract_ref`
  - 同一 `contract_ref` 不得出现冲突 entry，`contract_kind` 必须与 ref kind 一致
  - 三类 `*_contract_ref` 的 lookup 都必须可唯一解引用；否则不得返回成功结果

## 生命周期语义

### `download_result_summary.result_state`

- 初始态：`pending`（仅执行中内部态，不属于正式返回值）
- 终态：`downloaded` / `partial`
- 终态转换约束：
  - `pending -> downloaded`：目标文件已完成落盘，且满足最小结果字段要求
  - `pending -> partial`：存在可保留产物，但整体下载目标未满足
  - 终态一旦返回，不允许在同一次 `download_ref` 响应中回退为其他状态

### 下载失败承载方式

- 下载失败不是 `DownloadResultSummary` 的正式终态，而是 `FR-0007` 错误壳中的能力失败。
- 失败原因必须通过 `error.details.reason` 表达，至少支持：
  - `SOURCE_UNAVAILABLE`
  - `AUTH_OR_SESSION_REQUIRED`
  - `WRITE_BLOCKED`
  - `RUNTIME_ERROR`

### `saved_artifact_refs` 推进关系

- `saved_artifact_refs` 仅是 run-scoped evidence refs 的可选补充，不是下载成功判定主键。
- `result_state=downloaded`：
  - 必须有 `resolved_output_path`
  - 可以有 `saved_artifact_refs`（当运行期已有可用 evidence refs）
- `result_state=partial`：
  - 至少应存在可保留产物线索（`resolved_output_path` 或 `saved_artifact_refs` 至少其一）
  - 不得上报为完整成功
