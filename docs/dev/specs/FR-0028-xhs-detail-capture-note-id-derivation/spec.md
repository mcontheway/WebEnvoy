# FR-0028 冻结 XHS Detail Capture-Side Canonical Note ID Derivation

Canonical Issue: #510

## 背景

`#504 / FR-0025` 已冻结 `xhs.detail` 的 command surface、canonical command input 与 request-context baseline：current public CLI 输入稳定只要求 `note_id`，且 detail 仍属于 unified XHS read execution family。`#505 / FR-0026` 又进一步冻结：current v1 `xhs.detail` canonical identity 只包含 `note_id`，`image_scenes` 不进入 identity，`source_note_id` 也不进入 admitted canonical identity truth。

但当前 formal truth 仍缺一块关键 owner：当 capture admission 观察到 detail route 的真实或候选 request/response artifact 时，系统究竟可以从哪些 capture-side 证据正式导出 canonical `note_id`，还没有被独立冻结。只要这部分继续停留在 deferred 状态，replacement implementation 就仍然缺少一条 admission-ready formal 输入，最终只能在实现 PR 中自行决定 admitted template 到底消费 response-side note fields、request-side `source_note_id`、referrer，还是其他候选字段。

当前仓库内能够支撑的最小稳定事实已经收敛到以下几条：

- current implementation 与 in-tree tests 的 command-side canonical truth 仍只围绕 `note_id` 运转。
- detail API candidate route 目前可见的 request-side 参数形态是 `source_note_id`，但 `FR-0005` 与 `FR-0026` 已明确这仍只是 candidate / failed / synthetic 层级事实，不足以单独冻结成 admitted canonical mapping。
- current implementation 已经存在一条更窄、但可被 tests 支撑的 response-side truth：detail 请求返回成功时，只有当 response payload 中出现 detail note candidate record，且该 record 的 `note_id` / `noteId` / `id` 与目标 `note_id` 对齐，才会被认定为“包含目标 detail 数据”；metadata-only note id 不构成 success evidence。

因此，本 FR 的职责不是重写 `#505` 的 identity-only 结论，也不是提前冻结 `#508` 负责的 shared reuse semantics，而是补齐这条缺失的 formal owner：冻结 current v1 `xhs.detail` capture-side canonical `note_id` derivation 规则，明确 admitted template 可接受的 derivation source，明确 rejected / incompatible observation 可保留的 candidate 边界，并把 replacement implementation 的 detail formal gate 收口到可执行状态。

## 目标

1. 冻结 current v1 `xhs.detail` capture-side canonical `note_id` derivation 的 formal owner。
2. 明确 admitted template 在 capture admission 阶段可接受的 canonical `note_id` derivation source。
3. 明确 rejected / incompatible observation 可保留的 candidate derivation 边界。
4. 明确 referrer、request-side `source_note_id`、response-side note fields 在 current v1 的 formal 地位。
5. 明确 replacement implementation 的 detail formal gate 必须消费本 FR，不能绕过本 FR 自行定义 admitted derivation path。

## 非目标

- 不在本 FR 内修改 runtime、extension、CLI 或测试实现代码。
- 不在本 FR 内改写 `#504 / FR-0025` 已冻结的 command surface、target-page baseline、四对象输入 ownership 或 request-level output ownership。
- 不在本 FR 内改写 `#505 / FR-0026` 已冻结的 identity-only 结论。
- 不在本 FR 内冻结 `image_scenes`、`source_note_id` 的 admitted canonical identity 地位，或其 transport alias / normalization / route admission 语义。
- 不在本 FR 内冻结 `shape_key`、route bucket、lookup slotting、exact-match / freshness、rejected-source matching、template reuse 或其他 shared reuse semantics；这些继续由 `#508` 承接。
- 不在本 FR 内推进 `#445` closeout、latest-main rerun、guardian rerun 或 replacement implementation 本体。

## 功能需求

### 1. current v1 detail capture-side derivation owner

系统必须冻结：`xhs.detail` admitted template 的 capture-side canonical `note_id` derivation 在 current v1 有且只有一条 formal owner，即基于 response-side detail note candidate record 的 canonical derivation。

约束：

