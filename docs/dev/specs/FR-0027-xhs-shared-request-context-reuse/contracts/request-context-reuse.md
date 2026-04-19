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
  shape_key: SharedReuseCanonicalShapeKeyV1;
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

type SharedReuseCanonicalShapeV1 =
  | RequestShape
  | XhsDetailReuseShapeV1
  | XhsUserHomeReuseShapeV1;

type SharedReuseCanonicalShapeKeyV1 = string;
```

约束：

- `RequestShape` 在此仅表示 `FR-0024` 已冻结的 `xhs.search` canonical shape 引用；search-only canonical shape 的 formal owner 仍是 `FR-0024`。
- `xhs.detail` reuse-shape 不包含 `source_note_id` 或 `image_scenes`。
- 当前 formal contract 只承认 canonical `note_id`；detail referrer / transport derivation 继续保持 deferred。
- `xhs.user_home` reuse-shape 最终只保留 canonical `user_id`。
- route-bucket / shape-slot observation 中的 `shape` 只能实例化为上述 canonical request-shape variants 之一。
- observation 中的 `shape_key` 只能实例化为对应 canonical request-shape variant 的稳定序列化结果；其中 search variant 继续绑定 `FR-0024` 的 `RequestShapeKey`。

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

type SharedRejectedObservationCommonV1 = {
  shape: SharedReuseCanonicalShapeV1;
  shape_key: SharedReuseCanonicalShapeKeyV1;
  observed_at: number;
  request_status: SharedObservedRequestStatusV1;
};

type SharedSyntheticRejectedObservationStateV1 = SharedRejectedObservationCommonV1 & {
  source_kind: "synthetic_request";
  rejection_reason: "synthetic_request_rejected";
};

type SharedFailedRequestRejectedObservationStateV1 = SharedRejectedObservationCommonV1 & {
  source_kind: "page_request";
  rejection_reason: "failed_request_rejected";
};

type SharedShapeSlotRejectedObservationStateV1 =
  | SharedSyntheticRejectedObservationStateV1
  | SharedFailedRequestRejectedObservationStateV1;

type SharedRouteBucketIncompatibleObservationStateV1 = {
  shape: SharedReuseCanonicalShapeV1;
  shape_key: SharedReuseCanonicalShapeKeyV1;
  observed_at: number;
  source_kind: "page_request";
  incompatibility_reason: "shape_mismatch";
  request_status: SharedCompleted2xxRequestStatusV1;
};

type CapturedRequestContextShapeSlotV1 = {
  admitted_template: (SharedAdmittedTemplateStateV1 & Record<string, unknown>) | null;
  rejected_observation: (SharedShapeSlotRejectedObservationStateV1 & Record<string, unknown>) | null;
};

type CapturedRequestContextRouteBucketV1 = {
  page_context_namespace: RequestContextRouteBucketIdV1["page_context_namespace"];
  route_scope: RequestContextRouteBucketIdV1["route_scope"];
  incompatible_observation:
    | (SharedRouteBucketIncompatibleObservationStateV1 & Record<string, unknown>)
    | null;
  available_shape_keys: SharedReuseCanonicalShapeKeyV1[];
};
```

约束：

- `admitted_template` 只承载 admitted page request。
- `rejected_observation` 只承载 synthetic / failed / rejected candidate。
- `incompatible_observation` 只承载同 namespace / 同 route bucket 下最近一次 sibling-shape mismatch candidate。
- `incompatible_observation` 不得进入 shape-keyed slot。
- `captured_at` 是 admitted template freshness gate 的必需字段。
- `admitted_template.request_status` 必须固定为 `completion="completed"` 且 `http_status` 为非空 2xx。
- `rejected_observation` 与 `incompatible_observation` 都必须携带 `observed_at`。
- shape-slot `rejected_observation` 必须显式携带 `shape`、`shape_key`、`source_kind`、非空 machine-readable `rejection_reason` 与 `request_status`；其 `rejection_reason` 只允许 `synthetic_request_rejected` / `failed_request_rejected`。
- shape-slot `rejected_observation` 的合法配对必须固定为：
  - `source_kind="synthetic_request"` 只允许与 `rejection_reason="synthetic_request_rejected"` 组合
  - `source_kind="page_request"` 只允许与 `rejection_reason="failed_request_rejected"` 组合
- route-bucket `incompatible_observation` 必须显式携带 `shape`、`shape_key`、`source_kind="page_request"`、`incompatibility_reason="shape_mismatch"` 与 success-only `request_status`；synthetic / failed / non-2xx candidate 不得进入 incompatible bucket。
- 以上 observation 中的 `shape` / `shape_key` 必须始终绑定到单一 canonical request-shape variant，不得退化成未约束的自由结构。
- route bucket 的 `available_shape_keys` 仍必须覆盖 rejected-only sibling shape；即使当前没有 success-only `incompatible_observation`，lookup 也必须能继续得出 `shape_mismatch` 的 fail-closed 结论。

## 4. Gate rule

`#508 / FR-0027` 只把 replacement implementation gate 冻结为“仍 blocked”。

replacement implementation 只有在 `#502/#504/#505/#508` formal freeze 全部完成，且 detail capture-side canonical `note_id` derivation 已由 `#510` 或其受控替代 formal owner 冻结后，才允许进入 implementation-ready 状态。
