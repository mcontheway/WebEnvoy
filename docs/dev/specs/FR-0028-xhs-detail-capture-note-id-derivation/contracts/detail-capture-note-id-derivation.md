# FR-0028 契约：XHS Detail Capture-Side Canonical Note ID Derivation（Current v1）

## 1. 契约边界

- 边界名称：`XhsDetailCaptureCanonicalNoteIdDerivationV1`
- 生产者：
  - `extension/xhs-read-execution.ts` 的 current detail admitted-derivation path
  - 后续任何负责把 detail response candidate 提升为 admitted template 的 capture-side implementation
- 消费者：
  - `extension/xhs-read-execution.ts` 的 detail admitted-template result path
  - `tests/xhs-read-execution.fallback.test.ts` 与后续 detail request-context contract tests
  - replacement implementation PR 的 formal gate 审查
- 版本 / 兼容策略：
  - 当前冻结为 `v1`
  - 只允许在 `xhs.detail` admitted canonical `note_id` derivation 这一个边界内使用
  - 若未来要把 `source_note_id`、referrer 或 metadata-only field 升格为 admitted source，必须通过新的 spec 修订，而不是静默扩写本契约

## 2. 输入与状态返回

### 输入对象

```ts
type XhsDetailCaptureDerivationInputV1 = {
  command_note_id: string;
  response_candidate_scope?:
    | "data.note"
    | "data.note_card"
    | "data.note_card_list[*]"
    | "data.current_note"
    | "data.item"
    | "data.items[*]"
    | "data.notes[*]"
    | "data";
  response_candidate_path?: "self" | "note" | "note_card" | "current_note" | "item";
  response_note_candidate?: Record<string, unknown> | null;
  request_candidate?: {
    source_note_id?: string | null;
    referrer?: string | null;
  } | null;
  response_metadata_candidate?: Record<string, unknown> | null;
};
```

字段约束：

- `command_note_id` 必填，且必须为 trim 后非空字符串；空值输入不能进入 admitted derivation。
- `response_candidate_scope` 仅在 `response_note_candidate` 存在时有效；空值表示当前没有 admitted-grade response candidate。
- `response_candidate_path` 记录 admitted note record 相对 scope root 的命中路径；例如 `data.items[*].note_card` 对应 `response_candidate_scope="data.items[*]"` 且 `response_candidate_path="note_card"`。
- `response_note_candidate` 为空时，当前输入最多只能导出 candidate-only evidence。
- `request_candidate` 与 `response_metadata_candidate` 都是可选的说明性输入；它们不能单独生成 admitted truth。

### 状态返回

```ts
type XhsDetailCaptureDerivationResultV1 =
  | {
      status: "admitted";
      source: XhsDetailAdmittedCanonicalNoteIdSourceV1;
    }
  | {
      status: "candidate_only";
      candidate_sources: XhsDetailCandidateOnlyDerivationSourceV1[];
      failure_reason:
        | "response_note_record_missing"
        | "response_note_id_mismatch"
        | "response_identifier_missing"
        | "metadata_only_note_id";
    };
```

状态约束：

- `status=admitted` 时，必须返回单一 admitted source；不得同时携带 candidate-only source 作为裁决输入。
- `status=candidate_only` 时，必须显式提供 machine-readable `failure_reason`；不得把失败留在自由文本。
- current v1 没有 `status=incompatible` 的独立 derivation 返回；candidate-only source 后续如何落入 rejected / incompatible observation，由 `#508 / FR-0027` 冻结。

## 3. Admitted canonical derivation source

```ts
type XhsDetailAdmittedCanonicalNoteIdSourceV1 = {
  source_kind: "response_note_record";
  response_candidate_scope:
    | "data.note"
    | "data.note_card"
    | "data.note_card_list[*]"
    | "data.current_note"
    | "data.item"
    | "data.items[*]"
    | "data.notes[*]"
    | "data";
  response_candidate_path: "self" | "note" | "note_card" | "current_note" | "item";
  identifier_field: "note_id" | "noteId" | "id";
  derived_note_id: string;
};
```

约束：

- current v1 admitted template 只能消费这类 source。
- `derived_note_id` 必须为 trim 后非空字符串。
- admitted truth 只在 identifier field 出现在 detail note candidate record 上时成立。
- `response_candidate_scope="data"` 且 `response_candidate_path="self"` 时，只允许用于 `data` 本身已经是 detail note record 的情形；wrapper-shaped `data` 容器必须保持 candidate-only。
- `response_candidate_path` 明确保留嵌套命中路径，因此 `data.items[*].note_card`、`data.notes[*].note_card` 等 current 行为已接受的 nested note-record source 仍属于 admitted truth。
- 当同一 response 中存在多个候选 source 时，只有命中 command-side canonical `note_id` 的 response note record 可以成为 admitted source；candidate-only source 不得覆盖该裁决。

## 4. Candidate-only derivation source

```ts
type XhsDetailCandidateOnlyDerivationSourceV1 =
  | {
      source_kind: "request_field";
      field_name: "source_note_id";
      candidate_note_id: string;
    }
  | {
      source_kind: "referrer";
      field_name: "referrer";
      candidate_note_id: string;
    }
  | {
      source_kind: "response_metadata";
      field_name: "current_note_id" | string;
      candidate_note_id: string;
    };
```

约束：

- 这些 source 只允许保留为 rejected / incompatible observation 的说明性证据。
- 它们不得单独进入 admitted canonical `note_id` derivation。
- 它们不得被 formalize 为 identity alias、transport alias、route admission truth 或 template reuse truth。

## 5. Response-side field boundary

```ts
type XhsDetailResponseFieldStatusV1 =
  | "admitted_note_record_identifier"
  | "candidate_only_metadata_or_wrapper";
```

约束：

- response-side `note_id` / `noteId` / `id` 只有在 detail note candidate record 上才是 admitted derivation source。
- metadata / wrapper / echo field 上的 note-id-like 值当前只属于 candidate-only。

## 6. 最小示例

### admitted

```json
{
  "status": "admitted",
  "source": {
    "source_kind": "response_note_record",
    "response_candidate_scope": "data.items[*]",
    "response_candidate_path": "note_card",
    "identifier_field": "note_id",
    "derived_note_id": "66f0c8ab000000001d012345"
  }
}
```

### candidate_only

```json
{
  "status": "candidate_only",
  "candidate_sources": [
    {
      "source_kind": "request_field",
      "field_name": "source_note_id",
      "candidate_note_id": "66f0c8ab000000001d012345"
    }
  ],
  "failure_reason": "response_note_record_missing"
}
```

## 7. Replacement implementation gate

后续 detail replacement implementation 如要宣告 admitted template path implementation-ready，必须同时消费：

- `FR-0025`
- `FR-0026`
- `#508`
- `FR-0028`

任何 implementation PR 都不得绕过本契约自行定义 detail admitted derivation source。
