# FR-0024 统一 XHS Request-Shape Truth（Search Only）

Canonical Issue: #502

## 背景

`#445` 当前仍是 closeout-only 事项，不能承载实现修复；`#489` 与 `#500` 仍是其 live request-context blocker。围绕这两个 blocker 的实现尝试已经在 `#501` 上持续推进过多轮补丁，但 guardian 的多轮驳回稳定暴露出同一条主线事实：

- 当前 XHS live read request-context 路径没有单一的“同一请求”真相源。
- `capture -> cache key -> lookup -> eligibility` 四个阶段对“什么叫同一请求”的判断并不一致。
- 结果不是单点缺陷，而是系统模型分裂导致的连续副作用：cross-shape overwrite、false miss、stale reuse、synthetic fallback 回流到已知高风险路径。

guardian 最新稳定阻断的主线集中在 `xhs.search`：keyword 相同但 `page`、`page_size`、`sort`、`note_type` 不同的常见场景下，系统依然没有一套贯穿四个阶段的统一 request-shape truth。只要 exact template miss 之后又静默回退到 synthetic path，`GATEWAY_INVOKER_FAILED` 风险就会重新回到闭环路径里。

因此，本 FR 当前版本的职责仍然是把仓库已有公开基线支撑的 `xhs.search` request-shape truth 维持为 formal contract；当前这轮 `#512` maintenance 只补 search-side compatibility/backwrite，使 `FR-0024` 与 `#509 / FR-0027` 需要的 shared reuse contract 不再冲突，但不把本 FR 扩写成 shared owner。

## 目标

1. 冻结一套单一的 `xhs.search` request-shape truth，贯穿 `capture -> cache key -> lookup -> eligibility`。
2. 冻结 `xhs.search` 的 canonical request identity，消除 false overwrite 与 false miss。
3. 冻结 template 何时可捕获、何时可复用、何时必须拒绝执行的正式规则。
4. 冻结 exact template miss 的 fail-closed 规则，禁止静默 synthetic fallback。
5. 明确 page-local captured template 与 `FR-0018` replay/store truth 的 ownership 边界，避免第二真相源。
6. 以 search-only backwrite 方式补齐 observation schema compatibility，不新增 shared request-context owner。

## 非目标

- 不在本 FR 内修改 runtime、extension、CLI 或命令实现代码。
- 不在本 FR 内新增 public CLI/API 命令面或改变用户输入契约。
- 不做跨平台抽象；当前只覆盖 XHS read path。
- 不把 page-local captured template 升格为持久化 replay/store truth。
- 不在本 FR 内承诺 explicit reacquire 流程；如后续需要，必须独立立项并重新过 spec review。
- 不推进 `#445` closeout、live rerun、guardian rerun 或 `#489/#500` 关闭。
- 不继续在 `#501` 上叠加实现补丁；后续实现必须使用新的实现 PR。
- 不在本 FR 内冻结 `xhs.detail` / `xhs.user_home` 的 command surface、request-context baseline 或 canonical identity。
- 不在本 FR 内冻结 `xhs.detail.image_scenes` 是否进入 canonical shape；该问题转入 `#505`。
- 不在本 FR 内拥有 shared request-context reuse semantics owner；该 formal owner 继续属于 `#508 / FR-0027`。
- 不在本 FR 内承接 detail rejected-source defer/freeze 或 `#510` derivation truth。

## Deferred Scope

以下事项已明确移出本 FR，不允许继续以隐含前提混入 `FR-0024`：

- `#504`：冻结 `xhs.detail` / `xhs.user_home` command surface 与 request-context 基线。
- `#505`：验证并冻结 `xhs.detail` canonical identity（含 `image_scenes` 是否入 shape）。

`#503` 合并只表示 `xhs.search` request-shape truth 已冻结，不表示 `xhs.detail` / `xhs.user_home` 或 `image_scenes` 问题已经完成。

## 功能需求

### 1. 单一 derivation truth

系统必须冻结一个共享的 `deriveRequestShape()` 内部 derivation 结果，作为以下四个阶段的唯一 truth：

1. capture admission
2. cache key generation
3. template lookup
4. replay eligibility

约束：

