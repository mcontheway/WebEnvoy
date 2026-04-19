# FR-0028 风险与回滚

## 风险 1：把 candidate source 误写成 admitted truth

- 表现：
  - 后续 review 或实现 PR 把 `source_note_id`、referrer、metadata-only note field 直接写成 admitted canonical `note_id` derivation
- 触发条件：
  - implementation PR 以“当前代码能跑”替代 formal freeze
  - review 只看命中率，不看 derivation source 边界
- 后果：
  - 与 `FR-0026` 的 identity-only freeze 冲突
  - detail admitted template 的 formal 输入再次失真
- 缓解：
  - 在 `spec.md`、`contracts/`、`TODO.md` 中重复声明 candidate-only 边界
  - 在 replacement implementation PR 中要求显式引用 `FR-0028`
- 观察信号：
  - PR 描述或代码把 `source_note_id` / referrer 写成 admitted source
  - guardian/review 提示 admitted derivation owner 仍可由实现侧自行决定
- 剩余风险：
  - 旧实现分支可能已经写入 candidate-only 派生代码，后续需要在实现 PR 里继续清理
- stop-ship / 降级 / 回滚：
  - stop-ship：一旦实现 PR 把 candidate-only source 升格为 admitted truth，禁止合并
  - 降级：保持 detail path blocked，不提前宣告 implementation-ready
  - 回滚：撤回越权 formal 或实现 PR，恢复到 response-note-record-only admitted truth

## 风险 2：把 FR-0028 越权扩写成 shared reuse semantics

- 表现：
  - 在本 FR 中顺手冻结 `shape_key`、slotting、exact-match、rejected-source 或 freshness
- 触发条件：
  - 为了减少后续实现 PR 改动，提前在本 FR 中写入 reuse / eligibility 规则
- 后果：
  - 与 `#508` 的职责重叠
  - formal owner 再次混线
- 缓解：
  - 明确本 FR 只回答 capture-side canonical `note_id` derivation
  - 所有 reuse / eligibility / miss-state 语义继续回指 `#508`
- 观察信号：
  - `FR-0028` 文案出现 `shape_key`、route bucket、freshness、exact-match 等 owner 级结论
  - guardian/review 把 `FR-0028` 与 `FR-0027` 判定为职责混线
- 剩余风险：
  - `#502` / `#508` / `#510` 的 GitHub truth 若不同步，review 仍可能误判 owner
- stop-ship / 降级 / 回滚：
  - stop-ship：若 PR 同时冻结 derivation 与 reuse semantics，必须拆分
  - 降级：仅保留 derivation formal freeze，reuse 继续 blocked 在 `#508`
  - 回滚：撤回越权段落，不让 `FR-0028` 进入 shared reuse owner

## 风险 3：把 response candidate 的完整 schema 误报为 formal truth

- 表现：
  - 因为当前实现会扫描多个 response scope，就把完整 response shape 写成 rigid schema
  - 或反过来把 current main 已接受的 matcher 分支收窄到只剩少数 tests 直接覆盖的 path，导致 formal truth 与 observable behavior 失配
- 触发条件：
  - 把实现扫描路径直接复制成 formal payload schema
- 后果：
  - formal 契约超出当前证据
  - 后续实现被不必要地锁死
- 缓解：
  - 只冻结 note-id derivation 所需的最小 response root / candidate entry / nested key 边界与 identifier field
  - 显式把 `body.data.note`、`body.data.items[*].note_card`、`body.data.items[*]` target-missing 检查，以及 `getDetailResponseCandidates()` 的 current-main matcher 家族一起写入口径
  - 明确 formal freeze 依赖 current main observable matcher truth，而不是假装这些分支都已有完整 tests 矩阵
  - 不冻结额外 payload 字段
- 观察信号：
  - contract / spec 出现大量 detail response payload 字段枚举
  - review 发现 formal 文本要求实现保留完整 response schema
  - guardian / review 继续指出 wrapper/candidate matcher boundary 仍未正式冻结
- 剩余风险：
  - current tests 仍然依赖 detail candidate record 的 shape 线索；后续实现需继续把 shape 判定保持在最小范围
- stop-ship / 降级 / 回滚：
  - stop-ship：若 formal 把完整 response schema 写成强约束，阻断合并
  - 降级：只保留 candidate scope 与 identifier field 的最小冻结
  - 回滚：撤回额外 schema 字段，恢复到最小 derivation contract

## 风险 4：shared parent truth 再次漂移出 `#510` prerequisite tree

- 表现：
  - reviewer 仍可能把 `#509` 误判为 replacement implementation 的最后 formal blocker
  - `#502` / `#508` / `#510` 的 issue body 或 comment 若重新失配，parent truth 会再次看起来像只等 `#503/#504/#505/#508`
- 触发条件：
  - formal PR 已经建立，但 GitHub issue truth 没有持续保持同一 prerequisite tree
- 后果：
  - implementation PR 可能在 detail derivation owner 未冻结前被错误推进
  - `#501` superseded / successor 语义再次失真
- 缓解：
  - 在 `#502` / `#508` 的 issue body 与 comment 中都显式写入 `#510`
  - 在 `#510` issue meta 中显式回链 `Parent: #502`
  - 在 `#509` / `#511` PR 描述中都回链 `#502`
- 观察信号：
  - `#502` / `#508` issue body 重新只剩 `#503/#504/#505/#508`
  - `#510` issue meta 不再显式指向 `Parent: #502`
  - reviewer 把 `#509` 当成 replacement implementation 的最后 formal blocker
- 剩余风险：
  - issue body 与 comment truth 仍可能在后续编辑中再次漂移，需要 merge 前后持续复核 GitHub truth
- stop-ship / 降级 / 回滚：
  - stop-ship：若 parent truth 仍遗漏 `#510`，replacement implementation 不进入 ready 状态
  - 降级：保持实现 blocked，仅继续 formal 收口
  - 回滚：不适用；此风险通过更新 GitHub truth 收口

## 回滚策略

- 若 reviewer 认为 current admitted source 仍证据不足，应阻断本 FR 合入，而不是让实现 PR 临时决定 admitted derivation source。
- 若未来出现 admission-ready 新证据，需要通过新 spec 修订扩 admitted source，而不是回滚 `FR-0028` 去容纳未验证 truth。
