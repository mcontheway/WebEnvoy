# FR-0027 TODO

- [x] 建立 `FR-0027-xhs-shared-request-context-reuse` 正式套件
- [x] 建立 canonical issue 绑定 `#508`
- [ ] reviewer 确认 `#502/#504/#505/#508` formal owner 已无重叠或缺口
- [ ] reviewer 确认 page-local namespace、route bucket 与 shape slotting 已冻结为 shared slotting identity
- [ ] reviewer 确认 route bucket identity 与 shape slot identity 只有一套一致定义
- [ ] reviewer 确认 admitted / rejected / incompatible bucket state 分层及其最小结构字段已冻结为 shared request-context model
- [ ] reviewer 确认 detail/user_home canonical reuse-shape 已冻结为 `note_id` / `user_id` only，且 detail capture-side `note_id` derivation 已先冻结
- [ ] reviewer 确认 detail referrer 派生 `note_id` 的 formal 边界已有 `research.md` 承接
- [ ] reviewer 确认 synthetic / failed source 不进入 admitted template
- [ ] reviewer 确认 exact-match / freshness / fail-closed 规则已冻结
- [ ] reviewer 确认 replacement implementation formal gate 已更新为等待 `#502/#504/#505/#508`
- [ ] reviewer 确认 `Closing=Refs #508`、`review_lane=formal_spec_review_pr`、`live_evidence_record=N/A`
- [ ] reviewer 确认 `bash scripts/check-pr-purity.sh docs/FR-0027-xhs-shared-request-context-reuse main` 与单分支职责一致
- [ ] spec review 通过并形成 replacement implementation 的新正式输入
