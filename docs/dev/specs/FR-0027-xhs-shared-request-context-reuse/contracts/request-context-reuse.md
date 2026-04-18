# FR-0027 契约：XHS Shared Request-Context Reuse

## 1. Slotting identity

```ts
type RequestContextSlotIdV1 = {
  page_context_namespace: string;
  route_scope: {
    command: "xhs.search" | "xhs.detail" | "xhs.user_home";
    method: "POST" | "GET";
    pathname: string;
  };
  shape_key: string;
};
```

约束：

- `shape_key` 只能来自 canonical shape 的稳定序列化。
- `page_context_namespace` 必须是 page-local / document-local namespace token，不得退化成 command-family 常量。
- 实际 shape slot identity 是 `page_context_namespace + route_scope + shape_key`；lookup 必须先选 route bucket，再在 bucket 内按 `shape_key` 命中。

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
- detail capture admission 只允许使用 canonical `note_id` 或当前 detail 页 referrer 恢复出的 `note_id`。
- `xhs.user_home` reuse-shape 最终只保留 canonical `user_id`。

## 3. Bucket state

```ts
type CapturedRequestContextShapeSlotV1 = {
  admitted_template: Record<string, unknown> | null;
  rejected_observation: Record<string, unknown> | null;
};

type CapturedRequestContextRouteBucketV1 = {
  page_context_namespace: RequestContextSlotIdV1["page_context_namespace"];
  route_scope: RequestContextSlotIdV1["route_scope"];
  incompatible_observation: Record<string, unknown> | null;
  available_shape_keys: string[];
};
```

约束：

- `admitted_template` 只承载 admitted page request。
- `rejected_observation` 只承载 synthetic / failed / rejected candidate。
- `incompatible_observation` 只承载同 namespace / 同 route bucket 下最近一次 sibling-shape mismatch candidate。
- `incompatible_observation` 不得进入 shape-keyed slot。

## 4. Gate rule

replacement implementation 只有在 `#503/#504/#505/#508` formal freeze 全部完成后，才允许进入 implementation-ready 状态。
