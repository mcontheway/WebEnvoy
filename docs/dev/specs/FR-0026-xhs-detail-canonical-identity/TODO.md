# FR-0026 TODO

- [x] 建立 `FR-0026-xhs-detail-canonical-identity` 正式套件
- [x] 建立 canonical issue 绑定 `#505`
- [ ] reviewer 确认 current v1 `xhs.detail` canonical identity 只包含 `note_id`
- [ ] reviewer 确认 `source_note_id` 未被提升为 frozen identity baseline、第二个 identity 字段、admitted canonical mapping 或更广 transport truth
- [ ] reviewer 确认 `image_scenes` 当前不进入 identity
- [ ] reviewer 确认本 FR 未把 `image_scenes` 的 placement 写成 current v1 formal truth
- [ ] reviewer 确认本 FR 未把 compatibility、rejected-source matching、template reuse 等 identity 之外的 detail matching 语义预先冻结为 formal truth，也未把它们错误回指给 `#504`
- [ ] reviewer 确认仓库内不存在 admission-ready `image_scenes` 证据，不能据此扩 identity
- [ ] reviewer 确认 future identity expansion 或 `source_note_id` canonical mapping / alias / derivation freeze 必须等待新的 spec 修订
- [ ] reviewer 确认 detail request-shape truth、shape_key、lookup slotting、route eligibility 与 reuse 语义如需冻结，必须先经过 `#508` 对应的 formal spec review，不能由单独实现 PR 越权定义
- [ ] reviewer 确认 `Closing=Refs #505`、`review_lane=formal_spec_review_pr`、`live_evidence_record=N/A`
- [ ] reviewer 确认 `bash scripts/check-pr-purity.sh docs/FR-0026-xhs-detail-canonical-identity main` 与单分支职责一致
- [ ] spec review 通过并形成可进入实现的新冻结输入

## Handoff

- 当前阶段只冻结 current v1 detail identity，不承诺实现代码。
- 后续实现应优先消费本 FR 冻结的：
  - `note_id` only identity
  - `image_scenes` not-in-identity 结论
  - future revision 准入条件
