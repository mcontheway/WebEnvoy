# FR-0024 数据模型边界

## 结论

本 FR 不新增 SQLite 表、迁移、索引或新的持久化真相源。它只冻结 XHS request-context 在运行时需要共享的数据对象与 lifecycle 边界，避免 page-local captured template 漂移成第二真相源。

本文件定义：

- 哪些对象属于 page-local runtime artifact
- 哪些字段是 canonical identity
- 哪些字段只是 exact hit 后可复用的上下文
- 这些对象何时创建、何时失效、何时不得持久化

本文件不定义：

- 新表
- 新迁移
- 新的 replay store
- 跨 run、跨 profile 的 request template 持久化

## 核心对象分层

### 1. canonical identity 对象

| 对象 | 角色 | 真相源要求 |
| --- | --- | --- |
| `RequestShape` | 单一 canonical identity | 当前事项的唯一 identity truth |
| `RequestShapeKey` | `RequestShape` 的稳定序列化 | 当前事项的唯一 cache / lookup key |

约束：

1. `RequestShape` / `RequestShapeKey` 是 request-context 复用的正式 truth。
2. `template_body`、`query`、`headers`、page state 都不能与它们并列成为第二套 identity truth。
3. 若后续实现需要新增 identity 字段，必须重新过 spec review。

### 2. page-local template artifact

| 对象 | 角色 | 持久化要求 |
| --- | --- | --- |
| `CapturedRequestTemplateRecord` | 当前页面现场可复用的 request template | 不得提升为新的持久化真相源 |
| `RejectedRequestContextObservation` | 当前页面现场最近一次被 capture admission 拒绝的候选观察 | 不得提升为可复用 template 或长期真相源 |

字段职责：

| 字段 | 角色 | 说明 |
| --- | --- | --- |
| `shape` | canonical identity snapshot | 由 capture / reject 评估时的 `deriveRequestShape()` 生成 |
| `shape_key` | cache / lookup 唯一键 | 由 `shape` 稳定序列化得到；其中 `note_type` 必须先归一为 integer |
| `page_context_namespace` | 页面现场命名空间 | 用于隔离不同文档生命周期、tab 或等价页面现场 |
| `template_headers` | exact hit 后可复用上下文 | 不参与 identity |
| `template_body` | exact hit 后可复用上下文 | 不得成为第二 identity truth |
| `referrer` | exact hit 后可复用上下文 | 不参与 identity |
| `captured_at` | freshness 判断输入 | 超过 freshness window 后必须判 stale |
| `source_kind` | 来源判定 | 必须能区分真实页面请求与 WebEnvoy synthetic request |
| `request_status` | 成功完成判定 | 只允许成功完成的 2xx 页面真实请求进入缓存 |

`RejectedRequestContextObservation` 字段职责：

| 字段 | 角色 | 说明 |
| --- | --- | --- |
| `page_context_namespace` | 页面现场命名空间 | 只在当前页面现场有效 |
| `shape` | shape-level 诊断锚点 | 记录 capture admission 拒绝时已导出的 canonical shape |
| `shape_key` | shape-level 诊断键 | 只允许与当前请求同 `shape_key` 的 observation 命中 |
| `rejection_reason` | 结构化拒绝原因 | 只允许 `synthetic_request_rejected` / `failed_request_rejected` |
| `observed_at` | 最近观测时间 | 用于返回最近一次 rejected-source 解释 |

### 3. lookup result 视图

| 对象 | 角色 | 持久化要求 |
| --- | --- | --- |
| `TemplateLookupResult` | 当前 lookup / eligibility 的结构化结果 | 当前不要求持久化为独立实体 |

约束：

1. `TemplateLookupResult` 只表达当前请求的 request-context 命中结果。
2. 它不应被提升为长期健康视图或 replay eligibility 视图。
3. 若实现需要写日志或诊断记录，必须明确它只是 run-scoped result，而不是长期状态表。

