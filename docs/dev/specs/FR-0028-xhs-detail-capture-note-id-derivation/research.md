# FR-0028 研究记录

## 证据分层

### admission_ready

- `extension/xhs-read-execution.ts` 当前成功判定 detail 响应时，只认可 current matcher 已接受的 detail response candidate record 上的 `note_id` / `noteId` / `id`。
- `tests/xhs-read-execution.fallback.test.ts` 已覆盖：
  - `body.data.note` 命中目标 `note_id` 时成功
  - wrapped detail payload `body.data.items[*].note_card` 命中目标 `note_id` 时成功
  - metadata-only `current_note_id` 单独出现时失败
- `extension/xhs-read-execution.ts` 当前实现仍会遍历 `body.data ?? body`、self root、其他 direct entry 与递归 nested path；但除上述已被 tests 直接支撑的路径外，其余分支当前都只属于实现观察，不在本 FR 冻结。

### candidate

- detail route request body 中的 `source_note_id`
- referrer URL path / query 中的 note-id-like 片段
- response metadata，以及 current matcher 未接受的 wrapper / record 上的 note-id-like field

### fallback

- 无。当前 formal 不把任何 fallback source 判为 admitted derivation 保底路径。

## 研究问题 1：为什么 FR-0026 之后还需要单独的 FR-0028

上下文：

- `FR-0026` 只冻结 command-side / canonical identity truth：current v1 `xhs.detail` 只有 `note_id` 进入 identity。
- `#510` 新建的目的，是补上 capture admission 进入 admitted template 时的 canonical `note_id` derivation owner。

关键信息来源：

- `docs/dev/specs/FR-0026-xhs-detail-canonical-identity/spec.md`
- GitHub issue `#510`
- GitHub issue `#502`

结论与影响：

- `FR-0026` 刻意没有回答 capture admission 观察到 detail artifact 时，canonical `note_id` 在 admitted path 上究竟从哪里来。
- 本 FR 必须只冻结 capture-side canonical `note_id` derivation，而不是重写 identity-only freeze。
- replacement implementation 的 detail path 只有在本 FR 合入后，才具备 admission-ready formal 输入。

未解决问题 / 失效条件 / 后续动作：

- 若未来仓库内出现 admission-ready 证据，证明 response-note-record-only 仍不足以稳定判定 admitted template，需要新开 spec 修订。

## 研究问题 2：当前仓库里哪些证据能支撑 admitted derivation

上下文：

- current runtime / tests 已经有 detail 响应成功判定逻辑，但 formal truth 还没有把它冻结为 admitted derivation owner。

关键信息来源或实验输入：

- `extension/xhs-read-execution.ts`
- `tests/xhs-read-execution.fallback.test.ts`

结论与影响：

- 当前实现不接受 metadata-only note id 作为 detail success evidence。
- 只有当 response payload 中出现 current matcher 已接受的 detail response candidate record，且其 `note_id` / `noteId` / `id` 命中目标 `note_id` 时，才认定成功。
- 本 FR 可以把 response-side detail response candidate record 上的 `note_id` / `noteId` / `id` 冻结为 current v1 唯一 admitted derivation source。
- 对 response-side admitted source，formal 当前只能冻结已有一手测试直接覆盖的最小路径：`body.data.note` 与 `body.data.items[*].note_card`。
- current matcher 的其他分支虽然存在于实现中，但在缺少新的 tests 或运行时证据前，不应被本 FR 冻结为 admitted candidate 边界。
- 因此，current v1 的 wrapper admitted truth 只覆盖 `body.data.items[*].note_card`；其他 wrapper-shaped root / record 继续停留在 implementation observation 或 candidate-only 边界。

未解决问题 / 失效条件 / 后续动作：

- 当前 formal 不冻结 response candidate record 的完整字段 shape；若后续实现依赖更多字段，需要新的 spec 修订而不是在本 FR 内扩写。

## 研究问题 3：为什么 `source_note_id` 不能直接提升为 admitted derivation

上下文：

- detail request 侧确实会暴露 `source_note_id`，但 formal 是否能承认它为 admitted canonical mapping 仍是关键分歧点。

关键信息来源或实验输入：

- `docs/dev/specs/FR-0005-xhs-read-spike/research.md`
- `docs/dev/specs/FR-0026-xhs-detail-canonical-identity/spec.md`
- 当前 replacement implementation 分支中的 detail capture candidate 逻辑

结论与影响：

- `FR-0005` 与 `FR-0026` 已稳定表明：`/api/sns/web/v1/feed` 的 request-side `source_note_id` 目前只有 candidate / failed / synthetic 层级证据。
- 这些证据能证明 detail route 可能使用 `source_note_id`，但不能证明 capture admission 在 admitted template 路径上可以只靠 `source_note_id` 建立 canonical `note_id`。
- 如果 formal 在此处直接承认 `source_note_id` admitted mapping，会与 `FR-0026` 明确拒绝的 admitted canonical mapping freeze 冲突。

未解决问题 / 失效条件 / 后续动作：

- 若后续 latest-main runtime / tests / real-browser evidence 能稳定证明 `source_note_id` 足以承载 admitted derivation，需要新开 formal 修订。

## 研究问题 4：为什么 referrer 与 metadata-only note field 也只能停留在 candidate-only

上下文：

- review 容易把 search-only 路径里的 referrer reuse 语义错误迁移到 detail derivation。

关键信息来源或实验输入：

- `docs/dev/specs/FR-0024-xhs-request-shape-truth/spec.md`
- `tests/xhs-read-execution.fallback.test.ts`
- current detail response success logic

结论与影响：

- 当前仓库 formal truth 没有任何已冻结结论表明 detail path 可以用 referrer 直接导出 admitted canonical `note_id`。
- `FR-0024` 中关于 referrer 的 formal truth 只适用于 search exact-hit 后的可复用上下文，不等于 detail derivation truth。
- metadata-only note id 已被现有 tests 明确排除为 detail success evidence。

未解决问题 / 失效条件 / 后续动作：

- 若未来 detail path 引入新的 response metadata contract，本 FR 必须保持 candidate-only 边界不变，直到新证据和新 spec 修订出现。

## 研究问题 5：为什么 replacement implementation gate 必须消费本 FR

上下文：

- `#509 / FR-0027` 负责 shared reuse semantics，但不应替 detail admitted derivation 冻结 owner。

关键信息来源或实验输入：

- GitHub issues `#502`、`#508`、`#510`
- GitHub PR `#509`
- replacement implementation PR body 草稿

结论与影响：

- replacement implementation 要想进入 admitted template path，必须知道 detail canonical `note_id` 在 capture 侧怎么被正式导出。
- 如果没有本 FR，formal suite 会出现“identity-only 已冻结，但 capture-side admitted derivation 未冻结”的断层。
- 本 FR 必须加入 detail replacement path 的 formal prerequisite 组合，同时不越权替代 `#508` 的 shared reuse semantics owner。
- 已 merge 的 detail formal suites 也必须与这棵 prerequisite tree 保持一致，否则 reviewer 无法判断 detail path 是否已经 implementation-ready。

未解决问题 / 失效条件 / 后续动作：

- `#502` 的 shared parent truth 必须持续显式把 `#510` 纳入 formal dependency tree，不得在后续编辑中回摆。
- `#508` 的 issue truth 需要继续保持“shared reuse semantics owner”，不得回摆为 detail derivation owner。