- 不允许各阶段分别定义自己的“同一请求”规则。
- 共享 truth 必须表现为同一套 `deriveRequestShape()` 归一逻辑；允许存在不同阶段的 derivation-source producer，但不允许存在第二套 shape 规则。
- capture 阶段必须先从当前候选 request artifact 自身构造 capture-side derivation source；这个 producer 不得依赖“某条命令已先发出”。
- lookup / eligibility 阶段必须从 canonical command input 与 page-local candidate evidence 构造 command-side derivation source。
- 上述两类 derivation source 最终都必须进入同一套 `deriveRequestShape()`，并产出同一个 `RequestShape` / `RequestShapeKey` 契约。
- 对 admitted template 而言，合法 artifact 仍然只允许是真实页面请求；synthetic request 只能用于 rejected observation 的 shape-level 诊断，不得借此放宽 template admission。
- `xhs.search` 的默认值必须在 derive 阶段被显式归一，不能由 stale page state、旧模板字段或 fallback 分支隐式补入。

### 2. canonical request identity

系统必须冻结以下内部 `RequestShape` 边界：

- 公共字段：`command`、`method`、`pathname`
- `xhs.search`：`keyword`、`page`、`page_size`、`sort`、`note_type`

附加约束：

- `xhs.search` 的 canonical identity 不包含 `search_id`、`X-S-Common`、trace headers 或 referrer。
- `xhs.search` 的 `note_type` 必须在进入 `RequestShape` 前归一为 canonical integer；同一语义不得同时以字符串与数字参与 key 序列化。
- `xhs.search.limit` 必须在 derive 阶段归一映射为 canonical `page_size`；不得让 `limit` 与 `page_size` 并存为两套输入口径。
- `headers`、`referrer`、`trace`、`search_id` 属于“shape 命中后的可复用上下文字段”，不是 identity。

### 3. cache key 与 stable serialization

系统必须冻结 `RequestShapeKey`，并要求它只能由 `RequestShape` 的稳定序列化产生。

约束：

- `RequestShapeKey` 是 canonical shape 的稳定键，但不是跨页面全局缓存身份。
- 稳定序列化只能消费 `RequestShape`，不得把 raw body、header 顺序、query 排列、referrer 或 trace 直接混入 key。
- 相同 `RequestShape` 必须产生相同 key；不同 `RequestShape` 必须产生不同 key。
- shape key 的生成规则一旦冻结，后续实现不得在 lookup 或 eligibility 阶段绕过它改走 path-scope、query-only scope 或其他局部启发式。
- 有效的缓存身份必须显式包含 page-local / document-local namespace；因此实现上的 store identity 必须是 `page_context_namespace + shape_key`。
- 不同页面现场即使拥有相同 `shape_key`，也不得共享模板 slot。

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
- 被 capture admission 拒绝的候选请求只允许进入 page-local rejected-attempt diagnostics，不允许进入 template cache
- admitted template record 的 canonical 类型不得保留任何 synthetic source kind
- synthetic request 在被拒绝时允许先走同一套 `deriveRequestShape()` 导出 `shape + shape_key`，但该导出结果只能写入 rejected-attempt diagnostics，不能提升为 admitted template
- rejected-attempt diagnostics 的有效存储身份也必须按 `page_context_namespace + shape_key` 分槽；不同 shape 的 rejected observation 不得互相覆盖

### 5. route-bucket incompatible diagnostics

系统必须冻结 search-side route-bucket compatibility truth，用于兼容 shared reuse contract，同时保持 `FR-0024` 仍是 search-only owner。

约束：

- `RouteBucketIncompatibleObservation` 只代表同 namespace、同 search route bucket 下最近一次 success-only sibling-shape mismatch 候选
- 它必须停留在 route-bucket 层，不得写入 `page_context_namespace + shape_key` 槽位
- 它只允许记录 `source_kind="page_request"` 的 success-only 2xx 候选
- failed / synthetic / non-2xx sibling shape 不得被伪造为 route-bucket incompatible observation
- 该 compatibility/backwrite 只用于让 search-side schema 与 shared contract 对齐，不表示本 FR 开始拥有跨命令 shared observation contract

### 6. lookup 与 eligibility 规则

系统必须冻结以下 template 复用规则：

