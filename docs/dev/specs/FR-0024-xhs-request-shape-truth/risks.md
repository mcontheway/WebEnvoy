# FR-0024 风险与回滚

## 风险 1：cross-shape overwrite 继续存在，导致错误模板覆盖

- 表现：不同 `xhs.search` 请求仍共用同一个 cache slot，较新的模板覆盖不兼容模板
- 缓解：冻结 `RequestShape` 与 `RequestShapeKey` 为唯一 cache truth，不再允许 path-only 或局部 scope key
- 回滚：若后续实现未真正切到 `RequestShapeKey`，则拒绝将其视为 `#489` 的闭环实现，回退到 fail-closed 保守策略

## 风险 2：false miss 后回退 synthetic path，把已知风险重新带回主路径

- 表现：lookup 未命中或 shape mismatch 后，系统又静默走 synthetic fallback，重新暴露 `GATEWAY_INVOKER_FAILED`
- 缓解：冻结 exact miss 的正式规则为 fail closed，并要求返回结构化 miss reason
- 回滚：删除 synthetic fallback 分支，恢复到 request-context missing / incompatible 的保守拒绝

## 风险 3：stale template 被当成可复用上下文

- 表现：shape 命中但模板已过旧，仍被继续复用，导致旧页面状态污染当前执行
- 缓解：冻结 freshness gate 为正式契约；过旧模板必须返回 `stale`
- 回滚：若 freshness policy 不清或实现绕过它，恢复到“宁缺毋滥”的 miss 行为

## 风险 4：future field drift 再次把 identity 做散

- 表现：XHS search 接口未来增加新的语义字段，但实现只在个别阶段补字段，重新形成多套 truth
- 缓解：明确任何 `xhs.search` identity 字段扩展都必须通过新的 spec review，不能由单个实现 PR 自行追加
- 回滚：发现 drift 后立即停在 fail-closed，不继续允许旧 shape 近似命中

## 风险 5：page-local template 漂移成 replay/store truth

- 表现：实现把 `CapturedRequestTemplateRecord` 写成跨 run、跨 profile 的持久化输入，侵入 `FR-0018` ownership
- 缓解：在 `data-model.md` 明确 page-local artifact 边界，禁止静默持久化升级
- 回滚：删除越界持久化字段或存储路径，恢复到 page-local runtime cache

## 风险 6：实现跳过 `deriveRequestShape()`，formal truth 再次被绕开

- 表现：capture、lookup、eligibility 里仍各自保留局部判定逻辑，`RequestShape` 只停留在文档层
- 缓解：在 `plan.md` 与 `TODO.md` 明确后续实现必须先收口 shared derivation，再重写 `xhs.search` 的 capture/lookup/eligibility
- 回滚：拒绝把绕开 shared derivation 的实现视为正式收口，必要时拆出独立修正 PR

## 风险 7：deferred scope 被误判为已冻结

- 表现：`#503` 合并后，后续执行把 `xhs.detail` / `xhs.user_home` / `xhs.detail.image_scenes` 误当成已在 `FR-0024` 冻结完成
- 缓解：在 `spec.md`、`plan.md`、`TODO.md`、PR 描述与 `#502` 中显式回链 `#504` / `#505`
- 回滚：一旦出现 scope 漂移，直接阻断实现 PR，要求先回到 `#504/#505` 收口上游 formal baseline

## 风险 8：search-side schema 继续与 shared reuse contract 冲突

- 表现：`FR-0024` 仍只保留旧的 rejected observation 形态，或把 rejected-only sibling shape 与 success-only incompatible candidate 混成一类结果，导致 reviewer 在 `#509` 继续看到两套 formal schema
- 缓解：通过 `#512` maintenance 把 search-side `RejectedRequestContextObservation`、`RouteBucketIncompatibleObservation` 与 `TemplateLookupResult` 回写成单一兼容口径
- 回滚：若本轮 backwrite 引发 owner 漂移，则回退到 search-only wording，并把 shared contract 所需 schema 留在独立 maintenance 修订里重新收口
