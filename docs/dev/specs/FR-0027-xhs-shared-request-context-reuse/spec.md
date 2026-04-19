# FR-0027 冻结 XHS Shared Request-Context Reuse Semantics

Canonical Issue: #508

## 背景

`#502 / FR-0024` 已冻结 `xhs.search` request-shape truth；`#504 / FR-0025` 已冻结 `xhs.detail / xhs.user_home` command surface 与 request-context baseline；`#505 / FR-0026` 负责把 `xhs.detail` canonical identity 收窄为 identity-only formal freeze。

但 replacement implementation 仍缺少一条独立 formal owner，去回答当前已经被代码、测试与 guardian 同时锁定的 shared reuse 语义：

- `shape_key` 如何成为稳定 request identity key
- `page_context_namespace + shape_key` 如何组成实际 slotting identity
- `admitted_template`、`rejected_observation`、`incompatible_observation` 的共享 bucket 行为
- synthetic / failed source 的准入边界
- exact-match / freshness / fail-closed 的复用门禁
- replacement implementation 在进入实现前还必须等待哪些 formal freeze

如果这些规则继续留给 implementation PR 自行决定，`#502/#504/#505` 的 formal truth、GitHub issue truth 与 replacement implementation gate 会再次分离。

## 目标

1. 冻结 XHS read family 的 shared request-context reuse model。
2. 冻结 page-local/document-local `page_context_namespace`、route bucket 与 `shape_key` 的 slotting 身份与 lookup 行为。
3. 冻结 admitted / rejected / incompatible 三类 observation 的共享边界。
4. 冻结 `xhs.detail` 与 `xhs.user_home` 在 reuse 模型里的 canonical shape。
5. 冻结 replacement implementation 的 formal gate：`#508` 只能冻结 shared reuse semantics，本身不会解除 implementation block；detail capture-side canonical `note_id` derivation 仍需等待独立 formal owner 冻结。

## 非目标

- 不在本 FR 内修改 runtime、extension、CLI 或测试实现代码。
- 不重开 `xhs.search` canonical shape；search-only shape 继续以 `FR-0024` 为准。
- 不重开 `xhs.detail` canonical identity；detail identity 继续以 `#505` 为准。
- 不改写 `FR-0025` 已冻结的 command surface、四对象输入 ownership 或 request-level results ownership。
- 不推进 `#489/#500` 的实现修复、`#445` closeout、latest-main rerun 或 live evidence。
- 不把 page-local request-context artifact 升格为跨 run / 跨页面 / 持久化 replay truth。

## 功能需求

### 1. shared request-shape truth ownership

系统必须冻结：`capture -> slotting -> lookup -> eligibility` 四个阶段共享同一套 canonical `RequestShape` / `shape_key` 规则。

约束：

- `xhs.search` 的 canonical shape 继续完全遵循 `FR-0024`，本 FR 不得重写 search-only 规则。
- `xhs.detail` 与 `xhs.user_home` 必须进入与 `xhs.search` 同构的 shared reuse model，而不是各自走独立启发式。
- `shape_key` 只能由 canonical shape 的稳定序列化生成，不得混入 raw body、header 顺序、trace 或 referrer。
- shared bucket state 中出现的 `shape` 只能实例化为 `FR-0024` 的 search `RequestShape`、本 FR 的 `XhsDetailReuseShapeV1` 或 `XhsUserHomeReuseShapeV1` 之一；`shape_key` 只能是对应 variant 的稳定序列化结果。
- 不允许在 capture、lookup 或 eligibility 阶段各自定义第二套“同一请求”规则。

### 2. canonical read-family shapes

系统必须冻结以下 read-family canonical shape：

- `xhs.detail`
  - `command`
  - `method`
  - `pathname`
  - `note_id`
- `xhs.user_home`
  - `command`
  - `method`
  - `pathname`
  - `user_id`

补充约束：

- `xhs.detail` 的 `note_id` 继续与 `#505` 的 identity-only formal freeze 对齐。
- `source_note_id`、`image_scenes`、headers、trace、referrer 不进入 `xhs.detail` `shape_key`。
- detail capture-side canonical `note_id` derivation 当前不在本 FR 冻结；该 formal owner 已转交 `#510 / FR-0028`。
- `xhs.user_home` 最终只保留 canonical `user_id`；`userId` 或 query `user_id` 只允许作为归一来源，不得并列进入 `shape_key`。
- `xhs.search` 的 `keyword/page/page_size/sort/note_type` 继续由 `FR-0024` 负责，不在本 FR 重新列举为新 truth。
- `research.md` 只记录当前仓库为什么还不能把 detail referrer / transport 推断升格为 formal truth；相关规则已转交 `#510` 并等待后续证据充分后另行修订。

