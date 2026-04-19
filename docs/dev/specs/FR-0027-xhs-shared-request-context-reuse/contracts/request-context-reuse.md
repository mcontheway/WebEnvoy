# FR-0027 契约：XHS Shared Request-Context Reuse

## 1. Slotting identity

```ts
type RequestContextRouteScopeV1 = {
  command: "xhs.search" | "xhs.detail" | "xhs.user_home";
  method: "POST" | "GET";
  pathname: string;
};

type RequestContextRouteBucketIdV1 = {
  page_context_namespace: string;
  route_scope: RequestContextRouteScopeV1;
};

type RequestContextShapeSlotIdV1 = {
  page_context_namespace: string;
  shape_key: string;
};
```

约束：

- `shape_key` 只能来自 canonical shape 的稳定序列化。
- `page_context_namespace` 必须是 page-local / document-local namespace token，不得退化成 command-family 常量。
- route bucket identity 是 `page_context_namespace + route_scope`。
- 实际 shape slot identity 是 `page_context_namespace + shape_key`；lookup 必须先选 route bucket，再在 bucket 内按 `shape_key` 命中。
- `route_scope` 是 route bucket 选择前置，不得被写成与 `shape_key` 并列的第二套 shape slot identity。

## 2. Read-family canonical shape

```ts
type XhsDetailReuseShapeV1 = {
  command: "xhs.detail";
  method: "POST";
  pathname: "/api/sns/web/v1/feed";
  note_id: string;
};

type XhsUserHomeReuseShapeV1 = {
  command: "xhs.user_home";
  method: "GET";
  pathname: "/api/sns/web/v1/user/otherinfo";
  user_id: string;
};
```

约束：

- `xhs.detail` reuse-shape 不包含 `source_note_id` 或 `image_scenes`。
- 当前 formal contract 只承认 canonical `note_id`；detail referrer / transport derivation 继续保持 deferred。
- `xhs.user_home` reuse-shape 最终只保留 canonical `user_id`。

## 3. Bucket state

```ts
type SharedObservedRequestStatusV1 = {
  completion: "completed" | "failed";
  http_status: number | null;
};

type SharedCompleted2xxRequestStatusV1 = {
  completion: "completed";
  http_status: 200 | 201 | 202 | 203 | 204 | 205 | 206 | 207 | 208 | 226;
};

type SharedAdmittedTemplateStateV1 = {
  captured_at: number;
  source_kind: "page_request";
  request_status: SharedCompleted2xxRequestStatusV1;
};

type SharedRejectedObservationStateV1 = {
  observed_at: number;
  source_kind: "page_request" | "synthetic_request";
  rejection_reason:
    | "synthetic_request_rejected"
    | "failed_request_rejected"
    | "shape_mismatch";
  request_status: SharedObservedRequestStatusV1;
};

type CapturedRequestContextShapeSlotV1 = {
  admitted_template: (SharedAdmittedTemplateStateV1 & Record<string, unknown>) | null;
  rejected_observation: (SharedRejectedObservationStateV1 & Record<string, unknown>) | null;
};

type CapturedRequestContextRouteBucketV1 = {
  page_context_namespace: RequestContextRouteBucketIdV1["page_context_namespace"];
  route_scope: RequestContextRouteBucketIdV1["route_scope"];
  incompatible_observation: (SharedRejectedObservationStateV1 & Record<string, unknown>) | null;
  available_shape_keys: string[];
};
```

约束：

- `admitted_template` 只承载 admitted page request。
- `rejected_observation` 只承载 synthetic / failed / rejected candidate。
- `incompatible_observation` 只承载同 namespace / 同 route bucket 下最近一次 sibling-shape mismatch candidate。
- `incompatible_observation` 不得进入 shape-keyed slot。
- `captured_at` 是 admitted template freshness gate 的必需字段。
- `admitted_template.request_status` 必须固定为 `completion="completed"` 且 `http_status` 为非空 2xx。
- `observed_at` 是 rejected / incompatible observation 的必需字段；不得与 `FR-0024` 的 `RejectedRequestContextObservation` 时间语义冲突。
- `source_kind`、非空 machine-readable `rejection_reason` 与 `request_status` 是 rejected-source 语义的必需字段。

## 4. Gate rule

`#508 / FR-0027` 只把 replacement implementation gate 冻结为“仍 blocked”。

replacement implementation 只有在 `#502/#504/#505/#508` formal freeze 全部完成，且 detail capture-side canonical `note_id` derivation 已由 `#510` 或其受控替代 formal owner 冻结后，才允许进入 implementation-ready 状态。