- 该 derivation owner 只服务于 detail capture admission。
- 它不改变 command-side canonical identity 仍是 `note_id` only 的正式结论。
- 它不替代 `#508` 对 shape、shape_key、lookup slotting、eligibility 与 reuse 语义的 formal ownership。
- 任何后续实现 PR 如需宣告 detail replacement path implementation-ready，必须显式消费本 FR，而不是把 admitted derivation source 留给实现侧自由发挥。

### 2. admitted template 的 canonical derivation source

系统必须冻结以下 current v1 admitted derivation 规则：

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
  response_candidate_path: string;
  identifier_field: "note_id" | "noteId" | "id";
  derived_note_id: string;
};
```

约束：

- admitted template 只能从 response-side detail note candidate record 导出 canonical `note_id`。
- `derived_note_id` 必须是 trim 后非空字符串。
- 只有当该 response candidate record 的 `note_id` / `noteId` / `id` 命中目标 `note_id` 时，才允许进入 admitted template path。
- response candidate scope 允许来自：
  - `data.note`
  - `data.note_card`
  - `data.note_card_list[*]`
  - `data.current_note`
  - `data.item`
  - `data.items[*]`
  - `data.notes[*]`
  - `data`
- `response_candidate_path` 用于记录 admitted detail note record 相对其 scope root 的完整命中路径，必须保留 multi-hop nested path，而不能只收窄为末级字段名。
- 当 scope root 本身就是 admitted detail note candidate record 时，`response_candidate_path` 使用 `self`。
- current v1 `response_candidate_path` 的 path segment 仍只允许来自当前实现已接受的 detail nested traversal key：`note`、`note_card`、`current_note`、`item`；但这些 segment 可以多跳组合，例如 `note_card`、`note.note_card`、`item.note_card`。
- 因此，current v1 admitted source 明确覆盖 `data.items[*].note_card`、`data.note_card.note` 等嵌套命中路径；只要最终命中的仍是 detail note candidate record，就属于本 FR 的 admitted truth。
- 当 `response_candidate_scope="data"` 且 `response_candidate_path="self"` 时，它表示 `body.data` 自身就是 current main 已接受的 detail response candidate root；这既可以是 detail note record，也可以是当前 detail matcher 已接纳的 wrapper-shaped detail payload，只要该 root 自身携带命中的 `note_id` / `noteId` / `id`。
- metadata-only note id、route string、referrer、request-side body 字段都不能替代这条 admitted derivation source。
- 当同一 response 中出现多个 note-id-bearing candidate record 时，只有与 command-side canonical `note_id` 一致的 response note record 才能进入 admitted path；candidate-only source 不得参与覆盖或纠偏这条判断。

### 3. admitted derivation 与 success evidence 的绑定

系统必须冻结：detail capture admission 若要把某条候选 artifact 提升为 admitted template，除了 route / status / source-side前置约束外，还必须完成 response-side canonical `note_id` derivation。

约束：

- 仅有 `HTTP 200` 或 `code=0` 不足以构成 admitted template。
- 仅有 response metadata 中的 note-id-like 字段，不足以构成 admitted template。
- 仅有 request-side `source_note_id`，不足以构成 admitted template。
- 如果 response payload 成功返回，但无法从 admitted response candidate record 导出与目标一致的 canonical `note_id`，该 artifact 不得进入 admitted template。
- 如果 admitted response candidate 与 candidate-only source 之间出现 note id 冲突，必须以“response-side admitted source 必须命中 command-side canonical `note_id`”为唯一裁决规则；candidate-only source 不得把该 artifact 救回 admitted path。
- 本 FR 只冻结 detail admitted derivation truth；它不重新定义 shared capture admission 其余规则。

### 4. rejected / incompatible observation 的 candidate 边界

系统必须冻结：以下来源在 current v1 只允许保留为 rejected / incompatible observation 的 candidate derivation evidence，不得提升为 admitted canonical `note_id` truth：

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

- 这些 candidate source 可以作为 rejected / incompatible observation 的说明性证据被保留。
- 它们可以帮助解释“为什么这条候选请求看起来与当前 detail route 相关”，但不能单独建立 admitted canonical `note_id`。
- 它们不得被 formalize 为 admitted canonical mapping、第二个 identity 字段、跨路由 transport alias、route admission truth、exact-match truth 或 template reuse truth。
- 这些 candidate source 的保留方式、slotting、与 `rejected_source` / `incompatible` 的状态机关系，继续由 `#508` 冻结；本 FR 不越权定义 shared reuse semantics。

