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
- `saved_artifact_refs`
- `resolved_output_path`
- `source_url`
- `file_name_hint`
- `content_descriptor`

### `saved_artifact_refs` 语义

- 在 artifact carrier 尚未由上游 FR 正式冻结前，`saved_artifact_refs` 只作为可选的 run-scoped evidence refs。
- `saved_artifact_refs` 不得被解释为新的正式产物注册表、全局 resolver 或长期真相源。

## 3. `OutputPolicy`

- `destination_root`
- `file_name_policy`
- `conflict_policy`

## 4. `ContentDescriptor`

- `content_kind`
- `mime_type`
- `size_bytes`

## 约束

- `download_ability_request` 只能作为 `FR-0007.params.input` 下的下载输入对象；能力外层调用仍固定为 `params.ability/input/options`。
- `params.ability.id` 必须等于 `download_ability_request.ability_ref`，且 `params.ability.action` 固定为 `download`。
- `result_state=downloaded` 时，`resolved_output_path` 必须存在；`saved_artifact_refs` 仅在存在已冻结的 run-scoped evidence refs 时返回。
- `result_state=downloaded` 时，`source_url` 与 `file_name_hint` 必须存在，用于审计与最小复现场景定位。
- `partial` 只能用于已有可保留产物但整体未满足目标的场景。
- 下载能力进入 `FR-0017` 时，`ability_kind` 固定为 `download`。
- `download_result_summary` 不得成为新的顶层返回壳；其能力结果语义必须挂接到 `FR-0007.summary.capability_result`，且 `action=download`、`outcome` 与 `result_state` 映射一致（`downloaded->success`，`partial->partial`）。
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