### 3. page-local namespace 与 route bucket

系统必须冻结：`page_context_namespace` 是 page-local / document-local namespace token，而不是命令族枚举。

约束：

- `page_context_namespace` 必须至少隔离当前文档生命周期或等价页面现场。
- `page_context_namespace` 不得退化成仅有 `xhs.search` / `xhs.detail` / `xhs.user_home` 三个常量的 command-family 复用键。
- command family 与 route family 继续由 canonical shape 内的 `command/method/pathname` 表达，不由 `page_context_namespace` 代替。
- replacement implementation 必须先在当前 namespace 内选定 route bucket，再在 route bucket 内做 shape 级 lookup。

### 4. slotting identity

系统必须冻结：shared reuse 存在两层身份，不得混写成并行 slot 公式：

- route bucket identity：`page_context_namespace + route_scope`
- shape slot identity：`page_context_namespace + shape_key`

约束：

- 不同 namespace 即使 `shape_key` 相同，也不得共享同一 shape slot。
- 同一 namespace 内必须先按 route family 分桶，再在 route bucket 内按 canonical `shape_key` 分 shape slot。
- `route_scope` 是 route bucket 选择前置，不得被表述成与 `shape_key` 并列的第二套 shape slot identity；route family 已包含在 canonical shape 与 `shape_key` 中。
- shape slot 只允许承载 `admitted_template` 与 `rejected_observation`。
- `incompatible_observation` 必须挂在当前 namespace 的 route bucket 层，用来记录 sibling-shape lookup 产生的最近不兼容候选；不得错误放入 shape-keyed slot。
- replacement implementation 不得回退到裸 `path`、裸 `shape_key` 或 command-only slotting。

### 5. bucket state model

系统必须冻结 route bucket / shape slot 允许承载以下状态与最小结构字段：

- shape slot
  - `admitted_template`
  - `rejected_observation`
- route bucket
  - `incompatible_observation`

约束：

- `admitted_template` 只代表可复用的 page-local admitted template。
- `rejected_observation` 只代表最近一次被 capture admission 拒绝、但 shape 已可识别的 candidate。
- `incompatible_observation` 只代表同 namespace、同 route family 但 canonical shape 不一致的最近候选。
- 任何 synthetic / failed source 都不得进入 `admitted_template`。
- `admitted_template` 至少必须携带 `captured_at`，作为 freshness gate 的时间输入。
- `admitted_template` 至少必须携带 `request_status.completion="completed"` 与非空 2xx `request_status.http_status`，不得把 failed / non-2xx candidate 误记为 admitted template。
- `rejected_observation` 与 `incompatible_observation` 至少必须携带 `observed_at`，且其 `shape` / `shape_key` 必须绑定到本 FR 允许的 canonical request-shape variants。
- shape-slot `rejected_observation` 至少必须携带 `shape`、`shape_key`、`source_kind`、非空 machine-readable `rejection_reason` 与 `request_status`，以支持 rejected-source 语义。
- route-bucket `incompatible_observation` 至少必须携带 `shape`、`shape_key`、`source_kind="page_request"`、`incompatibility_reason="shape_mismatch"` 与 success-only `request_status`，以支持 sibling-shape 诊断。
- `shape` 与 `shape_key` 不得写成未约束的自由结构；它们必须始终绑定到单一 canonical request-shape variant 及其稳定序列化结果。
- route bucket 必须保留 `available_shape_keys`，以支持 sibling-shape incompatibility 诊断。

### 6. capture admission

系统必须冻结 admitted template 的共享准入规则：

1. 来源是页面真实请求
2. 不是 WebEnvoy synthetic request
3. 能导出合法 canonical shape
4. 请求成功完成
5. HTTP 状态属于 2xx

因此：