### 5. referrer 的 current formal 地位

系统必须冻结以下 current v1 结论：

- referrer 不是 `xhs.detail` capture-side canonical `note_id` derivation 的 admitted source。
- referrer 当前也不是 `xhs.detail` canonical identity truth。
- referrer 可以继续作为候选现场上下文或 rejected / incompatible observation 的说明性字段存在，但其 reuse / compatibility formal truth 不由本 FR 定义。

补充约束：

- 不得因为 referrer URL path、query 或来源页语义看起来包含 note id，就把 referrer 升格为 admitted canonical derivation source。
- 不得把 search-only FR 中“exact hit 后可复用 referrer”类结论直接平移为 detail derivation truth。

### 6. request-side `source_note_id` 的 current formal 地位

系统必须冻结以下 current v1 结论：

- detail route request body 中的 `source_note_id` 继续只是一条 request-side candidate 事实。
- `source_note_id` 可以作为 rejected / incompatible observation 的 candidate derivation evidence 被保留。
- `source_note_id` 当前不能单独导出 admitted canonical `note_id`。
- `source_note_id` 当前也不能被 formalize 为 admitted canonical mapping、identity alias、transport alias、route admission truth 或 response-target verification truth。

补充约束：

- `#505 / FR-0026` 的 identity-only 结论继续成立：`source_note_id` 不进入 canonical identity baseline。
- 本 FR 不得把“实现当前会发 `source_note_id`”倒推出“formal 已承认 `source_note_id -> note_id` admitted mapping”。

### 7. response-side note fields 的 current formal 地位

系统必须冻结以下 current v1 结论：

- response-side detail note candidate record 上的 `note_id` / `noteId` / `id`，是 current v1 admitted canonical `note_id` derivation 的唯一 formal 来源。
- 该 admitted truth 只在“这些字段出现在 detail note candidate record 上”时成立。
- 如果相同字段只出现在 metadata、wrapper、route echo 或其他非 detail note candidate record 上，则当前只能视为 candidate-only observation，不得直接进入 admitted template。

补充约束：

- metadata 中的 `current_note_id` 不能单独作为 admitted success evidence。
- 本 FR 不把 response candidate record 的完整字段 shape 冻结为正式 schema；它只冻结哪些 note-id-bearing field 可以承担 admitted derivation。

### 8. replacement implementation formal gate

系统必须冻结以下 current v1 implementation gate：

- replacement implementation 的 detail path 不得在缺少本 FR formal freeze 的情况下宣告 implementation-ready。
- replacement implementation 如要处理 detail admitted template，必须同时消费：
  - `#504 / FR-0025` 的 command surface 与 request-context baseline
  - `#505 / FR-0026` 的 identity-only freeze
  - `#508` 的 shared reuse semantics 与 replacement gate
  - 本 FR 的 capture-side canonical `note_id` derivation freeze
- 当前仓库内与同一路径相关的 formal gate 必须按同一 prerequisite tree 解释；不得再把 detail replacement path 写成只等待 `#504/#505/#508`。

补充约束：

- 任何 successor implementation PR 都不得重新发明第二套 detail admitted derivation truth。
- 若后续实现想把 referrer、`source_note_id` 或 metadata-only note field 升格为 admitted derivation source，必须基于新的 admission-ready 证据与新的 spec 修订。

## GWT 验收场景

### 场景 1：response-side note record 可导出 admitted canonical note_id

Given `xhs.detail` 当前 command-side canonical input 已提供合法 `note_id`
And capture admission 观察到 detail route 的成功 response
And response payload 中存在 detail note candidate record
And 该 record 的 `note_id`、`noteId` 或 `id` 与目标 `note_id` 一致
When 系统执行 current v1 capture-side canonical `note_id` derivation
Then 该 derivation source 必须被视为 admitted
And admitted template 可以基于这条 derivation source 建立 canonical `note_id`

### 场景 2：metadata-only note id 不能构成 admitted derivation

