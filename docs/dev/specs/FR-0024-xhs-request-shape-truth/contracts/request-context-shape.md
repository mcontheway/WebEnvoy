# FR-0024 契约：XHS Request Context Shape

## 1. `RequestShape`

`RequestShape` 是 XHS read path request-context 的单一 canonical identity 对象。它是内部 contract，不改变现有 public CLI/API 输入面。

```ts
type RequestShape =
  | {
      command: "xhs.search";
      method: "POST";
      pathname: "/api/sns/web/v1/search/notes";
      keyword: string;
      page: number;
      page_size: number;
      sort: string;
      note_type: number;
    }
  | {
      command: "xhs.detail";
      method: "POST";
      pathname: "/api/sns/web/v1/feed";
      source_note_id: string;
      image_scenes: string[];
    }
  | {
      command: "xhs.user_home";
      method: "GET";
      pathname: "/api/sns/web/v1/user/otherinfo";
      user_id: string;
    };
```

约束：

- `RequestShape` 必须由共享的 `deriveRequestShape()` 产生。
- `capture`、`cache key`、`lookup`、`eligibility` 必须全部消费同一个 `RequestShape`。
- 对于 `xhs.search`，derive 阶段必须显式归一 canonical 默认值，避免用 stale page state 或旧模板字段补默认值。
- 对于 `xhs.search`，`note_type` 在进入 `RequestShape` 前必须被归一为 canonical integer 表示。
- 对于 `xhs.detail`，`image_scenes` 必须先归一为稳定的字符串数组表示后再进入 `RequestShape`。
- 对于 `xhs.detail`，当前 baseline 必须冻结 `image_scenes` 的派生规则：它不能凭单一样本常量硬编码，而必须从当前 page-local candidate evidence 物化为稳定 shape。
- 对于 `xhs.user_home`，当前只有 `user_id` 进入 identity；后续新增 identity 字段必须经过新的 spec review。

兼容映射：

- 现有 `xhs.search` 命令输入 `query` 映射为 `RequestShape.keyword`
- 现有 `xhs.search` 命令输入 `note_type?: string | number` 映射为 `RequestShape.note_type: number`
- 现有 `xhs.detail` 命令输入 `note_id` 映射为 `RequestShape.source_note_id`
- 现有 `xhs.user_home` 命令输入 `user_id` 直接映射为 `RequestShape.user_id`

当前 baseline 的 detail 派生规则：

- 对 capture 到的 detail 页面真实请求，`image_scenes` 必须直接从被捕获请求体归一后进入 `RequestShape`
- 对当前 `xhs.detail(note_id=...)` 请求，`deriveRequestShape()` 必须在当前 page-local namespace 的同路由 candidate bucket 内解析 `source_note_id` 对应的 captured templates
- 当且仅当该 bucket 内存在唯一可用的 `source_note_id + image_scenes` 候选时，当前请求才允许物化出完整 `RequestShape`
- 若不存在候选，当前请求必须返回 `template_missing`
- 若同一 `source_note_id` 在当前 namespace 内存在多个不同 `image_scenes` 候选，当前请求必须返回 `incompatible`，不得凭实现猜测其一

以下字段当前明确不属于 `RequestShape`：

- `search_id`
- `X-S-Common`
- trace headers
- referrer
- 其他只在 exact hit 后才允许沿用的 page-context 字段

## 2. `RequestShapeKey`

```ts
type RequestShapeKey = string;
```

`RequestShapeKey` 由 `RequestShape` 的稳定序列化得到，是 page-local namespace 内部的唯一 shape 键。

约束：

- 稳定序列化只能消费 `RequestShape`
- 相同 `RequestShape` 必须产生相同 `RequestShapeKey`
- 不同 `RequestShape` 必须产生不同 `RequestShapeKey`
- key 生成不得依赖 raw body 排列、header 顺序、query 参数顺序、trace 值或 referrer
- `RequestShapeKey` 只表达 canonical shape，不表达页面现场归属；实现不得把它当成跨页面全局主键
- lookup 与 eligibility 不得绕过 `RequestShapeKey` 改走 path-only 或 scope-only 启发式

补充约束：

- request-template cache 的有效存储身份必须显式包含 page-local / document-local namespace
- 因此，真正的缓存身份是 `page_context_namespace + shape_key`，而不是裸 `shape_key`
- 不同页面、不同文档生命周期或不同 tab 现场，即使 `shape_key` 相同，也不得共享同一个 template slot

## 3. `CapturedRequestTemplateRecord`

`CapturedRequestTemplateRecord` 表达“当前页面现场上一次被允许缓存的真实请求模板”。它是 page-local runtime artifact，不是持久化 replay truth。

```ts
type CapturedRequestTemplateRecord = {
  page_context_namespace: string;
  shape: RequestShape;
  shape_key: RequestShapeKey;
  template_headers: Record<string, string>;
  template_body: Record<string, unknown> | null;
  referrer: string | null;
  captured_at: number;
  source_kind: "page_request" | "webenvoy_synthetic_request";
  request_status: {
    completion: "completed";
    http_status: number;
  };
};
```

约束：

