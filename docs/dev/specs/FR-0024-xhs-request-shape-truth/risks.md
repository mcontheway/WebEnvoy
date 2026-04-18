# FR-0024 风险与回滚

## 风险 1：cross-shape overwrite 继续存在，导致错误模板覆盖

- 表现：不同 search/detail/user_home 请求仍共用同一个 cache slot，较新的模板覆盖不兼容模板
- 缓解：冻结 `RequestShape` 与 `RequestShapeKey` 为唯一 cache truth，不再允许 path-only 或局部 scope key
- 回滚：若后续实现未真正切到 `RequestShapeKey`，则拒绝将其视为 `#489/#500` 的闭环实现，回退到 fail-closed 保守策略

## 风险 2：false miss 后回退 synthetic path，把已知风险重新带回主路径

- 表现：lookup 未命中或 shape mismatch 后，系统又静默走 synthetic fallback，重新暴露 `GATEWAY_INVOKER_FAILED`
- 缓解：冻结 exact miss 的正式规则为 fail closed，并要求返回结构化 miss reason
- 回滚：删除 synthetic fallback 分支，恢复到 request-context missing / incompatible 的保守拒绝

## 风险 3：detail body 混用继续污染 canonical 请求

- 表现：同一 `note_id` 下旧模板 body 的其他字段被整包混入当前 detail 请求，导致 body 形状漂移
- 缓解：把 `image_scenes` 提升为 canonical identity 的一部分，并禁止 detail body 整包摊平复用
- 回滚：撤销整包 body merge，仅保留 exact hit 后允许的 canonical template fields

## 风险 4：stale template 被当成可复用上下文

- 表现：shape 命中但模板已过旧，仍被继续复用，导致旧页面状态污染当前执行
- 缓解：冻结 freshness gate 为正式契约；过旧模板必须返回 `stale`
- 回滚：若 freshness policy 不清或实现绕过它，恢复到“宁缺毋滥”的 miss 行为

## 风险 5：future field drift 再次把 identity 做散

- 表现：XHS 接口未来增加新的语义字段，但实现只在个别阶段补字段，重新形成多套 truth
- 缓解：明确任何 identity 字段扩展都必须通过新的 spec review，不能由单个实现 PR 自行追加
- 回滚：发现 drift 后立即停在 fail-closed，不继续允许旧 shape 近似命中

## 风险 6：page-local template 漂移成 replay/store truth

- 表现：实现把 `CapturedRequestTemplateRecord` 写成跨 run、跨 profile 的持久化输入，侵入 `FR-0018` ownership
- 缓解：在 `data-model.md` 明确 page-local artifact 边界，禁止静默持久化升级
- 回滚：删除越界持久化字段或存储路径，恢复到 page-local runtime cache

## 风险 7：实现跳过 `deriveRequestShape()`，formal truth 再次被绕开

- 表现：capture、lookup、eligibility 里仍各自保留局部判定逻辑，`RequestShape` 只停留在文档层
- 缓解：在 `plan.md` 与 `TODO.md` 明确后续实现必须先收口 shared derivation，再重写三条命令的 capture/lookup/eligibility
- 回滚：拒绝把绕开 shared derivation 的实现视为正式收口，必要时拆出独立修正 PR
