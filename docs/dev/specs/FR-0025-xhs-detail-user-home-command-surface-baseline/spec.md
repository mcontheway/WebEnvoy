# FR-0025 冻结 XHS Detail / User Home Command Surface 与 Request-Context 基线

Canonical Issue: #504

## 背景

`#503 / FR-0024` 已把 `xhs.search` 的 request-shape truth 冻结为 search-only formal contract，并明确把 `xhs.detail` / `xhs.user_home` 以及 `xhs.detail.image_scenes` 移出当前 scope，转交 `#504/#505`。

当前仓库存在一个已经影响 blocker 收口的 formal/implementation 冲突：

- current main 的实现与测试已经把 `xhs.detail` / `xhs.user_home` 作为公共 CLI command surface 对外暴露。
- `FR-0005` 的既有 fixed-sample 文本曾把 `detail/user_home` 缺失公开 CLI 命令入口记录为 `evidence_head_sha=eca28babebe929821aa20fbb113b2f94d6ce4f49` 的 dated historical fact；在本 FR 之前，这段历史表述还没有被明确与 current main command surface 口径对齐。
- 如果不先冻结“当前正式命令面已经存在、且这两个命令如何消费 `FR-0023` 四对象输入”的正式基线，后续 `#500` 的实现 PR、latest-main rerun 与 `#445` closeout 仍会在 command surface 是否存在、request-context baseline 是否允许被引用之间反复摇摆。

因此，本 FR 的职责不是继续讨论 search request-shape，也不是提前冻结 detail identity，而是先把 current main 已存在的 detail/user_home command surface 与 request-context baseline 收成 formal contract，作为后续实现和 closeout 的稳定上游输入。

## 目标

1. 冻结 `xhs.detail` 与 `xhs.user_home` 已属于 current main 公共 CLI command surface 的正式结论。
2. 冻结两个命令的 caller-facing `ability` envelope、canonical command input、canonical shared-path ability metadata 对齐边界、target-page baseline 与 public CLI request-context baseline。
3. 冻结两个命令如何消费 `FR-0023` 的 `action_request/resource_binding/authorization_grant/runtime_target` 四个顶层对象。
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

- `FR-0005` 中关于 “detail/user_home 尚无公开 CLI 命令入口” 的表述，只能继续保留为 `evidence_head_sha=eca28babebe929821aa20fbb113b2f94d6ce4f49` 的 dated historical fact，不再作为 current main command-surface truth。
- 本 FR 连同同 PR 中对 `FR-0005` 的最小 backwrite，一起冻结 `#504` 的 current command surface / request-context baseline；这不会单独改判 `FR-0005`、`#445` 的 live evidence blocker 或 closeout 语义。

### 2. caller-facing ability envelope 与 canonical command input

系统必须冻结以下 caller-facing `ability` envelope、canonical command input 与 current canonical shared-path ability metadata 对齐边界：

- `xhs.detail`
  - command: `xhs.detail`
  - required input: `note_id`
- `xhs.user_home`
  - command: `xhs.user_home`
  - required input: `user_id`

约束：

- current public CLI request 仍必须显式携带 `ability.id`、`ability.layer`、`ability.action` 组成的 `ability` envelope。
- current legacy public CLI path 只把 `ability.layer` / `ability.action` 冻结为“字段存在且枚举合法”的 caller-facing envelope；本 FR 不得把 non-`L3/read` 误写成 current parser 的通用硬阻断。
- canonical top-level `FR-0023` object path 与 current shared runtime / contract output metadata 继续把两条命令对齐到 `L3/read` read-command family。
- canonical top-level `FR-0023` object path 下，`ability.id` 必须显式对齐到命令对应的 canonical ability：`xhs.detail -> xhs.note.detail.v1`、`xhs.user_home -> xhs.user.home.v1`。
- canonical top-level `FR-0023` object path 下，`ability.action` 必须与 upstream `action_request.action_category=read` 对齐；本 FR 不得把非 read `ability.action` 冻结为该 caller path 的合法输入。
- `note_id` 与 `user_id` 都必须是必填、非空、去首尾空白后的字符串。
- 这两个命令不消费 `query`、`limit`、`search_id`、`sort`、`note_type` 这一类 search-only 输入。
- current top-level `FR-0023` object path 与 current bundled runtime / contract outputs 继续把两条命令分别对齐到 canonical ability metadata：`xhs.detail -> xhs.note.detail.v1`、`xhs.user_home -> xhs.user.home.v1`。
- legacy public CLI path 当前仍按 command + input 进入 shared parser；但非 canonical `ability.id` 的 legacy 行为不属于 current public CLI formal guarantee，本 FR 不把该类输入申报为受支持契约。
- 本 FR 只冻结 command input，不冻结 detail request identity 的附加字段。

