# FR-0025 冻结 XHS Detail / User Home Command Surface 与 Request-Context 基线

Canonical Issue: #504

## 背景

`#503 / FR-0024` 已把 `xhs.search` 的 request-shape truth 冻结为 search-only formal contract，并明确把 `xhs.detail` / `xhs.user_home` 以及 `xhs.detail.image_scenes` 移出当前 scope，转交 `#504/#505`。

当前仓库存在一个已经影响 blocker 收口的 formal/implementation 冲突：

- current main 的实现与测试已经把 `xhs.detail` / `xhs.user_home` 作为公共 CLI command surface 对外暴露。
- `FR-0005` 的历史 fixed sample 仍把“detail/user_home 尚无公开 CLI 命令入口”写成 dated historical fact。
- 如果不先冻结“当前正式命令面已经存在、且这两个命令如何消费 `FR-0023` 四对象输入”的正式基线，后续 `#500` 的实现 PR、latest-main rerun 与 `#445` closeout 仍会在 command surface 是否存在、request-context baseline 是否允许被引用之间反复摇摆。

因此，本 FR 的职责不是继续讨论 search request-shape，也不是提前冻结 detail identity，而是先把 current main 已存在的 detail/user_home command surface 与 request-context baseline 收成 formal contract，作为后续实现和 closeout 的稳定上游输入。

## 目标

1. 冻结 `xhs.detail` 与 `xhs.user_home` 已属于 current main 公共 CLI command surface 的正式结论。
2. 冻结两个命令的 canonical command input、target-page baseline 与 public CLI request-context baseline。
3. 冻结两个命令如何消费 `FR-0023` 的 `action_request/resource_binding/authorization_grant/runtime_target` 四对象。
4. 冻结 `request_admission_result` 与 `execution_audit` 在这两个命令上的 command-level ownership，并与 current implementation 对齐。
5. 显式声明 detail identity 不在本 FR 冻结，`image_scenes` 继续转交 `#505`。

## 非目标

- 不在本 FR 内修改 runtime、extension、CLI 或测试实现代码。
- 不在本 FR 内冻结 `xhs.detail` canonical identity。
- 不在本 FR 内冻结 `image_scenes`、`CRD_PRV_WEBP` 或其他 media-scene 字段是否进入 shape。
- 不在本 FR 内新增新的 public CLI 命令、参数或 API surface。
- 不在本 FR 内改写 `FR-0023` 的四对象契约，也不新增第二套授权输入。
- 不在本 FR 内推进 `#489/#500` 的实现修复、`#445` closeout、latest-main rerun 或 live evidence。

## 功能需求

### 1. current public command surface

系统必须冻结以下 current main 事实：

- `xhs.detail` 是 current main 的公共 CLI command。
- `xhs.user_home` 是 current main 的公共 CLI command。
- 两条命令都属于 XHS read command surface，且 `requiresProfile=true`。

本 FR 必须明确：

- `FR-0005` 中“detail/user_home 尚无公开 CLI 命令入口”的描述只属于 dated historical fact，不再构成 current baseline。
- 后续实现 PR、rerun 与 closeout 不得再把“缺少公开命令面”当成 current blocker。

### 2. canonical command input

系统必须冻结以下 canonical command input：

- `xhs.detail`
  - command: `xhs.detail`
  - ability id: `xhs.note.detail.v1`
  - required input: `note_id`
- `xhs.user_home`
  - command: `xhs.user_home`
  - ability id: `xhs.user.home.v1`
  - required input: `user_id`

约束：

- `note_id` 与 `user_id` 都必须是必填、非空、去首尾空白后的字符串。
- 这两个命令不消费 `query`、`limit`、`search_id`、`sort`、`note_type` 这一类 search-only 输入。
- 本 FR 只冻结 command input，不冻结 detail request identity 的附加字段。

### 3. target-page 与 public CLI request-context baseline

系统必须冻结以下 target-page baseline：

- `xhs.detail` 的 current target-page baseline 是 `explore_detail_tab`
- `xhs.user_home` 的 current target-page baseline 是 `profile_tab`

约束：

- 在 legacy public CLI path 中，shared gate fields `target_domain`、`target_tab_id`、`target_page`、`requested_execution_mode` 都必须显式提供；缺失时必须按 invalid args 处理。
- 在 canonical `upstream_authorization_request` path 中，`target_domain`、`target_tab_id`、`target_page` 必须继续由 `runtime_target` 派生，`requested_execution_mode` 必须继续由 current parser 行为推导；本 FR 不得把这些派生字段重新外显为第二套必填输入。
- `target_domain` 仍是 legacy public CLI path 的必填 shared gate field；当前 parser 只要求其为非空字符串，本 FR 不把它额外收紧为新的固定域常量。
- `xhs.detail` 在 target-page 不为 `explore_detail_tab` 时，必须按 invalid-args / blocked 输入处理。
- `xhs.user_home` 在 target-page 不为 `profile_tab` 时，必须按 invalid-args / blocked 输入处理。
- `requested_execution_mode` 必须继续对齐 current CLI 支持的 XHS read execution modes，不得在本 FR 中被放宽或另起一套模式定义。
- current background/extension direct path 中可能存在基于页面语义的内部 target-tab resolution，但该行为尚未进入 current public CLI 输入契约，不属于本 FR 冻结范围。
- 本 FR 冻结的是 public CLI request-context baseline，而不是 background/extension 内部自动选 tab 行为。

