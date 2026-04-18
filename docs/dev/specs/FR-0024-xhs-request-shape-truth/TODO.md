# FR-0024 TODO

- [x] 建立 `FR-0024-xhs-request-shape-truth` 正式套件
- [x] 建立 shared blocker issue `#502`
- [ ] reviewer 确认 `RequestShape` 是 `capture -> cache key -> lookup -> eligibility` 的唯一 truth
- [ ] reviewer 确认 `xhs.search` canonical identity 至少覆盖 `keyword/page/page_size/sort/note_type`
- [ ] reviewer 确认 `xhs.detail` canonical identity 包含 `source_note_id + image_scenes`
- [ ] reviewer 确认 `xhs.user_home` 当前 canonical identity 只包含 `user_id`
- [ ] reviewer 确认 headers/referrer/trace/search_id 只属于 exact hit 后的可复用上下文字段，不属于 identity
- [ ] reviewer 确认 template 只有在真实页面请求、成功完成、非 synthetic request 时才允许进入缓存
- [ ] reviewer 确认 stale template 必须返回结构化 miss，不得继续复用
- [ ] reviewer 确认 miss / mismatch 的正式规则是 fail closed，不得静默退回 synthetic path
- [ ] reviewer 确认 `CapturedRequestTemplateRecord` 是 page-local runtime artifact，不是 `FR-0018` replay/store truth
- [ ] reviewer 确认后续实现必须新开 PR，不再在 `#501` 上继续补丁
- [ ] reviewer 确认 `Closing=Refs #502`、`gate_applicability.review_lane=formal_spec_review_pr`、`live_evidence_record=N/A`
- [ ] reviewer 确认 `bash scripts/check-pr-purity.sh docs/FR-0024-xhs-request-shape-truth main` 与单分支职责一致
- [ ] spec review 通过并形成可进入实现的新冻结输入

## Handoff

- 当前阶段只冻结 request-shape formal contract，不承诺实现代码。
- 后续实现应优先消费本 FR 的：
  - `RequestShape`
  - `RequestShapeKey`
  - `CapturedRequestTemplateRecord`
  - `TemplateLookupResult`
  - `RequestContextMissReason`
- 后续实现 PR 必须显式覆盖三条命令：
  - `xhs.search`
  - `xhs.detail`
  - `xhs.user_home`