- lookup 只允许在当前 page-local namespace 内进行
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
- `lookup` 必须先解析当前页面现场的同路由候选 bucket，再在 bucket 内按 `shape_key` / `shape` 判定 exact hit 与不兼容候选
- 任何 shape mismatch 都不得继续进入“部分字段沿用、其余字段重算”的混合路径
- `incompatible` 只允许来自 route-bucket 层的 success-only `RouteBucketIncompatibleObservation`
- `rejected_source` 只允许来自同 namespace、同 `shape_key` 槽位下最近一次被 capture admission 拒绝的 rejected-attempt observation
- `synthetic_request_rejected` 的 observation 必须通过同一套 `deriveRequestShape()` 从被拒绝的 synthetic request artifact 本身导出 `shape + shape_key`
- 当同路由 bucket 只存在 failed / synthetic / non-2xx sibling shape 时，lookup 必须返回 `miss(reason="shape_mismatch")`，并继续映射到 fail-closed 的 `request_context_incompatible`
- 不得为了返回 `incompatible` 而伪造 success-only route-bucket incompatible observation

### 7. fail-closed miss 规则

exact template 不存在、模板 stale、shape mismatch 或来源被拒绝时，系统必须 fail closed。

正式约束如下：

- 不得静默回退到已知高风险的 synthetic request path
- 必须返回结构化 `request_context_missing` 或 `request_context_incompatible` 结果
- 该结构化结果可以映射到既有错误外壳，但 machine-readable diagnostics 必须保留 miss reason
- `miss(reason="shape_mismatch")` 与 `incompatible(reason="shape_mismatch")` 都必须继续映射到 fail-closed 的 `request_context_incompatible`
- explicit reacquire 不在本 FR 内承诺；没有 exact template 时，当前正式行为就是拒绝执行

### 8. freshness 与生命周期

freshness 从本 FR 起进入正式规则：

- 命中 shape 但超过 freshness window 的模板，必须返回 `stale`
- stale template 不得复用，即使它与当前 shape 完全一致
- freshness gate 的存在是正式契约；具体窗口值属于后续实现配置，但 lookup 与 eligibility 必须共享同一 freshness policy

### 9. page-local namespace 与 rejected diagnostics

从本 FR 起，request-template cache 的 ownership 必须显式绑定到 page-local / document-local namespace。

约束：

- namespace 必须至少隔离当前文档生命周期或等价页面现场
- cache 覆盖规则必须发生在同一 namespace 内，不得跨页面覆盖
- rejected source 只允许保留为同 namespace 内的最近 rejected-attempt diagnostics，不得升级为可复用模板
- route-bucket incompatible diagnostics 只允许保留为同 namespace、同 search route bucket 的最近 success-only mismatch 观察，不得写回 shape slot

### 10. 与 FR-0018 的 ownership 边界

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

### 场景 5A：不同页面现场即使 shape 相同也不得共享模板 slot

Given 页面 A 与页面 B 都捕获到了相同 `RequestShapeKey` 的 XHS 请求
And 两者属于不同 page-local namespace
When 系统在页面 B 内执行 lookup
Then 只能读取页面 B 自己 namespace 内的候选 bucket
And 不得复用页面 A 的模板

### 场景 6：synthetic request 不得进入模板池

Given WebEnvoy 为执行 live read 主动发出一条 MAIN-world synthetic request
When request-context capture 观察到该请求
Then 该请求必须被标记为 `synthetic_request_rejected`
And 不得写入 request-template cache
And 只允许进入当前页面现场的 rejected-attempt diagnostics

### 场景 7：失败请求不得进入模板池

Given 页面发出一条真实 XHS 请求，但请求失败、中断或返回非 2xx
When capture admission 处理该请求
Then 该请求必须被标记为 `failed_request_rejected`
And 不得写入 request-template cache
And 只允许进入当前页面现场的 rejected-attempt diagnostics

### 场景 7A：没有可复用模板但当前 shape slot 最近一次候选被拒绝时返回 `rejected_source`

Given 当前 page-local namespace 内不存在可复用 template
And 当前页面现场与当前请求同 `shape_key` 槽位下最近一次候选请求被 capture admission 拒绝
When 系统执行 lookup
Then 结果必须是 `rejected_source`
And reason 必须是 `synthetic_request_rejected` 或 `failed_request_rejected`
And 不得把该 observation 当成 template record 继续复用
And 若 full shape 尚未成功导出，则该请求不得被记为 `synthetic_request_rejected`