### 3. target-page 与 public CLI request-context baseline

系统必须冻结以下 target-page 与 request-context baseline：

- legacy public CLI path
  - `xhs.detail` 的 current target-page baseline 是 `explore_detail_tab`
  - `xhs.user_home` 的 current target-page baseline 是 `profile_tab`
  - shared gate fields `target_domain`、`target_tab_id`、`target_page`、`requested_execution_mode` 都必须显式提供
- canonical top-level `FR-0023` object path
  - `xhs.detail` 的 current target-page baseline 继续由 `runtime_target.page = "explore_detail_tab"` 承载
  - `xhs.user_home` 的 current target-page baseline 继续由 `runtime_target.page = "profile_tab"` 承载
  - `target_domain`、`target_tab_id`、`target_page` 继续从 `runtime_target` 派生，`requested_execution_mode` 继续由 current parser 行为推导

约束：

- 在 legacy public CLI path 中，上述 shared gate fields 缺失时必须按 invalid args 处理。
- 在 canonical top-level `FR-0023` object path 中，`target_domain`、`target_tab_id`、`target_page` 必须继续由 `runtime_target` 派生，`requested_execution_mode` 必须继续由 current parser 行为推导；本 FR 不得把这些派生字段重新外显为第二套必填输入。
- current parser 继续把 `action_request`、`resource_binding`、`authorization_grant`、`runtime_target` 这四个顶层对象作为 canonical ownership truth 处理。
- 归一化后的 `options.upstream_authorization_request` 继续保留为 current command/runtime payload 中的兼容 mirror 与现有调用路径；本 FR 不得把它降格为 internal-only，但也不得把它写成可替代四个顶层对象 ownership truth 的独立 formal object family。
- `target_domain` 仍是 legacy public CLI path 的必填 shared gate field；当前 parser 只要求其为非空字符串，本 FR 不把它额外收紧为新的固定域常量。
- `xhs.detail` 在 target-page 不为 `explore_detail_tab` 时，必须按 invalid-args / blocked 输入处理。
- `xhs.user_home` 在 target-page 不为 `profile_tab` 时，必须按 invalid-args / blocked 输入处理。
- `requested_execution_mode` 必须继续对齐 current CLI parser 接受面与后续 gate/runtime 校验链路；本 FR 不把它预先收紧为 read-only allowlist，也不另起一套模式定义。
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

### 5. FR-0023 四个顶层对象输入 ownership

系统必须冻结：当 canonical top-level `FR-0023` object path 存在时，`xhs.detail` 与 `xhs.user_home` 的 command-level ownership 继续消费 `FR-0023` 已冻结的四个外部对象：

1. `action_request`
2. `resource_binding`
3. `authorization_grant`
4. `runtime_target`

约束：

- 这两个命令在 canonical top-level path 下不得新增第二套上游授权输入。
- 这四个对象在 current canonical ownership truth 中必须保持顶层对象语义。
- canonical top-level path 下，`ability.id` 必须继续命中 `XHS_COMMAND_ACTION_NAMES` 中该命令对应的 canonical shared-path ability，不能放宽为任意非空字符串。
- canonical top-level path 下，`ability.action` 必须继续与 `action_request.action_category` 投影出的 read-side ability action 对齐；不匹配时必须按 invalid args / command mismatch 处理。
- 嵌套 `options.upstream_authorization_request` 继续保留为 current command/runtime payload 的兼容 mirror 与现有调用路径；本 FR 不得把它降格为 internal-only。
- 本 FR 也不得把该 nested mirror 写成可替代四个顶层对象 ownership truth 的独立 formal object family。
- `action_request.action_name` 必须分别与 `xhs.read_note_detail`、`xhs.read_user_home` 对齐。
- `runtime_target.page` 必须分别与 `explore_detail_tab`、`profile_tab` 对齐。
- `resource_binding` 与 `authorization_grant` 的校验继续复用 `FR-0023` 已冻结的匿名 / profile-session 边界。
- legacy public CLI path 仍是 current command-level input model 的一部分；本 FR 不把四对象 path 误写成唯一输入模型。
- 本 FR 只冻结 canonical top-level path 的 command-level ownership，不改写 `FR-0023` 对四对象的 schema 定义。

