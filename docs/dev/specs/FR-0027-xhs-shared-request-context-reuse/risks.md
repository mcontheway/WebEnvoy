# FR-0027 风险与边界

## 风险 1：formal owner 再次重叠

- 表现：
  - `#503/#504/#505/#508` 同时声明相同语义
- 影响：
  - GitHub issue truth 与 formal suite truth 再次分离
- 缓解：
  - 当前 FR 只冻结 shared reuse semantics 与 replacement implementation formal gate
  - search-only、command surface、detail identity 分别继续由 `#503/#504/#505` 承载

## 风险 2：实现 PR 越权定义 shared reuse semantics

- 表现：
  - replacement implementation 在 formal 未齐备前自行定义 slotting 或 fail-closed 规则
- 影响：
  - guardian 会持续把 formal 缺口重新打回实现链
- 缓解：
  - 当前 FR 明确 replacement implementation 必须等待 `#508`
  - page-local namespace、route bucket、shape slot、bucket state、detail `note_id` derivation 与 exact-match / fail-closed 在 formal 中先冻结

## 风险 3：detail/user_home shape 被误写成多主键

- 表现：
  - `source_note_id`、`image_scenes`、`userId` 等候选字段被并列写入 canonical shape
- 影响：
  - reuse semantics 与 `#505` detail identity-only 结论冲突
- 缓解：
  - 当前 FR 只冻结 `note_id` / `user_id` only reuse-shape
  - 非 canonical 字段只允许作为归一来源或命中后的上下文，不进入 `shape_key`
  - detail capture admission 只允许使用 canonical `note_id` 或当前 detail 页 referrer 恢复出的 `note_id`