Given detail route 返回 `HTTP 200`
And response 只在 metadata 或 wrapper 字段中出现 note-id-like 值
And response 中不存在命中目标的 detail note candidate record
When 系统执行 current v1 capture-side canonical `note_id` derivation
Then 该 response 不得进入 admitted template
And metadata-only note id 只能停留在 candidate-only observation

### 场景 3：request-side source_note_id 不能单独构成 admitted derivation

Given capture admission 观察到 detail route request body 中存在 `source_note_id`
And 当前 response-side 仍缺少 admitted response note record
When 系统判断当前 artifact 是否能导出 canonical `note_id`
Then `source_note_id` 只能作为 request-side candidate evidence
And 不得被提升为 admitted canonical `note_id` derivation truth

### 场景 4：referrer 不能单独构成 admitted derivation

Given 当前候选 artifact 的 referrer URL 中看起来包含目标 note id
And 当前 response-side 仍缺少 admitted response note record
When 系统判断当前 artifact 是否可被 admitted
Then referrer 只能作为 candidate-only observation
And 不得单独导出 admitted canonical `note_id`

### 场景 5：response-side note fields 只在 detail note candidate record 上成立

Given response payload 中某个 detail note candidate record 携带 `id`
And 同一 response 的 metadata 中也存在 `current_note_id`
When 系统判断 admitted canonical derivation source
Then admitted truth 只能来自该 detail note candidate record 上的 `id`
And metadata `current_note_id` 不能替代 admitted source

### 场景 6：replacement implementation 不得绕过 FR-0028

Given replacement implementation PR 声称 detail admitted template path 已 implementation-ready
When reviewer 检查其 formal prerequisites
Then 该 PR 必须显式消费 `FR-0025`、`FR-0026`、`#508` 与本 FR
And 不得把 detail capture-side canonical `note_id` derivation 留给实现侧自行决定

## 异常与边界场景

- response payload 缺少任何 detail note candidate record 时，detail admitted canonical derivation 失败；这不等于 identity 变化，只代表当前 artifact 不可进入 admitted template。
- response payload 存在当前实现已接受的 detail response candidate record，但其中 `note_id` / `noteId` / `id` 与目标 `note_id` 不一致时，该 artifact 不能进入 admitted template；它最多只构成 incompatible observation。
- `source_note_id`、referrer 或 metadata-only note field 即使与目标 `note_id` 一致，也不能在 current v1 单独把 artifact 提升为 admitted template。
- 本 FR 不冻结 candidate-only observation 的持久化 shape、slotting 与 miss-state 命名；这些继续由 `#508` 处理。
- 本 FR 不阻止未来把额外 source 升格为 admitted derivation source，但前提必须是新的 admission-ready 仓库证据与新的 spec 修订。

## 验收标准

1. current v1 `xhs.detail` capture-side canonical `note_id` derivation 已被独立 formal freeze。
2. admitted template 的 derivation source 已收敛为 response-side detail note candidate record 上的 `note_id` / `noteId` / `id`。
3. `source_note_id`、referrer、metadata-only note field 的 current formal 地位已明确限制为 candidate-only，不与 `#505` 的 identity-only 结论冲突。
4. 本 FR 未越权冻结 `shape_key`、lookup slotting、route eligibility、exact-match / freshness 或其他 shared reuse semantics。
5. replacement implementation gate 已明确必须消费本 FR。
6. 本 FR 未把 response-side detail candidate record 的完整 schema 扩写成超出当前证据的正式契约。

## 依赖与前置条件

- `vision.md`
- `docs/dev/roadmap.md`
- `docs/dev/architecture/system-design.md`
- `docs/dev/architecture/system-design/read-write.md`
- `docs/dev/specs/FR-0005-xhs-read-spike/research.md`
- `docs/dev/specs/FR-0024-xhs-request-shape-truth/spec.md`
- `docs/dev/specs/FR-0025-xhs-detail-user-home-command-surface-baseline/spec.md`
- `docs/dev/specs/FR-0026-xhs-detail-canonical-identity/spec.md`
- GitHub issue `#508`
- GitHub issue `#510`
- `extension/xhs-read-execution.ts`
- `tests/xhs-read-execution.fallback.test.ts`