### 6. request-level results ownership

系统必须冻结以下 command-level 结果 ownership：

- `request_admission_result` 与 `execution_audit` 是这两个命令当前共享的 canonical request-level output slot。
- 当 current implementation 产出 `request_admission_result` 或 `execution_audit` 时：
  - 它们必须进入 summary 或 error details
  - current compatibility behavior 中的对象 / 显式 `null` / 缺失三种结果形态都必须继续保持可表达
  - `execution_audit` 不得泄露到 `observability`
- 当命令消费 canonical top-level `FR-0023` object path 或其 nested compatibility mirror 时：
  - `request_admission_result` 与 `execution_audit` 的结构、要求与兼容性继续完全遵循 `FR-0023`
  - 本 FR 只冻结 command-level ownership 与 summary / error details 的位置约束，不得借此放宽 `FR-0023` 已冻结的结果边界
- legacy path 下的结果兼容行为不构成本 FR 放宽 `FR-0023` 结果契约的依据
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

Given 调用方提供 canonical top-level `FR-0023` 四个对象
When 系统处理 `xhs.detail` 或 `xhs.user_home`
Then `target_domain`、`target_tab_id`、`target_page` 必须继续由 `runtime_target` 派生
And `requested_execution_mode` 必须继续由 current parser 行为推导
And 本 FR 不得要求调用方再额外提供一套 legacy gate fields

### 场景 10A：canonical upstream path 必须命中 canonical ability id

Given 调用方提供 canonical top-level `FR-0023` 四个对象
When `xhs.detail` 的 `ability.id` 不是 `xhs.note.detail.v1`，或 `xhs.user_home` 的 `ability.id` 不是 `xhs.user.home.v1`
Then 系统必须把该输入视为 invalid args / command mismatch
And 本 FR 不得把任意非空 `ability.id` 冻结为 canonical caller path 的合法输入

### 场景 10B：canonical upstream path 的 ability.action 必须与 read action 对齐

Given 调用方提供 canonical top-level `FR-0023` 四个对象
When `ability.action` 不等于 upstream `action_request.action_category` 投影出的 read-side ability action
Then 系统必须把该输入视为 invalid args / command mismatch
And 本 FR 不得把非 read `ability.action` 冻结为该 caller path 的合法输入

### 场景 11：legacy path 不得把非 canonical ability 输入误报为公共契约

Given 调用方通过 legacy public CLI path 发起 `xhs.detail` 或 `xhs.user_home`
And 输入已满足当前 command input 与 shared gate fields 基线
When `ability.id` 不是 canonical shared-path ability id 但仍为非空字符串
Then 本 FR 不得把该输入申报为 current public CLI 的受支持契约
And 只能把 canonical ability 对齐冻结为 canonical top-level path 与 current shared runtime 输出 metadata

### 场景 12：legacy path 不得把 non-L3/read ability 误写成通用硬阻断

Given 调用方通过 legacy public CLI path 发起 `xhs.detail` 或 `xhs.user_home`
And 输入已满足当前 command input 与 shared gate fields 基线
When `ability.layer` / `ability.action` 为枚举合法值但不等于 `L3/read`
Then 本 FR 不得把该输入误写成 current parser 的通用硬阻断
And 只能把 `L3/read` 冻结为 canonical top-level path 与 current shared runtime 输出 metadata 的对齐边界

### 场景 13：canonical upstream objects 被命令面消费后保留 FR-0023 请求级结果边界