### 4. unified read execution path baseline

系统必须冻结以下 current implementation baseline：

- `xhs.detail` 与 `xhs.user_home` 都走 current unified XHS read execution path。
- 这条 unified path 当前承接 read-side request admission、execution audit、bridge forwarding、page-context request 和 fallback diagnostics。
- 本 FR 冻结的是“二者属于同一 read execution family”，不是二者的 canonical request-shape truth。

补充约束：

- detail/user_home 的 request-context baseline 允许后续实现复用 `FR-0024` 的 shared model，但不得在本 FR 中隐含冻结 detail identity。
- 本 FR 只冻结“这两个命令进入同一 read family”的 command-level ownership，identity 和 shape 仍以后续 FR 为准。

### 5. FR-0023 四对象输入 ownership

系统必须冻结：`xhs.detail` 与 `xhs.user_home` 的 command-level ownership 只消费 `FR-0023` 已冻结的四个外部对象：

1. `action_request`
2. `resource_binding`
3. `authorization_grant`
4. `runtime_target`

约束：

- 这两个命令不得新增第二套上游授权输入。
- `action_request.action_name` 必须分别与 `xhs.read_note_detail`、`xhs.read_user_home` 对齐。
- `runtime_target.page` 必须分别与 `explore_detail_tab`、`profile_tab` 对齐。
- `resource_binding` 与 `authorization_grant` 的校验继续复用 `FR-0023` 已冻结的匿名 / profile-session 边界。
- 本 FR 只冻结 command-level ownership，不改写 `FR-0023` 对四对象的 schema 定义。

### 6. request-level results ownership

系统必须冻结以下 command-level 结果 ownership：

- `request_admission_result` 与 `execution_audit` 是这两个命令当前共享的 canonical request-level output slot。
- 当 current implementation 产出 `request_admission_result` 或 `execution_audit` 时：
  - 它们必须进入 summary 或 error details
  - `execution_audit` 不得泄露到 `observability`
- 当 canonical `upstream_authorization_request` 缺失时：
  - current implementation 允许 legacy path 下的 `request_admission_result` / `execution_audit` 为 `null`
- 当 canonical `upstream_authorization_request` 存在时：
  - current implementation 仍可能让 `execution_audit` 保持 `null` 或缺席；本 FR 不把“必然产出 execution_audit”写成 formal truth
- 上述兼容性都不改变两个命令已经属于公共 command surface 的正式结论

补充约束：

- `request_admission_result` 与 `execution_audit` 仍是请求级结果，不上升为长期资源状态真相源。
- 两个命令不得自行发明新的 audit / admission 名称或位置。

### 7. 与 #505 的边界

本 FR 必须显式声明：

- `xhs.detail` 的 canonical identity 不在本 FR 冻结。
- `image_scenes` / `CRD_PRV_WEBP` / media-scene 类字段是否进入 identity，全部转交 `#505`。
- 后续实现 PR 不得以“`#504` 已经冻结 request-context baseline”为由，擅自把 `image_scenes` 写入 detail identity。

## GWT 验收场景

### 场景 1：detail 是 current public command surface

Given current main 已注册 `xhs.detail`
When 调用方以 `xhs.detail` 命令发起请求
Then 系统必须把它视为 current public CLI command
And 不得再按“缺失公开命令面”处理

### 场景 2：user_home 是 current public command surface

Given current main 已注册 `xhs.user_home`
When 调用方以 `xhs.user_home` 命令发起请求
Then 系统必须把它视为 current public CLI command
And 不得再按“缺失公开命令面”处理

### 场景 3：detail 必须携带 note_id

Given 调用方发起 `xhs.detail`
When 输入缺少 `note_id`
Then 系统必须返回 invalid args
And 不得继续进入 bridge forwarding

### 场景 4：user_home 必须携带 user_id

Given 调用方发起 `xhs.user_home`
When 输入缺少 `user_id`
Then 系统必须返回 invalid args
And 不得继续进入 bridge forwarding

### 场景 5：detail 的 target-page baseline 是 explore_detail_tab

Given 调用方发起 `xhs.detail`
When `runtime_target.page` 或 legacy `target_page` 不等于 `explore_detail_tab`
Then 系统必须返回 blocked 或 invalid args
And 不得把该请求落到其他 page baseline

### 场景 6：user_home 的 target-page baseline 是 profile_tab

Given 调用方发起 `xhs.user_home`
When `runtime_target.page` 或 legacy `target_page` 不等于 `profile_tab`
Then 系统必须返回 blocked 或 invalid args
And 不得把该请求落到其他 page baseline

### 场景 7：detail 缺失 target_tab_id 时不能被冻结为公共 CLI 合法输入