### 4. page-local namespace

request-context cache 的有效存储身份必须是 `page_context_namespace + shape_key`。

约束：

1. `shape_key` 不是跨页面全局主键。
2. 不同页面现场即使形状完全相同，也只能在各自 namespace 内覆盖和命中。
3. `incompatible` 只能发生在“同 namespace、同 command + method + pathname、不同 shape”的候选集合里。
4. `rejected_source` 只能来自同 namespace、同 `shape_key` 内的 `RejectedRequestContextObservation`。
5. `synthetic_request_rejected` observation 只允许在同一套 `deriveRequestShape()` 已对该 synthetic request artifact 成功导出 full shape 后产生；否则必须在更早阶段以 `miss` / `incompatible` 终止。
6. synthetic request 自身永远不得作为 `CapturedRequestTemplateRecord.source_kind` 进入 admitted template 类型。

## 生命周期

### 创建

- 只在当前页面真实请求成功完成后创建 `CapturedRequestTemplateRecord`
- 创建时必须同步写入 `page_context_namespace`、`shape` 与 `shape_key`
- 只在 capture admission 明确拒绝时创建 `RejectedRequestContextObservation`

### 覆盖

- 只允许同一 `page_context_namespace` 下、相同 `shape_key` 的更新覆盖旧记录
- 不同 namespace 不得共享同一个 cache slot
- 同一 namespace 下、不同 shape 的候选必须并存于同路由 bucket，而不是互相覆盖成 path-only slot

### 失效

以下任一条件发生后，记录不得继续被当成可复用模板：

1. 超过 freshness window
2. 页面文档卸载、tab 现场切换或 page-local cache 被销毁
3. 来源被识别为 synthetic request
4. 请求完成状态不满足成功 2xx
5. `shape` 与模板内容重新导出的 canonical identity 不一致

### 持久化边界

- `CapturedRequestTemplateRecord` 不能写入 SQLite 作为长期真相源
- `RejectedRequestContextObservation` 也不能写入 SQLite 作为长期真相源
- 它不能被直接映射为 `FR-0018` 的 replay snapshot
- 它们只能属于当前页面现场的 runtime cache / diagnostics；即使实现暂时把它跨模块传递，也不能改变其 page-local ownership

## second-truth 风险提示

- 若实现继续用 `method + pathname`、keyword-only 或 note_id-only scope 做旁路 lookup，会重新引入第二套 identity truth。
- 若实现把 `shape_key` 当成跨页面全局主键，会重新引入跨页污染。
- 若实现允许 `note_type` 以字符串和数字两种形态进入 `shape_key`，会重新引入 false miss。
- 若实现不冻结 `limit -> page_size` 映射，会重新引入 `page_size` 来源歧义。
- 若实现把 `template_body` 当作 fallback identity 来源，会重新引入 detail body 混用与 stale field 覆盖。
- 若实现保留 `rejected_source` 枚举但 observation 不携带 shape-level 身份，该结果会重新退化为 route-level 误归因。
- 若实现允许 admitted template 类型继续保留 synthetic source kind，会重新打开 synthetic 污染模板池的路径。
- 若实现把 `xhs.detail.image_scenes` 仅凭单一样本值硬编码为常量，会把未证实的 detail 变体直接冻结进 formal contract。
- 若实现把 page-local template 持久化为 replay truth，会越过 `FR-0018` 的 formal ownership。

## 与 FR-0018 的边界提醒

`FR-0018` 的 replay/store truth 解决的是“跨 run、跨验证、跨能力视图”的正式回放输入；`FR-0024` 解决的是“当前页面现场是否存在 exact request template”。

两者必须继续分离：

- `FR-0024` 不承诺跨 run 复用
- `FR-0024` 不承诺跨 profile 复用
- `FR-0024` 不承诺 replay eligibility
- `FR-0018` 不承担当前页面 request-context 命中判断