Given 调用方为 `xhs.detail` 或 `xhs.user_home` 提供 canonical top-level `FR-0023` 四个对象
When 命令完成 summary 或 error details 映射
Then `request_admission_result` 与 `execution_audit` 必须继续遵循 `FR-0023` 已冻结的请求级结果契约
And 命令面必须保留 canonical slot / 位置约束
And current compatibility behavior 中的显式 `null` 不得被 formal 收窄为非法结果
And `execution_audit` 不得出现在 `observability`
And 本 FR 不得借此放宽 `FR-0023` 对 admission / audit 结果的要求

### 场景 14：保留嵌套 upstream_authorization_request 兼容调用路径

Given current command/runtime payload 已包含嵌套 `options.upstream_authorization_request`
When 本 FR 冻结 command-level ownership 与 canonical upstream baseline
Then 本 FR 不得把该 nested path 降格为 internal-only
And 该 nested path 仍必须被视为 current command/runtime payload 的兼容 mirror 与现有调用路径
And canonical ownership truth 仍必须以四个顶层对象为准

### 场景 15：#505 之前不得把 image_scenes 写成 detail identity

Given `#504` 只冻结 command surface 与 request-context baseline
When 后续实现 PR 消费本 FR
Then 不得据此把 `image_scenes`、`CRD_PRV_WEBP` 或 media-scene 字段写成 detail identity
And 必须等待 `#505` 的正式结论

## 异常与边界场景

- `xhs.detail` 缺失 `note_id` 时，必须在命令入口层失败，不得发出空 detail 请求。
- `xhs.user_home` 缺失 `user_id` 时，必须在命令入口层失败，不得发出空 profile 请求。
- legacy public CLI path 下，`target_domain`、`target_tab_id`、`target_page`、`requested_execution_mode` 这组 shared gate fields 任一缺失时，都必须返回结构化 invalid-args 结果。
- canonical top-level `FR-0023` object path 下，shared gate fields 必须继续从 `runtime_target` 和 current parser 行为派生，而不是重新要求一套 legacy 外显输入。
- legacy path 下 `ability.layer` / `ability.action` 只冻结为 caller-facing envelope 存在性与枚举合法性，不得被 formal 误写成 current parser 对 `L3/read` 的通用硬阻断。
- 嵌套 `options.upstream_authorization_request` 兼容路径继续保留，但不得被写成可替代四个顶层对象 ownership truth 的独立 formal object family。
- background/extension direct path 若存在内部 auto target-tab resolution，不得被本 FR 误写为 current public CLI contract。
- legacy path 的结果兼容行为不得被拿来放宽 `FR-0023` 已冻结的请求级结果边界。
- `request_admission_result` / `execution_audit` 在 current compatibility behavior 中可显式为 `null`；formal 不得把该结果形态收窄为非法。
- 本 PR 已完成 `FR-0005` 中 command-surface 旧口径的最小 formal 对齐；本 FR 仍不在这里提前收口 `#445` 的 live blocker 或 closeout 语义。

## 验收标准

1. `xhs.detail` / `xhs.user_home` 已被正式冻结为 current public CLI command surface。
2. 两个命令的 caller-facing `ability` envelope 与 canonical command input 已冻结为 current public CLI baseline，且 `L3/read` 只被收口为 canonical shared-path metadata 对齐边界，而不是 legacy path 的通用硬阻断。
3. 两个命令的 target-page baseline 已冻结为 `explore_detail_tab` / `profile_tab`，且 public CLI request-context 仍要求显式 shared gate fields。
4. 两个命令消费 `FR-0023` 四个顶层对象输入的 command-level ownership 已冻结，且不新增第二套授权输入，同时保留了 nested `options.upstream_authorization_request` 兼容调用路径。
5. `request_admission_result` 与 `execution_audit` 的 canonical output slot / 位置约束已冻结，且本 FR 未放宽 `FR-0023` 已冻结的结果边界。
6. 本 FR 已显式把 detail identity 与 `image_scenes` 转交 `#505`。
7. formal 套件足以作为 `#504` 的单一上游基线；本 PR 只完成 command-surface formal 对齐，不提前收口 `#445` 的 live blocker 或 closeout。

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