Given 调用方发起 `xhs.detail`
When `target_tab_id` 缺失
Then public CLI contract 必须把该输入视为 invalid args
And 本 FR 不得把内部 auto pinning 写成公共 CLI 基线

### 场景 8：user_home 缺失 target_tab_id 时不能被冻结为公共 CLI 合法输入

Given 调用方发起 `xhs.user_home`
When `target_tab_id` 缺失
Then public CLI contract 必须把该输入视为 invalid args
And 本 FR 不得把内部 auto pinning 写成公共 CLI 基线

### 场景 9：legacy public CLI 缺失 shared gate fields 时不能被冻结为合法输入

Given 调用方通过 legacy public CLI path 发起 `xhs.detail` 或 `xhs.user_home`
When `target_domain` 或 `requested_execution_mode` 缺失
Then public CLI contract 必须把该输入视为 invalid args
And 本 FR 不得把缺失 shared gate fields 的输入冻结为合法 request-context baseline

### 场景 10：canonical upstream path 继续从 runtime_target 派生 gate fields

Given 调用方提供 canonical `upstream_authorization_request`
When 系统处理 `xhs.detail` 或 `xhs.user_home`
Then `target_domain`、`target_tab_id`、`target_page` 必须继续由 `runtime_target` 派生
And `requested_execution_mode` 必须继续由 current parser 行为推导
And 本 FR 不得要求调用方再额外提供一套 legacy gate fields

### 场景 11：canonical upstream objects 被命令面消费后保留请求级结果

Given 调用方为 `xhs.detail` 或 `xhs.user_home` 提供 canonical `upstream_authorization_request`
When 命令完成 summary 或 error details 映射
Then 若 current implementation 产出了 `request_admission_result` 或 `execution_audit`，它们必须按 current implementation 保留在 canonical slot
And `execution_audit` 不得出现在 `observability`
And 本 FR 不把 `execution_audit` 的必然产出写成 formal truth

### 场景 12：#505 之前不得把 image_scenes 写成 detail identity

Given `#504` 只冻结 command surface 与 request-context baseline
When 后续实现 PR 消费本 FR
Then 不得据此把 `image_scenes`、`CRD_PRV_WEBP` 或 media-scene 字段写成 detail identity
And 必须等待 `#505` 的正式结论

## 异常与边界场景

- `xhs.detail` 缺失 `note_id` 时，必须在命令入口层失败，不得发出空 detail 请求。
- `xhs.user_home` 缺失 `user_id` 时，必须在命令入口层失败，不得发出空 profile 请求。
- legacy public CLI path 下，`target_domain`、`target_tab_id`、`target_page`、`requested_execution_mode` 这组 shared gate fields 任一缺失时，都必须返回结构化 invalid-args 结果。
- canonical upstream path 下，shared gate fields 必须继续从 `runtime_target` 和 current parser 行为派生，而不是重新要求一套 legacy 外显输入。
- background/extension direct path 若存在内部 auto target-tab resolution，不得被本 FR 误写为 current public CLI contract。
- legacy path 下允许 `request_admission_result` 与 `execution_audit` 为 `null`，但不得把 `null` 误解释为“命令面不存在”。
- canonical upstream path 下 `execution_audit` 仍可能为 `null`；这代表当前实现尚未为该场景产出 audit，不代表 command surface 缺失。
- 若当前 formal 文档仍引用“detail/user_home 尚无公开命令面”的历史表述，后续 closeout 必须按 dated historical fact 处理，不得回退为 current blocker。

## 验收标准

1. `xhs.detail` / `xhs.user_home` 已被正式冻结为 current public CLI command surface。
2. 两个命令的 canonical command input 已冻结为 `note_id` / `user_id`。
3. 两个命令的 target-page baseline 已冻结为 `explore_detail_tab` / `profile_tab`，且 public CLI request-context 仍要求显式 shared gate fields。
4. 两个命令消费 `FR-0023` 四对象输入的 command-level ownership 已冻结，且不新增第二套授权输入。
5. `request_admission_result` 与 `execution_audit` 的 canonical output slot / 位置约束已与 current implementation 对齐，而非强制每次都产出 audit。
6. 本 FR 已显式把 detail identity 与 `image_scenes` 转交 `#505`。
7. formal 套件足以支撑后续实现 PR 和 `#445` closeout 不再把“缺少公开命令面”当成 current blocker。

## 依赖与前置条件

- `vision.md`
- `docs/dev/roadmap.md`
- `docs/dev/architecture/system-design.md`
- `docs/dev/architecture/system-design/read-write.md`
- `docs/dev/architecture/system-design/communication.md`
- `docs/dev/specs/FR-0005-xhs-read-spike/spec.md`
- `docs/dev/specs/FR-0005-xhs-read-spike/research.md`
- `docs/dev/specs/FR-0005-xhs-read-spike/TODO.md`
- `docs/dev/specs/FR-0023-upstream-authorization-request-admission-contract/spec.md`
- `docs/dev/specs/FR-0024-xhs-request-shape-truth/spec.md`
- GitHub issues `#445`、`#500`、`#502`、`#504`、`#505`
