# FR-0024 统一 XHS Request-Shape Truth

Canonical Issue: #502

## 背景

`#445` 当前仍是 closeout-only 事项，不能再承载实现修复；`#489` 与 `#500` 仍是其 live request-context blocker。围绕这两个 blocker 的实现尝试已经在 `#501` 上持续推进过多轮补丁，但 guardian 的多轮驳回呈现出同一条主线事实：

- 当前 XHS live read request-context 路径没有单一的“同一请求”真相源。
- `capture -> cache key -> lookup -> eligibility` 四个阶段对“什么叫同一请求”的判断并不一致。
- 结果不是单点缺陷，而是系统模型分裂导致的连续副作用：cross-shape overwrite、false miss、stale reuse、synthetic fallback 回流到已知高风险路径。

`#501` 已经覆盖了多项局部修复，包括：

- 不再只按 `method + pathname` 作用域缓存模板
- search 不再复用不同 query 的 `search_id`
- WebEnvoy 自己发出的 MAIN-world fetch 不再污染模板缓存
- stale page state 不再覆盖 canonical 默认值
- 非成功完成的页面请求不得进入缓存
- detail 不再把 canonical body 与过期模板字段整包混用

但 guardian 最新一轮结论仍然指向同一个根问题：对于 `xhs.search`，keyword 相同但 `page`、`page_size`、`sort`、`note_type` 不同的常见场景，系统依然没有一套贯穿四个阶段的统一 request-shape truth。只要 exact template miss 之后又静默回退到 synthetic path，`GATEWAY_INVOKER_FAILED` 风险就会重新回到闭环路径里。

因此，本 FR 的职责不是继续补单点条件分支，而是把 XHS read path 的 request-shape truth 冻结为 formal contract，作为后续新实现 PR 的唯一正式输入。

## 目标

1. 冻结一套单一的 request-shape truth，贯穿 `capture -> cache key -> lookup -> eligibility`。
2. 冻结 `xhs.search`、`xhs.detail`、`xhs.user_home` 的 canonical request identity，消除 false overwrite 与 false miss。
3. 冻结 template 何时可捕获、何时可复用、何时必须拒绝执行的正式规则。
4. 冻结 exact template miss 的 fail-closed 规则，禁止静默 synthetic fallback。
5. 明确 page-local captured template 与 `FR-0018` replay/store truth 的 ownership 边界，避免第二真相源。

## 非目标

- 不在本 FR 内修改 runtime、extension、CLI 或命令实现代码。
- 不在本 FR 内新增 public CLI/API 命令面或改变用户输入契约。
- 不做跨平台抽象；当前只覆盖 XHS read path。
- 不把 page-local captured template 升格为持久化 replay/store truth。
- 不在本 FR 内承诺 explicit reacquire 流程；如后续需要，必须独立立项并重新过 spec review。
- 不推进 `#445` closeout、live rerun、guardian rerun 或 `#489/#500` 关闭。
- 不继续在 `#501` 上叠加实现补丁；后续实现必须使用新的实现 PR。

## 功能需求

### 1. 单一 derivation truth

系统必须冻结一个共享的 `deriveRequestShape()` 内部 derivation 结果，作为以下四个阶段的唯一 truth：

1. capture admission
2. cache key generation
3. template lookup
4. replay eligibility

约束：

- 不允许各阶段分别定义自己的“同一请求”规则。
- `RequestShape` 必须从 canonical command input 与真实页面请求共同可推导的字段产生，而不是从临时 header、trace 或页面局部状态猜测。
- `xhs.search` 的默认值必须在 derive 阶段被显式归一，不能由 stale page state、旧模板字段或 fallback 分支隐式补入。

### 2. canonical request identity

系统必须冻结以下内部 `RequestShape` 边界：

- 公共字段：`command`、`method`、`pathname`
- `xhs.search`：`keyword`、`page`、`page_size`、`sort`、`note_type`
- `xhs.detail`：`source_note_id`、`image_scenes`
- `xhs.user_home`：`user_id`

附加约束：

- `xhs.search` 的 canonical identity 不包含 `search_id`、`X-S-Common`、trace headers 或 referrer。
- `xhs.detail` 的 canonical identity 必须显式包含 `image_scenes`，避免旧 body 变体在同一 `note_id` 下被误复用。
- `xhs.user_home` 当前 canonical identity 只包含 `user_id`；若后续接口出现新的正式 query 语义，必须通过后续 spec review 扩展，不得由实现自行补字段。
- `headers`、`referrer`、`trace`、`search_id` 属于“shape 命中后的可复用上下文字段”，不是 identity。