- synthetic request 只能进入 `rejected_observation`
- failed / non-2xx request 只能进入 `rejected_observation`
- capture admission 拒绝不得被等价成 template hit
- rejected observation 也必须按当前 `page_context_namespace + shape_key` 分槽
- detail capture-side canonical `note_id` derivation 当前不在本 FR 冻结；admitted detail capture path 必须等待 `#510`
- shape-slot `rejected_observation` 必须携带非空 `rejection_reason`；当前 v1 仅允许 `synthetic_request_rejected` 或 `failed_request_rejected`
- shape-slot `rejected_observation` 的合法配对必须固定为：
  - `source_kind="synthetic_request"` 只允许 `rejection_reason="synthetic_request_rejected"`
  - `source_kind="page_request"` 只允许 `rejection_reason="failed_request_rejected"`
- route-bucket `incompatible_observation` 必须携带 `incompatibility_reason=shape_mismatch`
- synthetic / failed / non-2xx candidate 不得写入 route-bucket `incompatible_observation`
- route bucket 的 `available_shape_keys` 仍必须保留 rejected-only sibling shape；即使当前没有 success-only `incompatible_observation`，lookup 也必须继续得出 `shape_mismatch` 的 fail-closed 结果

### 7. lookup / eligibility / fail-closed

系统必须冻结以下共享 lookup 与 eligibility 规则：

- lookup 只允许在当前 namespace 内进行
- lookup 必须先定位当前 namespace 的 route bucket，再在 bucket 内执行 shape 级 exact-match
- eligibility 只允许 exact shape match
- exact match 后仍必须通过 freshness gate
- miss、mismatch、stale、rejected_source 都必须 fail closed

合法结果类型：

- `hit`
- `miss`
- `incompatible`
- `stale`
- `rejected_source`

最小 miss reason：

- `template_missing`
- `shape_mismatch`
- `template_stale`
- `synthetic_request_rejected`
- `failed_request_rejected`

补充约束：

- 不允许 silent synthetic fallback。
- 不允许“部分字段命中后局部复用、其余字段重算”的混合路径。
- `request_context_missing` / `request_context_incompatible` 的结构化诊断必须继续保留 machine-readable reason。
- 当 route bucket 只存在 failed / synthetic / non-2xx sibling shape 时，lookup 必须返回 `miss(reason="shape_mismatch")` 并继续映射到 `request_context_incompatible`；不得伪造 success-only `incompatible_observation`，也不得把该路径压扁成 `template_missing`

### 8. replacement implementation formal gate

系统必须冻结：`#508 / FR-0027` 只负责把 successor implementation gate 标记为“仍 blocked”，而不是直接宣告 implementation-ready。

replacement `#501` successor 只有在以下 formal 输入全部冻结后，才可能进入 implementation-ready 状态：

1. `#502 / FR-0024`
2. `#504 / FR-0025`
3. `#505 / FR-0026`
4. `#508 / FR-0027`
5. `#510 / FR-0028` 或其后续受控替代 formal owner，用于冻结 detail capture-side canonical `note_id` derivation

在上述 formal freeze 完成前：

- replacement implementation PR 不得被视为 implementation-ready
- 不得以“`#508` 已完成 formal freeze”为由跳过 detail capture-side derivation formal 缺口
- 不得以“formal 未明确禁止”为由在实现 PR 中自定 admitted detail capture path
- `#501` 不得继续作为当前收口主线

## GWT 验收场景

### 场景 1：detail 与 user_home 必须进入 shared slotting model

Given 当前系统同时支持 `xhs.search`、`xhs.detail`、`xhs.user_home`
When request-context reuse 发生
Then 三条命令都必须先进入 page-local/document-local `page_context_namespace`
And 再通过当前 namespace 内的 route bucket + `shape_key` 进行 slotting
And `xhs.detail` / `xhs.user_home` 不得回退到 command-only 或 path-only slotting

### 场景 2：detail canonical shape 只保留 note_id

Given 当前请求是 `xhs.detail`
When 系统生成 canonical shape
Then shape 必须只包含 `command/method/pathname/note_id`
And `source_note_id` 与 `image_scenes` 不得进入 `shape_key`
And detail capture admission 当前 formal 只允许承认 canonical `note_id`

### 场景 3：user_home canonical shape 只保留 user_id

Given 当前请求是 `xhs.user_home`
When 系统生成 canonical shape
Then shape 必须只包含 `command/method/pathname/user_id`
And `userId` 或 query `user_id` 只能作为归一来源

### 场景 4：synthetic request 只能进入 rejected observation

Given WebEnvoy 发出一条 synthetic XHS read request
When capture admission 观察到该请求
Then 它必须进入 `rejected_observation`
And 不得进入 `admitted_template`