- 只有 `source_kind="page_request"` 且 `request_status.http_status` 为 2xx 的记录允许进入缓存
- `page_context_namespace` 必须在 capture 时同步写入，用于隔离不同页面现场
- `shape` 与 `shape_key` 必须在 capture 时同时写入，不允许后置推断
- `template_headers`、`template_body`、`referrer` 只能在 exact hit 后被复用
- `template_body` 不得在 exact miss 时被当成第二 identity truth 继续回推兼容性
- 对于 `xhs.detail`，`template_body` 不能整体摊平覆盖 canonical body；只能在 exact hit 后复用 shape 允许的模板字段

## 4. `RejectedRequestContextObservation`

`RejectedRequestContextObservation` 表达“当前页面现场最近一次被 capture admission 拒绝的候选请求”。它不是 template record，也不会进入可复用模板池，但它为 `rejected_source` 结果提供可达的数据来源。

```ts
type RejectedRequestContextObservation = {
  page_context_namespace: string;
  shape: RequestShape;
  shape_key: RequestShapeKey;
  rejection_reason: "synthetic_request_rejected" | "failed_request_rejected";
  observed_at: number;
};
```

约束：

- 只有在 capture admission 明确拒绝某条候选请求时，才允许写入 `RejectedRequestContextObservation`
- `RejectedRequestContextObservation` 必须在 capture admission 拒绝时保留当时已导出的 `shape` 与 `shape_key`
- 它只能作为 page-local 诊断来源，不得被当成可复用模板
- `rejected_source` 只能对当前请求的同 namespace、同 `shape_key` observation 成立，不允许仅按 route-level 误归因
- `synthetic_request_rejected` 只有在 full `RequestShape` 已成功导出后才允许写入；若 shape 尚未物化，系统必须提前返回 `miss` 或 `incompatible`，而不是生成无 shape 的 synthetic reject

## 5. `TemplateLookupResult`

```ts
type TemplateLookupResult =
  | {
      state: "hit";
      record: CapturedRequestTemplateRecord;
    }
  | {
      state: "miss";
      reason: "template_missing";
    }
  | {
      state: "incompatible";
      reason: "shape_mismatch";
      record: CapturedRequestTemplateRecord;
    }
  | {
      state: "stale";
      reason: "template_stale";
      record: CapturedRequestTemplateRecord;
    }
  | {
      state: "rejected_source";
      reason: "synthetic_request_rejected" | "failed_request_rejected";
      observation: RejectedRequestContextObservation;
    };
```

约束：

- `hit` 只允许在 exact shape match、来源合法且 freshness 通过时返回
- `miss` 只表示当前 page-local namespace 内不存在任何同路由候选，也不存在可消费的 rejected observation
- `incompatible` 表示当前 page-local namespace 内存在同 command + method + pathname 的候选记录，但没有任何记录与当前 `RequestShape` 完全一致
- `stale` 表示 shape 命中，但 freshness gate 失败
- `rejected_source` 表示当前页面现场存在最近一次被 capture admission 拒绝的候选观察，且当前没有可复用模板

## 6. `RequestContextMissReason`

```ts
type RequestContextMissReason =
  | "template_missing"
  | "shape_mismatch"
  | "template_stale"
  | "synthetic_request_rejected"
  | "failed_request_rejected";
```

约束：

- miss reason 必须 machine-readable
- fail-closed 行为必须至少保留 `request_context_missing` 与 `request_context_incompatible` 两类结构化结果，并带出 `RequestContextMissReason`
- 不允许把 `RequestContextMissReason` 压扁成无结构的 plain-text 错误

## 7. Capture / Lookup / Eligibility 协议规则

### capture

- 只能对真实页面请求运行 `deriveRequestShape()`
- 无法导出 `RequestShape` 时，必须拒绝缓存
- synthetic request、失败请求、非 2xx 请求必须拒绝缓存
- capture admission 拒绝时，允许写入 `RejectedRequestContextObservation`，但不得写入 `CapturedRequestTemplateRecord`

### lookup

lookup 必须按两个阶段执行：

1. 先在当前 `page_context_namespace` 内，按 `command + method + pathname` 解析当前页面现场的候选 bucket
2. 再在该 bucket 内按 `shape_key` 与 `shape` 判定 `hit | incompatible | stale | rejected_source | miss`

约束：

- 不允许绕过 `page_context_namespace`
- 不允许在跨页面或跨文档生命周期范围内共享 bucket
- `incompatible` 只能来自“同 namespace、同 command + method + pathname 下存在其他 shape 候选”
- `rejected_source` 只能来自同 namespace 下最近一次 capture admission 被拒绝的 observation
- 不允许按 `method + pathname`、只按 keyword、只按 note_id 或其他局部字段跨 namespace 模糊查找

### eligibility

- 只能用当前请求的 `RequestShape` 与候选记录 `shape` 做 exact comparison
- freshness gate 必须在 exact shape match 之后执行
- 不存在“部分 shape 命中后继续局部复用”

## 8. compatibility 与 ownership 边界

### 与当前命令输入的兼容

- 本 contract 不改变现有 `xhs.search/query`、`xhs.detail/note_id`、`xhs.user_home/user_id` 输入面
- `RequestShape` 是 internal derivation object，不要求用户直接传入

### 与 FR-0018 的边界

- `CapturedRequestTemplateRecord` 不得被当成 `ReplayInputSnapshotRef`
- `RequestShape` / `RequestShapeKey` 是 request-context 层的 runtime truth，不是 cross-run replay truth
- 若未来要把 request template 提升为正式 replay source，必须另开 spec review，而不是在实现中静默升级