### 3. cache key 与 stable serialization

系统必须冻结 `RequestShapeKey`，并要求它只能由 `RequestShape` 的稳定序列化产生。

约束：

- `RequestShapeKey` 是 capture、cache、lookup 的唯一键。
- 稳定序列化只能消费 `RequestShape`，不得把 raw body、header 顺序、query 排列、referrer 或 trace 直接混入 key。
- 相同 `RequestShape` 必须产生相同 key；不同 `RequestShape` 必须产生不同 key。
- shape key 的生成规则一旦冻结，后续实现不得在 lookup 或 eligibility 阶段绕过它改走 path-scope、query-only scope 或其他局部启发式。

### 4. captured template 的准入规则

系统必须冻结 `CapturedRequestTemplateRecord` 的 capture admission 规则。

只有同时满足以下条件的请求，才允许进入 request-template cache：

1. 来源是页面真实请求，而不是 WebEnvoy 自己发出的 synthetic request
2. 能导出合法 `RequestShape`
3. 请求成功完成
4. 响应状态属于 2xx

因此：

- WebEnvoy 发出的 MAIN-world fetch 必须被识别为 `synthetic_request_rejected`
- 失败请求、超时请求、中断请求、非 2xx 请求必须被识别为 `failed_request_rejected`
- 不允许把“抓到过请求”直接等价成“可复用模板”

### 5. lookup 与 eligibility 规则

系统必须冻结以下 template 复用规则：

- lookup 只允许基于 `RequestShapeKey`
- eligibility 只允许 `exact shape match`
- exact match 之后仍必须通过 freshness gate
- 不存在“模糊匹配后局部复用”

结果类型只允许：

- `hit`
- `miss`
- `incompatible`
- `stale`
- `rejected_source`

至少必须区分以下 miss reason：

- `template_missing`
- `shape_mismatch`
- `template_stale`
- `synthetic_request_rejected`
- `failed_request_rejected`

补充约束：

- `lookup` 与 `eligibility` 必须消费同一份 `RequestShape`
- 任何 shape mismatch 都不得继续进入“部分字段沿用、其余字段重算”的混合路径
- `detail` 不允许再把旧 body 整包摊平到当前请求上；只能在 exact hit 后复用经过 shape 约束的 canonical template fields

### 6. fail-closed miss 规则

exact template 不存在、模板 stale、shape mismatch 或来源被拒绝时，系统必须 fail closed。

正式约束如下：

- 不得静默回退到已知高风险的 synthetic request path
- 必须返回结构化 `request_context_missing` 或 `request_context_incompatible` 结果
- 该结构化结果可以映射到既有错误外壳，但 machine-readable diagnostics 必须保留 miss reason
- explicit reacquire 不在本 FR 内承诺；没有 exact template 时，当前正式行为就是拒绝执行

### 7. freshness 与生命周期

freshness 从本 FR 起进入正式规则：

- 命中 shape 但超过 freshness window 的模板，必须返回 `stale`
- stale template 不得复用，即使它与当前 shape 完全一致
- freshness gate 的存在是正式契约；具体窗口值属于后续实现配置，但 lookup 与 eligibility 必须共享同一 freshness policy

### 8. 与 FR-0018 的 ownership 边界

`CapturedRequestTemplateRecord` 明确是 page-local runtime artifact，不是 `FR-0018` 意义上的 replay/store truth。

约束：

- 不得把 page-local request template 持久化为 replay input snapshot
- 不得把 `CapturedRequestTemplateRecord` 当作跨 run、跨 page、跨 profile 的正式可回放输入
- `shape` / `shape_key` 是 request-context 复用的内部真相源，不替代 `FR-0018` 的 replay-store 归属

## GWT 验收场景

### 场景 1：同关键词不同页码不得共用 search context

Given 当前请求是 `xhs.search(keyword=AI, page=1, page_size=20, sort=general, note_type=0)`
And 页面历史上捕获过 `xhs.search(keyword=AI, page=7, page_size=20, sort=general, note_type=0)` 模板
When 系统执行 lookup 与 eligibility
Then 结果必须是 `request_context_incompatible`
And 不得复用该模板
And 不得静默回退到 synthetic path

### 场景 2：同关键词不同 `page_size` 不得共用 search context

Given 当前请求与已捕获模板只在 `page_size` 上不同
When 系统执行 lookup 与 eligibility
Then 结果必须是 `request_context_incompatible`
And 不能把旧模板里的 `search_id`、headers 或 referrer 当成可继续复用的上下文

