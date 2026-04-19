# FR-0025 契约：XHS Detail / User Home Command Surface Baseline

## 1. Public commands

```ts
type CallerFacingAbilityEnvelope = {
  ability: {
    id: string;
    layer: "L3" | "L2" | "L1";
    action: "read" | "write" | "download";
  };
};

type XhsDetailCommand = {
  command: "xhs.detail";
  input: {
    note_id: string;
  };
};

type XhsUserHomeCommand = {
  command: "xhs.user_home";
  input: {
    user_id: string;
  };
};
```

约束：

- 两条命令都属于 current public CLI command surface。
- 两条命令都 `requiresProfile=true`。
- current public CLI request 仍必须显式携带 `ability.id`、`ability.layer`、`ability.action`。
- current legacy public CLI path 只把 `ability.layer` / `ability.action` 冻结为“字段存在且枚举合法”的 caller-facing envelope；本契约不得把 non-`L3/read` 误写成 current parser 的通用硬阻断。
- canonical top-level `FR-0023` object path 与 current runtime / contract output metadata 继续把两条命令对齐到 `L3/read` read-command family。
- canonical top-level `FR-0023` object path 下，`ability.id` 必须分别命中 `xhs.note.detail.v1` / `xhs.user.home.v1`。
- canonical top-level `FR-0023` object path 下，`ability.action` 必须与 upstream `action_request.action_category=read` 对齐。
- `note_id` / `user_id` 都必须为必填、trim 后非空的字符串。
- current top-level `FR-0023` object path 与 current runtime / contract output metadata 继续分别对齐 `xhs.note.detail.v1` / `xhs.user.home.v1`。
- legacy public CLI path 的非 canonical `ability.id` 行为不属于本契约冻结范围；本契约不把这类输入申报为受支持的公共 CLI 契约。

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

type CanonicalTopLevelFr0023TargetBaseline = {
  action_request: unknown;
  resource_binding: unknown;
  authorization_grant: unknown;
  runtime_target: {
    domain: string;
    tab_id: number;
    page: "explore_detail_tab" | "profile_tab";
  };
};
```

约束：

- `xhs.detail` 只允许 `explore_detail_tab`
- `xhs.user_home` 只允许 `profile_tab`
- legacy public CLI contract 下，`target_domain`、`target_tab_id`、`target_page`、`requested_execution_mode` 这组 shared gate fields 都必须显式提供
- `target_domain` 在 current parser truth 下仍只要求非空字符串
- `requested_execution_mode` 继续对齐 current CLI parser 接受面；若当前命令组合在后续 gate/runtime 校验中被拒绝，本契约按 existing rejection chain 处理，而不提前收窄为 read-only allowlist
- canonical top-level `FR-0023` object path 下，`target_domain`、`target_tab_id`、`target_page` 继续从 `runtime_target` 派生，`requested_execution_mode` 继续由 current parser 行为推导
- `requested_execution_mode` 仍是 current parser / runtime 内部派生语义，而不是 canonical top-level `FR-0023` object family 的新增正式字段
- 归一化后的 `options.upstream_authorization_request` 继续保留为 current command/runtime payload 的兼容 mirror 与现有调用路径
- 它不得被写成可替代四个顶层对象 ownership truth 的独立 formal object family
- background/extension direct path 的内部 target-tab resolution 不属于本契约冻结范围

## 3. FR-0023 top-level ownership

当 canonical top-level `FR-0023` object path 存在时，两条命令继续消费以下 canonical upstream input：

```ts
type CanonicalUpstreamAuthorizationRequest = {
  action_request: unknown;
  resource_binding: unknown;
  authorization_grant: unknown;
  runtime_target: unknown;
};
```

约束：

- 四个对象在 current caller-facing CLI baseline 中必须保持顶层输入形态
- canonical top-level path 下，`ability.id` 必须继续映射到命令对应的 canonical shared-path ability，而不能是任意非空字符串
- canonical top-level path 下，`ability.action` 必须继续与 `action_request.action_category` 投影出的 read-side ability action 对齐
- 嵌套 `options.upstream_authorization_request` 继续保留为 current command/runtime payload 的兼容 mirror 与现有调用路径
- 它不得被降格为 internal-only，也不得替代四个顶层对象 ownership truth
- `xhs.detail` 对应 `action_request.action_name = "xhs.read_note_detail"`
- `xhs.user_home` 对应 `action_request.action_name = "xhs.read_user_home"`
- `runtime_target.page` 必须分别与 `explore_detail_tab` / `profile_tab` 对齐
- canonical top-level path 不允许新增第二套授权输入
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
- 当命令消费 canonical top-level `FR-0023` object path 或 nested compatibility mirror 时，这两个字段必须继续遵循 `FR-0023` 已冻结的请求级结果契约
- 本契约只冻结它们在 summary 或 error details 的 canonical slot / 位置约束，并保留 current compatibility behavior 中对象 / 显式 `null` / 缺失三种结果形态
- `execution_audit` 不得进入 `observability`
- 本契约不得放宽 `FR-0023` 对 admission / audit 结果的要求

## 5. Deferred scope

以下内容不属于本契约：

- `xhs.detail` canonical identity
- `image_scenes`
- `CRD_PRV_WEBP`
- detail/user_home request-shape truth
- successor detail implementation path 的 shared request-context minimal invariants
- successor detail implementation path 的 detail capture-side canonical `note_id` derivation / admitted-derivation truth

其中 `xhs.detail` canonical identity baseline 由 `#505` 冻结；shared request-context minimal invariants 与 successor implementation shared gate 由 `#508` 承接；`#510` 继续只作为 successor detail implementation path 的 required detail-path gate 引用，本契约不在此重述其 owning suite scope。successor detail implementation path 必须先消费 `#504 + #505` merged baselines，再继续等待 `#508 + #510` 两条 open formal gate。
