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
      note_type: string | number;
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
- 对于 `xhs.detail`，`image_scenes` 必须先归一为稳定的字符串数组表示后再进入 `RequestShape`。
- 对于 `xhs.user_home`，当前只有 `user_id` 进入 identity；后续新增 identity 字段必须经过新的 spec review。

兼容映射：

- 现有 `xhs.search` 命令输入 `query` 映射为 `RequestShape.keyword`
- 现有 `xhs.detail` 命令输入 `note_id` 映射为 `RequestShape.source_note_id`
- 现有 `xhs.user_home` 命令输入 `user_id` 直接映射为 `RequestShape.user_id`

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

`RequestShapeKey` 由 `RequestShape` 的稳定序列化得到，是 capture、cache 与 lookup 的唯一键。

约束：

- 稳定序列化只能消费 `RequestShape`
- 相同 `RequestShape` 必须产生相同 `RequestShapeKey`
- 不同 `RequestShape` 必须产生不同 `RequestShapeKey`
- key 生成不得依赖 raw body 排列、header 顺序、query 参数顺序、trace 值或 referrer
- lookup 与 eligibility 不得绕过 `RequestShapeKey` 改走 path-only 或 scope-only 启发式

## 3. `CapturedRequestTemplateRecord`

`CapturedRequestTemplateRecord` 表达“当前页面现场上一次被允许缓存的真实请求模板”。它是 page-local runtime artifact，不是持久化 replay truth。

```ts
type CapturedRequestTemplateRecord = {
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
- `shape` 与 `shape_key` 必须在 capture 时同时写入，不允许后置推断
- `template_headers`、`template_body`、`referrer` 只能在 exact hit 后被复用
- `template_body` 不得在 exact miss 时被当成第二 identity truth 继续回推兼容性
- 对于 `xhs.detail`，`template_body` 不能整体摊平覆盖 canonical body；只能在 exact hit 后复用 shape 允许的模板字段

## 4. `TemplateLookupResult`

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
      record?: CapturedRequestTemplateRecord;
    };
```

约束：

- `hit` 只允许在 exact shape match、来源合法且 freshness 通过时返回
- `miss` 只表示不存在当前 `RequestShapeKey` 对应模板
- `incompatible` 表示取回了候选记录，但其 `shape` 与当前 `RequestShape` 不完全一致
- `stale` 表示 shape 命中，但 freshness gate 失败
- `rejected_source` 表示候选记录存在，但来源或完成状态不满足 capture admission 规则

## 5. `RequestContextMissReason`

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

## 6. Capture / Lookup / Eligibility 协议规则

### capture

- 只能对真实页面请求运行 `deriveRequestShape()`
- 无法导出 `RequestShape` 时，必须拒绝缓存
- synthetic request、失败请求、非 2xx 请求必须拒绝缓存

### lookup

- 只能以当前请求的 `RequestShapeKey` 查找候选模板
- 不允许按 `method + pathname`、只按 keyword、只按 note_id 或其他局部字段模糊查找

### eligibility

- 只能用当前请求的 `RequestShape` 与候选记录 `shape` 做 exact comparison
- freshness gate 必须在 exact shape match 之后执行
- 不存在“部分 shape 命中后继续局部复用”

## 7. compatibility 与 ownership 边界

### 与当前命令输入的兼容

- 本 contract 不改变现有 `xhs.search/query`、`xhs.detail/note_id`、`xhs.user_home/user_id` 输入面
- `RequestShape` 是 internal derivation object，不要求用户直接传入

### 与 FR-0018 的边界

- `CapturedRequestTemplateRecord` 不得被当成 `ReplayInputSnapshotRef`
- `RequestShape` / `RequestShapeKey` 是 request-context 层的 runtime truth，不是 cross-run replay truth
- 若未来要把 request template 提升为正式 replay source，必须另开 spec review，而不是在实现中静默升级
