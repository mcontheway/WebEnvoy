# FR-0025 契约：XHS Detail / User Home Command Surface Baseline

## 1. Public commands

```ts
type XhsDetailCommand = {
  command: "xhs.detail";
  canonical_shared_path_ability_id: "xhs.note.detail.v1";
  input: {
    note_id: string;
  };
};

type XhsUserHomeCommand = {
  command: "xhs.user_home";
  canonical_shared_path_ability_id: "xhs.user.home.v1";
  input: {
    user_id: string;
  };
};
```

约束：

- 两条命令都属于 current public CLI command surface。
- 两条命令都 `requiresProfile=true`。
- `note_id` / `user_id` 都必须为必填、trim 后非空的字符串。
- canonical `upstream_authorization_request` path 与 current runtime / contract output path 继续分别对齐 `xhs.note.detail.v1` / `xhs.user.home.v1`。
- legacy public CLI path 当前不因 ability id 偏离上述 canonical 值而单独形成 formal rejection；本契约不预先冻结更严格的 ability-mismatch 阻断。

## 2. Target baseline

```ts
type LegacyXhsDetailTargetBaseline = {
  target_page: "explore_detail_tab";
  target_domain: string;
  target_tab_id: number;
  requested_execution_mode: string;
};

type LegacyXhsUserHomeTargetBaseline = {
  target_page: "profile_tab";
  target_domain: string;
  target_tab_id: number;
  requested_execution_mode: string;
};

type CanonicalXhsDetailTargetBaseline = {
  runtime_target: {
    domain: string;
    tab_id: number;
    page: "explore_detail_tab";
  };
  derived_requested_execution_mode: string;
};

type CanonicalXhsUserHomeTargetBaseline = {
  runtime_target: {
    domain: string;
    tab_id: number;
    page: "profile_tab";
  };
  derived_requested_execution_mode: string;
};
```

约束：

- `xhs.detail` 只允许 `explore_detail_tab`
- `xhs.user_home` 只允许 `profile_tab`
- legacy public CLI contract 下，`target_domain`、`target_tab_id`、`target_page`、`requested_execution_mode` 这组 shared gate fields 都必须显式提供
- `target_domain` 在 current parser truth 下仍只要求非空字符串
- `requested_execution_mode` 继续对齐 current CLI 支持的 XHS read execution modes
- canonical `upstream_authorization_request` path 下，`target_domain`、`target_tab_id`、`target_page` 继续从 `runtime_target` 派生，`requested_execution_mode` 继续由 current parser 行为推导
- background/extension direct path 的内部 target-tab resolution 不属于本契约冻结范围

## 3. FR-0023 ownership

当 canonical `upstream_authorization_request` 存在时，两条命令继续消费以下 canonical upstream input：

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
- canonical upstream path 不允许新增第二套授权输入
- legacy public CLI path 仍是 current command-level input model 的一部分，不因本契约而被废弃

## 4. Request-level result ownership

```ts
type CommandLevelSummary = {
  request_admission_result?: Record<string, unknown> | null;
  execution_audit?: Record<string, unknown> | null;
};
```

约束：

- `request_admission_result` / `execution_audit` 是 canonical request-level output slot
- 当 current implementation 产出这两个字段时，它们必须保留在 summary 或 error details
- `execution_audit` 不得进入 `observability`
- legacy path 下允许二者为 `null`
- canonical upstream path 下，`execution_audit` 仍允许保持 `null` 或缺席

## 5. Deferred scope

以下内容不属于本契约：

- `xhs.detail` canonical identity
- `image_scenes`
- `CRD_PRV_WEBP`
- detail/user_home request-shape truth

这些内容全部转交 `#505` 或后续实现 FR。
