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
  - 下载能力执行链路（共享枚举 L1/L2/L3；当前最小实现可先 L3/L2）
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
type DownloadSource =
  | {
      source_kind: "direct_url"
      target_url: string
    }
  | {
      source_kind: "page_blob"
      blob_locator: string
      blob_url?: string
      page_context_hint?: string
    }
  | {
      source_kind: "page_derived"
      derive_mode: "export_flow" | "runtime_resolve"
      trigger_hint?: string
      page_context_hint?: string
    }

interface DownloadAbilityRequest {
  ability_ref: string
  download_source: DownloadSource
  profile_ref: string
  download_goal: "single_file" | "single_media_asset"
  output_policy: {
    // Target subdirectory inside the CLI-owned trusted download base.
    destination_root: string
    file_name_policy: string
    conflict_policy: "fail_if_exists" | "rename_with_suffix" | "replace_existing"
  }
  requested_execution_layer: "L3" | "L2" | "L1"
}
```

约束：

- `download_ability_request` 只能挂接在 `FR-0007.params.input`，不得新增下载专用顶层请求壳。
- `FR-0007.params.ability.id` 必须直接等于 `ability_ref`。
- `FR-0007.params.ability.action` 必须固定为 `download`。
- `FR-0007.params.ability.layer` 是本次 invocation 的权威执行层；`requested_execution_layer` 只是下载输入对象内的显式镜像字段，必须与 `ability.layer` 严格相等。
- 若 `ability.layer` 与 `requested_execution_layer` 不一致，请求必须在 `input_validation` 阶段直接拒绝；实现不得自行猜测优先级或静默改写。
- 下载目标必须来自浏览器内可达路径，不得把浏览器外异构抓取器作为正式主路径。
- `output_policy.destination_root` 只允许表达 CLI-owned trusted download base 内的目标子目录，不得直接表达任意宿主绝对路径。
- 实现必须先对 `destination_root` 做本地规范化，再拼接到 trusted download base；若输入为绝对路径、`..`、`~`、Windows drive/UNC 前缀，或规范化后逃逸 trusted base，必须在 `input_validation` 阶段直接拒绝。
- `download_source` 的 `page_blob` / `page_derived` 只允许表达当前浏览器执行上下文内可解析的输入线索，不得被解释为新的全局 artifact/ref resolver。
- `download_source.source_kind=page_blob` 时，`blob_locator` 必须存在；它是页面执行面内可解析的 Blob 读取/桥接定位点，用于让浏览器侧把 Blob 内容交给 CLI 落盘。
- `download_source.source_kind=page_blob` 时，`blob_url` 如存在，只能作为浏览器侧 source identity 或审计线索，不能单独构成足以落盘的输入。
- `download_source.source_kind=page_derived` 时，`trigger_hint` 与 `page_context_hint` 至少提供一项。
- `download_source.source_kind=page_derived` 时，不要求调用方预先给出最终下载 URL，最终来源通过 `download_result_summary.source_url` 回传。

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

- `download_result_summary` 不得成为新的平行顶层返回壳；必须内联暴露在 `FR-0007.summary.capability_result.download_result_summary`。
- `summary.capability_result.action` 必须为 `download`。
- `summary.capability_result.outcome` 与 `result_state` 映射固定：
  - `downloaded -> success`
  - `partial -> partial`
- `summary.capability_result.data_ref` 如存在，只能承载 opaque `download_ref` 或等价引用，不得承载结构化下载字段。
- 下载失败必须复用 `FR-0007` 外层错误壳：`status=error` + `error.*`。
- `result_state=downloaded` 时，`resolved_output_path`、`source_url`、`file_name_hint` 必须存在。
- `source_url` 必须回传本次下载最终使用的浏览器侧 source identity，可为 direct URL、`blob:` URL 或页面执行后解析出的最终来源。
- `resolved_output_path` 必须是仍位于 trusted download base 内的实际落盘路径。
- `saved_artifact_refs` 仅可作为 run-scoped evidence refs 的可选补充，不得被提升为新的正式真相源。
- `result_state=partial` 时，`resolved_output_path` 与 `saved_artifact_refs` 至少其一必须存在；但该结果仍必须内联挂在 `summary.capability_result.download_result_summary`，不得退回平行顶层结果壳。
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
  display_name: string
  ability_kind: "download"
  entrypoint: string
  platform_scope: {
    platform_family: string
    site_pattern?: string
  }
  execution_layer_support: ["L3" | "L2" | "L1", ...Array<"L3" | "L2" | "L1">]
  input_contract_ref: string
  output_contract_ref: string
  error_contract_ref: string
  capture_origin: "l3_adapter_sample" | "l2_first_usable_sample" | "l1_fallback_sample"
  capture_run_id: string
  capture_profile: string
  capture_artifact_refs?: string[]
  captured_at: string
  candidate_status: "draft_candidate" | "candidate_ready"
  contract_registry_seed: {
    ability_id: string
    entries: CandidateContractRegistrySeedEntry[]
  }
}
```

约束：

- `candidate_shell_seed` 必须足以直接物化 `FR-0017.candidate_ability_descriptor` 的必填字段，并同时提供 descriptor-owned `candidate_ability_contract_registry` 的最小 seed；不得依赖带外补字段、隐式默认值或私有 resolver 约定。
- `input_contract_ref`、`output_contract_ref`、`error_contract_ref` 必须使用 `cad::<ability_id>::<input|output|error>::v<major>` 命名空间。
- `platform_scope.platform_family` 必须使用稳定、归一化的平台键；站点无关下载能力默认应落在 `generic_web`。
- `contract_registry_seed.ability_id` 必须直接等于 `ability_id`。
- `entries[*].contract_ref` 必须至少覆盖三类 `*_contract_ref`。
- 同一 `contract_ref` 不得出现冲突 entry，且 `contract_kind` 必须与 ref kind 一致。
- 三类 `*_contract_ref` 都必须可被唯一解引用；否则不得上报成功 handoff。
- `execution_layer_support` 的共享正式枚举必须保留 `L1/L2/L3`，但这不构成“本 FR 已完成 L1 下载实现”的承诺。

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

### 示例 1：成功下载能力壳

```json
{
  "summary": {
    "capability_result": {
      "ability_id": "download.asset.v1",
      "layer": "L3",
      "action": "download",
      "outcome": "success",
      "data_ref": {
        "download_ref": "dl-001"
      },
      "download_result_summary": {
        "download_ref": "dl-001",
        "result_state": "downloaded",
        "resolved_output_path": "/trusted-downloads/cases/a.pdf",
        "source_url": "https://example.com/a.pdf",
        "file_name_hint": "a.pdf",
        "content_descriptor": {
          "content_kind": "file",
          "mime_type": "application/pdf",
          "size_bytes": 1024
        }
      }
    }
  }
}
```

### 示例 2：部分成功

```json
{
  "summary": {
    "capability_result": {
      "ability_id": "download.asset.v1",
      "layer": "L2",
      "action": "download",
      "outcome": "partial",
      "data_ref": {
        "download_ref": "dl-002"
      },
      "download_result_summary": {
        "download_ref": "dl-002",
        "result_state": "partial",
        "saved_artifact_refs": ["run:abc:artifact:1"],
        "content_descriptor": {
          "content_kind": "file",
          "mime_type": "application/octet-stream"
        }
      }
    }
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