### 场景 7B：synthetic reject 必须从被拒绝请求本身导出 shape

Given WebEnvoy 发出了一条禁止进入模板池的 synthetic request
And request-context capture 观察到了该 synthetic request 的完整 request artifact
When 系统记录 `synthetic_request_rejected`
Then `RejectedRequestContextObservation` 必须能从这条 synthetic request artifact 直接导出 `shape + shape_key`
And 不得产生无 shape 的 rejected observation

### 场景 7C：success-only sibling shape mismatch 必须落在 route bucket 层

Given 当前 page-local namespace 内不存在 exact shape template
And 当前 search route bucket 下存在 success-only 2xx 的 sibling-shape 候选
When 系统执行 lookup
Then 结果必须是 `request_context_incompatible`
And reason 必须保留 `shape_mismatch`
And 最近不兼容候选必须记录为 route-bucket `RouteBucketIncompatibleObservation`
And 不得把该 observation 写入 `page_context_namespace + shape_key` 槽位

### 场景 7D：rejected-only sibling shape 也必须保留 shape_mismatch

Given 当前 page-local namespace 内不存在 exact shape template
And 当前页面现场也不存在同 `shape_key` 的 rejected observation
And 当前 search route bucket 只存在 failed、synthetic 或 non-2xx sibling shape
When 系统执行 lookup
Then 结果必须是 `request_context_incompatible`
And miss reason 必须保留 `shape_mismatch`
And 不得伪造 success-only `RouteBucketIncompatibleObservation`
And 不得把该路径压扁成 `template_missing`

### 场景 8：shape 命中但模板过旧时必须 fail closed

Given 已捕获模板与当前请求 shape 完全一致
And 该模板已超过 freshness window
When 系统执行 lookup 与 eligibility
Then 结果必须是 `request_context_missing`
And miss reason 必须是 `template_stale`
And 不得继续复用该模板

### 场景 9：没有 exact template 时必须 fail closed

Given 当前请求在本页面现场不存在 exact template
And 当前页面现场也没有同 `shape_key` 的 rejected observation
And 当前 search route bucket 也不存在 success-only sibling-shape mismatch candidate
When 系统执行 lookup 与 eligibility
Then 结果必须是 `request_context_missing`
And miss reason 必须是 `template_missing`
And 不得静默回退到 synthetic request path

## 异常与边界场景

- 若 `xhs.search` 省略分页/排序参数，derive 阶段必须输出 canonical 默认值，避免 page-local state 污染 identity。
- 若 `xhs.search.note_type` 的输入形态是字符串，derive 阶段也必须先把它归一为 integer，再参与 `RequestShapeKey` 序列化。
- 若 `xhs.search.limit` 未被冻结为 `page_size` 的唯一 canonical 来源，实现会再次引入 `page_size` 来源歧义。
- 若某条真实页面请求无法导出合法 `RequestShape`，必须拒绝缓存，不能退回 path-only scope。
- 若某条 synthetic request 无法导出 full shape，则只能停在更早的 `miss` / `incompatible`，不能生成无 shape 的 rejected observation。
- 若 search route bucket 只有 rejected-only sibling shape，仍必须保留 `shape_mismatch` 的 fail-closed 结果，不能压扁为 `template_missing`。

## 验收标准

`FR-0024` 当前版本达成完成，必须同时满足：

1. reviewer 确认 `capture -> cache key -> lookup -> eligibility` 四个阶段的 truth source 已被明确冻结为同一份 `RequestShape` / `RequestShapeKey`。
2. `xhs.search` 的 exact match / mismatch / stale / rejected_source 行为已具备正式 GWT 覆盖，且这些结果都具备 shape-level 或 route-bucket-level 可实现的数据来源。
3. `xhs.detail` / `xhs.user_home` / `xhs.detail.image_scenes` 已被显式移出本 FR，并回链到 `#504` / `#505`，不存在隐含未决范围。
4. search-side observation schema 已通过 `#512` maintenance backwrite 与 shared reuse contract 对齐，但本 FR 的 owner 仍保持 search-only。