### 场景 3：同关键词不同 `sort` 不得共用 search context

Given 当前请求与已捕获模板只在 `sort` 上不同
When 系统执行 lookup 与 eligibility
Then 结果必须是 `request_context_incompatible`
And 不得继续复用旧模板

### 场景 4：同关键词不同 `note_type` 不得共用 search context

Given 当前请求与已捕获模板只在 `note_type` 上不同
When 系统执行 lookup 与 eligibility
Then 结果必须是 `request_context_incompatible`
And 不得回退到 synthetic fallback

### 场景 5：shape 全匹配时允许复用真实页面上下文

Given 已存在与当前 `xhs.search` 请求完全一致且未过期的 `CapturedRequestTemplateRecord`
When 系统执行 lookup 与 eligibility
Then 结果必须是 `hit`
And 允许复用 template headers、template body、referrer 与 trace 上下文字段
And `search_id` 只能在 exact shape hit 后作为上下文字段复用

### 场景 6：detail 的 `image_scenes` 变体不兼容时必须拒绝

Given 当前请求是 `xhs.detail(source_note_id=note-001, image_scenes=[CRD_PRV_WEBP])`
And 页面历史上只捕获过 `xhs.detail(source_note_id=note-001, image_scenes=[WB_PRV])`
When 系统执行 lookup 与 eligibility
Then 结果必须是 `request_context_incompatible`
And 不得把旧 body 的其他字段整包混入当前请求

### 场景 7：user_home 只按 `user_id` 建立 canonical identity

Given 当前请求是 `xhs.user_home(user_id=user-001)`
And 已捕获模板的 query、header 或 referrer 与当前页面不同，但 `user_id` 完全一致
When 系统执行 lookup 与 eligibility
Then shape 仍可判定为 exact match
And query/header/referrer 只在 exact hit 后作为上下文字段复用

### 场景 8：synthetic request 不得进入模板池

Given WebEnvoy 为执行 live read 主动发出一条 MAIN-world synthetic request
When request-context capture 观察到该请求
Then 该请求必须被标记为 `synthetic_request_rejected`
And 不得写入 request-template cache

### 场景 9：失败请求不得进入模板池

Given 页面发出一条真实 XHS 请求，但请求失败、中断或返回非 2xx
When capture admission 处理该请求
Then 该请求必须被标记为 `failed_request_rejected`
And 不得写入 request-template cache

### 场景 10：shape 命中但模板过旧时必须 fail closed

Given 已捕获模板与当前请求 shape 完全一致
And 该模板已超过 freshness window
When 系统执行 lookup 与 eligibility
Then 结果必须是 `request_context_missing`
And miss reason 必须是 `template_stale`
And 不得继续复用该模板

## 异常与边界场景

- 若某条真实页面请求无法导出合法 `RequestShape`，必须拒绝缓存，不能退回 path-only scope。
- 若 `CapturedRequestTemplateRecord.shape` 与 `template_body/query` 重新导出的 shape 不一致，必须返回 `incompatible`，不得继续复用。
- 若后续平台接口新增影响 identity 的正式字段，实现不得直接扩 shape；必须先过新的 spec review。
- 若当前命令输入缺少构造 `RequestShape` 的必填字段，必须在命令输入校验阶段阻断，而不是让 request-context 层兜底猜值。
- 若 `xhs.search` 省略分页/排序参数，derive 阶段必须输出 canonical 默认值，避免 page-local state 污染 identity。

## 验收标准

1. reviewer 可以仅根据 formal suite 判断三条命令的 canonical identity、template 生命周期与 fail-closed 规则，而不需要继续围绕 guardian finding 逐条补洞。
2. `capture -> cache key -> lookup -> eligibility` 四个阶段的 truth source 已被明确冻结为同一份 `RequestShape` / `RequestShapeKey`。
3. `xhs.search`、`xhs.detail`、`xhs.user_home` 的 exact match / mismatch / stale / rejected_source 行为已具备正式 GWT 覆盖。
4. formal suite 已明确 page-local artifact 与 `FR-0018` replay truth 的边界，不留下第二真相源。
5. spec review 通过前，任何实现 PR 都不得声称 `#489/#500` 已解决或 `#445` 已具备 credible Go。

## 依赖与前置条件

- canonical blocker issue 已固定为 `#502`
- `#489`、`#500` 在实现 PR 合并并完成 latest-main live rerun 前继续保持 open
- `#445` 继续保持 closeout-only
- `#501` 作为既有实现尝试与 review 证据来源保留，但后续实现必须另开新 PR，不再在其上叠补丁
