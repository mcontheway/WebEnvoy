# FR-0024 研究与取舍

## 研究问题 1：为什么 `#501` 反复不过

结论：

- `#501` 的主要问题不是“还有几个 guardian finding 没补完”，而是系统里没有单一的 request-shape truth。
- guardian 每一轮打回都只是从不同切面暴露同一个模型裂缝：capture scope、cache key、lookup eligibility 与 fallback 行为对“同一请求”的定义不一致。
- 只要这四个阶段继续各算各的，局部补丁就会在另一个阶段重新漏出新阻断。

因此本 FR 选择：

- 不再把 guardian 当成问题发现器逐条追 findings。
- 直接冻结共享 `RequestShape` / `RequestShapeKey` 模型，要求四阶段共用一份 truth。

## 研究问题 2：为什么 single request-shape truth 是最小闭环修法

结论：

- request-context 是否可复用，本质上是在回答“当前请求与被捕获模板是不是同一请求”。
- 如果 capture admission 与 lookup/eligibility 不共享同一 canonical identity，就会同时出现两类问题：
  - false overwrite：不同请求被错误认为“相同”，覆盖或复用彼此模板
  - false miss：同一类请求在不同阶段被认成“不相同”，从而落回高风险 fallback
- 统一 `RequestShape` 后，capture、cache key、lookup、eligibility 只剩一个真相源，才能真正消除这两类问题。

因此本 FR 选择：

- 由 `deriveRequestShape()` 产出唯一 canonical identity
- 由 `RequestShapeKey` 产出唯一 cache / lookup key
- 由 exact shape match 决定 eligibility

## 研究问题 3：为什么 exact miss 必须 fail closed

结论：

- 当前已知风险不是“偶发没命中模板”，而是“没命中后又回退到 synthetic path”。
- 在 XHS live read 路径里，synthetic fallback 已经被证明会把 `GATEWAY_INVOKER_FAILED` 风险重新带回主执行路径。
- 在未承诺 explicit reacquire 之前，最保守且一致的正式规则只能是 fail closed。

因此本 FR 选择：

- exact template 不存在、shape mismatch、template stale 或来源被拒绝时，当前正式规则一律 fail closed
- explicit reacquire 如有需要，后续单独立项

## 研究问题 4：为什么 captured template 不能升级成 replay/store truth

结论：

- XHS request-context 解决的是“当前页面现场能否复用页面真实请求模板”。
- `FR-0018` replay/store truth 解决的是“跨 run、跨验证、跨能力视图的正式回放输入”。
- 两者虽然都涉及“可复用输入”，但生命周期、ownership 与可信语义完全不同。

因此本 FR 选择：

- `CapturedRequestTemplateRecord` 只定义为 page-local runtime artifact
- 不让它越界成 replay snapshot 或持久化真相源

## guardian 驳回轨迹归类

| 波次 | 代表问题 | 暴露出的真实矛盾 |
| --- | --- | --- |
| 第一轮 | 模板作用域过粗，只按 `method + pathname` | cache scope 没有 canonical identity |
| 第二轮 | search 可能复用不同 query 的 `search_id` | search identity 与 reusable context 混淆 |
| 第三轮 | stale page state 覆盖 canonical 默认值；synthetic request 污染模板；失败请求进入缓存；detail body 混用 | capture、template admission 与 canonical body ownership 不一致 |
| 最新一轮 | 同关键词下 `page/page_size/sort/note_type` 变化时仍然 false miss；miss 后回退 synthetic path | `capture -> cache key -> lookup -> eligibility` 没有共享完整 request shape |

这条轨迹说明：

- guardian 不是不断发现新类别问题
- guardian 只是不断在不同阶段命中同一个“多套 truth 并存”的根矛盾

## 从当前启发式到正式模型的迁移表

| 当前启发式倾向 | 正式模型 | 迁移结论 |
| --- | --- | --- |
| path scope 或局部 scope key | `RequestShapeKey` | cache / lookup 一律收口到 shape key |
| 从 body/header/page state 局部推断 identity | `deriveRequestShape()` | identity 只来自共享 derivation |
| shape mismatch 后局部复用字段 | exact match only | 不再允许模糊复用 |
| exact miss 后 silent synthetic fallback | fail closed | 当前正式行为改为拒绝执行 |
| 把 page-local template 当成“近似 replay 输入” | page-local artifact | 与 `FR-0018` ownership 分离 |

## 当前不在本 FR 内处理的问题

- explicit reacquire 的产品流程与错误恢复语义
- XHS 之外的平台抽象
- freshness window 的具体数值调优
- `#489/#500` 的实际 runtime 改造与表驱动实现
- `#445` 在新实现合入后的 latest-main real-browser rerun 计划
- `#501` 的最终 superseded 收口动作；该动作应在新实现 PR 建立后执行，而不是继续在 `#501` 上补丁
