# FR-0024 TODO

- [x] 建立 `FR-0024-xhs-request-shape-truth` 正式套件
- [x] 建立 shared blocker issue `#502`
- [x] 建立 deferred scope issue `#504`
- [x] 建立 deferred scope issue `#505`
- [ ] reviewer 确认本轮仅是 `#512` search-side compatibility/backwrite maintenance，不扩成 shared owner
- [ ] reviewer 确认 `RequestShape` 是 `capture -> cache key -> lookup -> eligibility` 的唯一 truth
- [ ] reviewer 确认有效缓存身份显式包含 `page_context_namespace + shape_key`
- [ ] reviewer 确认 `xhs.search` canonical identity 至少覆盖 `keyword/page/page_size/sort/note_type`
- [ ] reviewer 确认 `limit -> page_size` 已冻结为唯一 canonical 映射
- [ ] reviewer 确认 `note_type` 在进入 `RequestShapeKey` 前先归一为 canonical integer
- [ ] reviewer 确认扩充后的 `RejectedRequestContextObservation` 仅补齐 `source_kind` 与 `request_status` 两个 shared-compatible 最小字段
- [ ] reviewer 确认 success-only sibling-shape mismatch 已冻结为 route-bucket `RouteBucketIncompatibleObservation`
- [ ] reviewer 确认 rejected-only sibling-shape 仍返回 `miss(reason="shape_mismatch")`，并映射到 `request_context_incompatible`
- [ ] reviewer 确认 `rejected_source` 继续只绑定同 namespace、同 `shape_key` 槽位
- [ ] reviewer 确认 admitted template canonical type 已移除 synthetic source kind
- [ ] reviewer 确认 stale template 必须返回结构化 miss，不得继续复用
- [ ] reviewer 确认 miss / mismatch 的正式规则是 fail closed，不得静默退回 synthetic path
- [ ] reviewer 确认 `CapturedRequestTemplateRecord` 是 page-local runtime artifact，不是 `FR-0018` replay/store truth
- [ ] reviewer 确认 `xhs.detail` / `xhs.user_home` / detail rejected-source defer-fix 仍不属于本轮范围
- [ ] reviewer 确认 `Closing=Fixes #512`、`gate_applicability.review_lane=formal_spec_review_pr`、`live_evidence_record=N/A`
- [ ] reviewer 确认 `bash scripts/check-pr-purity.sh docs/issue-512-fr0024-compat-backwrite main` 与单分支职责一致
- [ ] `#512` merge 后 refresh `#509` rerun guardian，不再重复打 FR-0024 schema/backwrite finding

## Handoff

- 当前阶段只做 `#512` maintenance：把 `FR-0024` search-side wording 回写成与 shared reuse contract 兼容，不承诺实现代码。
- 后续实现或 refresh 验证应优先消费本 FR 的：
  - `RequestShape`
  - `RequestShapeKey`
  - `CapturedRequestTemplateRecord`
  - `TemplateLookupResult`
  - `RequestContextMissReason`
- out of scope：
  - `#504`：`xhs.detail` / `xhs.user_home`
  - `#505`：`xhs.detail.image_scenes`
  - `#508`：shared request-context reuse owner truth
  - `#510`：detail derivation truth
