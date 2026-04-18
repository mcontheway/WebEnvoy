# FR-0025 契约：XHS Detail / User Home Command Surface Baseline

## 1. Public commands

```ts
type XhsDetailCommand = {
  command: "xhs.detail";
  ability: {
    id: "xhs.note.detail.v1";
    layer: "L3";
    action: "read";
  };
  input: {
    note_id: string;
  };
};

type XhsUserHomeCommand = {
  command: "xhs.user_home";
  ability: {
    id: "xhs.user.home.v1";
    layer: "L3";
    action: "read";
  };
  input: {
    user_id: string;
  };
};
```

约束：

- 两条命令都属于 current public CLI command surface。
- 两条命令都 `requiresProfile=true`。
- `note_id` / `user_id` 都必须为必填、trim 后非空的字符串。

## 2. Target baseline

```ts
type XhsDetailTargetBaseline = {
  target_page: "explore_detail_tab";
};

type XhsUserHomeTargetBaseline = {
  target_page: "profile_tab";
};
```

约束：

- `xhs.detail` 只允许 `explore_detail_tab`
- `xhs.user_home` 只允许 `profile_tab`
- `target_tab_id` 可为空；为空时允许按 current baseline 执行 auto target-tab pinning

## 3. FR-0023 ownership

两条命令只消费以下 canonical upstream input：

```ts
type CanonicalUpstreamAuthorizationRequest = {
  action_request: unknown;
  resource_binding: unknown;
  authorization_grant: unknown;
  runtime_target: unknown;
};
```

约束：

- `xhs.detail` 对应 `action_request.action_name = "xhs.read_note_detail"`
- `xhs.user_home` 对应 `action_request.action_name = "xhs.read_user_home"`
- `runtime_target.page` 必须分别与 `explore_detail_tab` / `profile_tab` 对齐
- 不允许新增第二套授权输入

## 4. Request-level result ownership

```ts
type CommandLevelSummary = {
  request_admission_result?: Record<string, unknown> | null;
  execution_audit?: Record<string, unknown> | null;
};
```

约束：

- canonical upstream input 存在时，`request_admission_result` / `execution_audit` 必须保留在 summary 或 error details
- `execution_audit` 不得进入 `observability`
- legacy path 下允许二者为 `null`

## 5. Deferred scope

以下内容不属于本契约：

- `xhs.detail` canonical identity
- `image_scenes`
- `CRD_PRV_WEBP`
- detail/user_home request-shape truth

这些内容全部转交 `#505` 或后续实现 FR。
