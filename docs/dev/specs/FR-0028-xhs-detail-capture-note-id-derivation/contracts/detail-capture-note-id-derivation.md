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

## 2. 输入边界

### 输入对象

```ts
type XhsDetailCaptureDerivationInputV1 = {
  command_note_id: string;
  response_candidate?: Record<string, unknown> | null;
  request_candidate?: {
    source_note_id?: string | null;
    referrer?: string | null;
  } | null;
  response_metadata_candidate?: Record<string, unknown> | null;
};
```

字段约束：

- `command_note_id` 必填，且必须为 trim 后非空字符串；空值输入不能进入 admitted derivation。
- `response_candidate` 为空时，当前输入最多只能导出 candidate-only evidence。
- `response_candidate` 若存在，必须表示当前已冻结 admitted boundary 内的 detail response candidate record；current v1 只冻结 `body.data.note` 与 `body.data.items[*].note_card`。
- `request_candidate` 与 `response_metadata_candidate` 都是可选的说明性输入；它们不能单独生成 admitted truth。

未冻结边界：

- current main 尚未对外暴露独立的 structured derivation result object；因此本契约不冻结 `XhsDetailCaptureDerivationResultV1`、`status` 枚举、`failure_reason` 字段或其他派生状态返回对象。
- current v1 在该边界内只冻结 admitted source 的最小 shape，以及 candidate-only derivation source 的类别边界。
- candidate-only source 如何被上层 capture admission 记录为 rejected / incompatible observation，继续由 `#508 / FR-0027` 冻结；本契约不越权定义该状态机返回对象。

## 3. Admitted canonical derivation source

```ts
type XhsDetailAdmittedCanonicalNoteIdSourceV1 = {
  source_kind: "response_candidate_record";
  identifier_field: "note_id" | "noteId" | "id";
  derived_note_id: string;
};

type XhsDetailResponseCandidateRecordBoundaryV1 = {
  response_root: "body.data";
  admitted_candidate_entries: "note" | "items[*].note_card";
};
```

约束：

- current v1 admitted template 只能消费这类 source。
- `derived_note_id` 必须为 trim 后非空字符串。
- admitted truth 只在 identifier field 出现在 current matcher 已接受的 detail response candidate record 上时成立。
- current v1 formal contract 只显式冻结两类已验证 response candidate matcher 边界：`body.data.note` 与 `body.data.items[*].note_card`。
- 因此，当前 tests 已接纳的 bare note payload `body.data.note` 与 wrapped detail payload `body.data.items[*].note_card`，属于 admitted response candidate scope。
- 除上述两类已验证路径外，current implementation 仍会遍历的 bare-body root、self root、其他 direct entry 与递归路径，当前都不在本契约冻结。
- 当同一 response 中存在多个候选 source 时，只有命中 command-side canonical `note_id` 的 response candidate record 可以成为 admitted source；candidate-only source 不得覆盖该裁决。

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

- response-side `note_id` / `noteId` / `id` 只有在 current matcher 已接受的 detail response candidate record 上才是 admitted derivation source。
- 这里的 “current matcher 已接受” 在 current v1 formal 内固定只指向 `body.data.note` 与 `body.data.items[*].note_card`。
- metadata field、echo field，以及 current matcher 未接受的 wrapper / record 上的 note-id-like 值当前只属于 candidate-only。
- 当前唯一被 formal 接纳的 wrapped response candidate record 是 `body.data.items[*].note_card`；其余 wrapper / record 继续停留在 candidate-only 或未冻结状态。

## 6. 最小示例

### admitted source

```json
{
  "source_kind": "response_candidate_record",
  "identifier_field": "note_id",
  "derived_note_id": "66f0c8ab000000001d012345"
}
```

### candidate-only source

```json
{
  "source_kind": "request_field",
  "field_name": "source_note_id",
  "candidate_note_id": "66f0c8ab000000001d012345"
}
```

### admitted wrapped payload sample

```json
{
  "body": {
    "data": {
      "items": [
        {
          "note_card": {
            "noteId": "66f0c8ab000000001d012345"
          }
        }
      ]
    }
  }
}
```

## 7. Replacement implementation gate

后续 detail replacement implementation 如要宣告 admitted template path implementation-ready，必须同时消费：

- `FR-0025`
- `FR-0026`
- `#508`
- `FR-0028`

任何 implementation PR 都不得绕过本契约自行定义 detail admitted derivation source。
