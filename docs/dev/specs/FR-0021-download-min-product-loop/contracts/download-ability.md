# FR-0021 契约：下载能力最小闭环

## 边界与适用范围

本契约冻结以下共享对象：

- `download_ability_request`
- `download_result_summary`
- `candidate_shell_seed`
- `output_policy`

本契约不定义：

- 下载管理器、断点续传编排、跨设备分发
- 浏览器外抓取主路径
- 持久化 schema 与 runtime store 细节

## 生产者 / 消费者

- 生产者：
  - 下载能力执行链路（L3/L2）
  - 候选能力 handoff 组装层
- 直接消费者：
  - CLI 调用方（通过 `FR-0007` 统一能力壳消费）
  - `FR-0017` 候选能力壳
  - `FR-0018` 最小验证链路
- 间接消费者：
  - `FR-0006` 运行记录与 evidence 映射
  - 审核/回放链路

## 1. `download_ability_request`

```ts
interface DownloadAbilityRequest {
  ability_ref: string
  target_url: string
  profile_ref: string
  download_goal: "single_file" | "single_media_asset"
  output_policy: {
    destination_root: string
    file_name_policy: string
    conflict_policy: "fail_if_exists" | "rename_with_suffix" | "replace_existing"
  }
  requested_execution_layer: "L3" | "L2"
}
```

约束：

- `download_ability_request` 只能挂接在 `FR-0007.params.input`，不得新增下载专用顶层请求壳。
- `FR-0007.params.ability.id` 必须直接等于 `ability_ref`。
- `FR-0007.params.ability.action` 必须固定为 `download`。
- 下载目标必须来自浏览器内可达路径，不得把浏览器外异构抓取器作为正式主路径。

## 2. `download_result_summary`

```ts
interface DownloadResultSummary {
  download_ref: string
  result_state: "downloaded" | "partial"
  saved_artifact_refs?: string[]
  resolved_output_path?: string
  source_url?: string
  file_name_hint?: string
  content_descriptor: {
    content_kind: string
    mime_type: string
    size_bytes?: number
  }
}
```

约束：

- `download_result_summary` 不得成为新的平行顶层返回壳；必须挂接在 `FR-0007.summary.capability_result` 语义内。
- `summary.capability_result.action` 必须为 `download`。
- `summary.capability_result.outcome` 与 `result_state` 映射固定：
  - `downloaded -> success`
  - `partial -> partial`
- 下载失败必须复用 `FR-0007` 外层错误壳：`status=error` + `error.*`。
- `result_state=downloaded` 时，`resolved_output_path`、`source_url`、`file_name_hint` 必须存在。
- `saved_artifact_refs` 仅可作为 run-scoped evidence refs 的可选补充，不得被提升为新的正式真相源。
- `result_state=partial` 只用于存在可保留产物但目标未完全满足的场景。

## 3. `candidate_shell_seed`

```ts
interface CandidateContractRegistrySeedEntry {
  contract_ref: string
  contract_kind: "input" | "output" | "error"
  contract_body: Record<string, unknown>
}

interface CandidateShellSeed {
  ability_id: string
  ability_kind: "download"
  entrypoint: string
  execution_layer_support: Array<"L3" | "L2">
  input_contract_ref: string
  output_contract_ref: string
  error_contract_ref: string
  contract_registry_seed: {
    ability_id: string
    entries: CandidateContractRegistrySeedEntry[]
  }
}
```

约束：

- `input_contract_ref`、`output_contract_ref`、`error_contract_ref` 必须使用 `cad::<ability_id>::<input|output|error>::v<major>` 命名空间。
- `contract_registry_seed.ability_id` 必须直接等于 `ability_id`。
- `entries[*].contract_ref` 必须至少覆盖三类 `*_contract_ref`。
- 同一 `contract_ref` 不得出现冲突 entry，且 `contract_kind` 必须与 ref kind 一致。
- 三类 `*_contract_ref` 都必须可被唯一解引用；否则不得上报成功 handoff。

## 4. 错误与状态契约

- 成功壳内的状态集合固定为 `downloaded` / `partial`，不得扩展为自由文本状态。
- 下载失败必须通过 `FR-0007.error.details.reason` 表达，至少支持：
  - `SOURCE_UNAVAILABLE`
  - `AUTH_OR_SESSION_REQUIRED`
  - `WRITE_BLOCKED`
  - `RUNTIME_ERROR`
- 若同一响应携带 `FR-0004.error.diagnosis`，其职责仍是诊断；不得覆盖 `download_result_summary` 语义。

## 5. 兼容策略

- 当前契约必填字段在 FR-0021 生命周期内视为冻结。
- 允许后续 FR 新增可选字段，但不得删除或改写本契约必填字段语义。
- `*_contract_ref` 的不兼容变化必须通过 `v<major>` 递增表达，禁止静默复用旧 ref。

## 最小示例

### 示例 1：成功下载

```json
{
  "download_ref": "dl-001",
  "result_state": "downloaded",
  "resolved_output_path": "/tmp/downloads/a.pdf",
  "source_url": "https://example.com/a.pdf",
  "file_name_hint": "a.pdf",
  "content_descriptor": {
    "content_kind": "file",
    "mime_type": "application/pdf",
    "size_bytes": 1024
  }
}
```

### 示例 2：部分成功

```json
{
  "download_ref": "dl-002",
  "result_state": "partial",
  "saved_artifact_refs": ["run:abc:artifact:1"],
  "content_descriptor": {
    "content_kind": "file",
    "mime_type": "application/octet-stream"
  }
}
```

### 示例 3：失败

```json
{
  "status": "error",
  "error": {
    "code": "ERR_EXECUTION_FAILED",
    "details": {
      "ability_id": "download.asset.v1",
      "stage": "execution",
      "reason": "WRITE_BLOCKED"
    }
  }
}
```
