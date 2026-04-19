# FR-0027 风险与边界

## 风险 1：formal owner 再次重叠

- 表现：
  - `#502/#504/#505/#508/#510` 同时声明相同语义
- 影响：
  - GitHub issue truth 与 formal suite truth 再次分离
- 缓解：
  - 当前 FR 只冻结 shared reuse semantics 与 replacement implementation formal gate
  - search-only、command surface、detail identity 分别继续由 `#502/#504/#505` 承载

## 风险 2：实现 PR 越权定义 shared reuse semantics

- 表现：
  - replacement implementation 在 formal 未齐备前自行定义 slotting 或 fail-closed 规则
- 影响：
  - guardian 会持续把 formal 缺口重新打回实现链
- 缓解：
  - 当前 FR 明确 `#508` 只冻结 shared reuse semantics，replacement implementation 仍需等待 `#510`
  - page-local namespace、route bucket、shape slot、bucket state 的最小结构字段与 exact-match / fail-closed 先在 formal 中冻结；detail capture-side canonical `note_id` derivation 则交由 `#510`

## 风险 3：detail/user_home shape 被误写成多主键

- 表现：
  - `source_note_id`、`image_scenes`、`userId` 等候选字段被并列写入 canonical shape
- 影响：
  - reuse semantics 与 `#505` detail identity-only 结论冲突
- 缓解：
  - 当前 FR 只冻结 `note_id` / `user_id` only reuse-shape
  - 非 canonical 字段只允许作为归一来源或命中后的上下文，不进入 `shape_key`
  - detail capture admission 当前 formal 只承认 canonical `note_id`

## 风险 4：slot identity 与 referrer fallback 同时写成多套 truth

- 表现：
  - `spec.md` 与 `contracts/request-context-reuse.md` 对 slot identity 的组成不一致
  - detail referrer / transport 派生 `note_id` 被直接写成 formal truth，但仓库内证据仍不足
- 影响：
  - guardian 会持续把同类 formal 缺口反复打回，replacement implementation 也会缺少单一上游输入
- 缓解：
  - route bucket identity 与 shape slot identity 分开冻结，不再混写成并列 slot 公式
  - detail referrer / transport derivation 继续保持 deferred，待后续证据充分后再另行修订