### 场景 5：shape mismatch 必须 fail closed

Given 当前 namespace 下存在同 route family 但不同 canonical shape 的候选记录
When 系统执行 lookup / eligibility
Then 结果必须是 `incompatible`
And `request_context_miss_reason` 必须保留 `shape_mismatch`
And 不得继续进入 synthetic fallback
And 最近不兼容候选必须记录在 route bucket 层，而不是当前 shape slot

### 场景 5A：rejected-only sibling shape 也必须保留 `shape_mismatch`

Given 当前 namespace 下不存在 exact shape template
And 当前 shape slot 下也不存在 `rejected_observation`
And 当前 route bucket 只存在 failed / synthetic / non-2xx sibling shape
When 系统执行 lookup / eligibility
Then 结果必须继续 fail closed
And `request_context_miss_reason` 必须保留 `shape_mismatch`
And 不得伪造 success-only `incompatible_observation`
And 不得把该路径压扁成 `template_missing`

### 场景 6：replacement implementation 不能只靠 #508 进入实现

Given `#502/#504/#505/#508` 已完成 formal freeze
And detail capture-side canonical `note_id` derivation 仍未由 `#510` 或其受控替代 formal owner 冻结
When reviewer 检查 replacement implementation PR 是否可进入实现
Then 该 PR 仍不得被视为 implementation-ready
And 不得宣称 formal 输入已经齐备
And `#508` 只能被解释为“shared reuse semantics 已冻结，但 gate 仍 blocked”

## 异常与边界场景

- `xhs.search` 的 search-only shape 仍以后 `FR-0024` 为准；本 FR 不得与其冲突。
- `xhs.detail` canonical identity 仍以 `#505` 为准；本 FR 只冻结其 reuse-shape 与 slotting 语义，不冻结 capture-side derivation source。
- detail referrer / transport 推断当前仍证据不足；capture-side canonical `note_id` derivation 已转交 `#510`，在其 formal freeze 完成前不得被写成 admitted canonical derivation truth。
- `xhs.user_home` canonical shape 不得被误写成 `body.userId` 与 `query user_id` 并列双主键。
- shape 命中但模板过旧时，结果必须是 `stale`，而不是 `hit`。
- rejected observation 允许保留最近一次可诊断 candidate，但不得升级为 admitted template。
- `incompatible_observation` 必须停留在 route bucket 层，不得被错误塞回 shape-keyed slot。
- shape-slot `rejected_observation` 的 `rejection_reason` 不得为 `null` 或缺失。
- `rejected_observation` 与 `incompatible_observation` 都必须显式保留各自候选的 `shape` 与 `shape_key` 锚点。

## 验收标准

1. `xhs.detail` / `xhs.user_home` 已进入与 `xhs.search` 同构的 shared request-context reuse model。
2. page-local/document-local `page_context_namespace`、route bucket 与 `shape_key` 的层级关系已冻结。
3. admitted / rejected / incompatible 三类 bucket 状态及其 freshness / rejected-source 所需最小结构字段已冻结，且 incompatible observation 位于 route bucket 层，synthetic / failed source 不进入 admitted template，admitted template 仅承载 completed 2xx 成功态。
4. detail/user_home 的 canonical shape 已冻结为 `note_id` / `user_id` only，且 detail capture-side canonical `note_id` derivation 继续由 `#510` 保持 deferred。
5. exact-match / freshness / fail-closed 的共享 reuse 规则已冻结。
6. replacement implementation 的 formal gate 已明确包含 `#508` 且继续 blocked，直到 detail capture-side derivation formal owner（当前为 `#510`）完成。

## 依赖与前置条件

- `vision.md`
- `docs/dev/roadmap.md`
- `docs/dev/architecture/system-design.md`
- `docs/dev/architecture/system-design/read-write.md`
- `docs/dev/specs/FR-0024-xhs-request-shape-truth/spec.md`
- `docs/dev/specs/FR-0025-xhs-detail-user-home-command-surface-baseline/spec.md`
- `docs/dev/specs/FR-0026-xhs-detail-canonical-identity/spec.md`
- `docs/dev/specs/FR-0027-xhs-shared-request-context-reuse/research.md`
- GitHub issue `#502`
- GitHub issue `#504`
- GitHub issue `#505`
- GitHub issue `#508`
