# FR-0027 研究记录

## 研究问题 1：为什么 slot identity 必须拆成两层，而不是写成一套并列公式

结论：

- `FR-0024` 已冻结：request-context 的实际 shape slot identity 是 `page_context_namespace + shape_key`。
- 但 shared reuse 又要求 lookup 先在当前 namespace 内选定同 route family 的候选 bucket，再在 bucket 内做 exact-shape 命中。
- 因此这里存在两层身份：
  - route bucket identity：`page_context_namespace + route_scope`
  - shape slot identity：`page_context_namespace + shape_key`
- 若把 `route_scope` 再并列写进 shape slot identity，就会形成第二套 slot 公式，重新破坏 `FR-0024` 已冻结的单一 shape-slot truth。

仓库内依据：

- `docs/dev/specs/FR-0024-xhs-request-shape-truth/spec.md`
  - 先按 route family 解析当前页面现场候选 bucket，再按 `shape_key` / `shape` 判定 exact hit
  - 有效缓存身份必须显式包含 `page_context_namespace + shape_key`
- `docs/dev/specs/FR-0024-xhs-request-shape-truth/contracts/request-context-shape.md`
  - lookup 先选 route bucket，再做 shape 级判定
  - shape slot / rejected observation 的有效保留键仍是 `page_context_namespace + shape_key`

因此本 FR 选择：

- 明确把 route bucket identity 与 shape slot identity 拆开冻结
- 不允许再把 `route_scope` 写成与 `shape_key` 并列的第二套 shape slot identity

## 研究问题 2：为什么 detail referrer 派生 `note_id` 只能收窄到 `explore_detail_tab -> /explore/<note_id>`

结论：

- `#504 / FR-0025` 已冻结：`xhs.detail` 的唯一 target-page baseline 是 `explore_detail_tab`。
- 当前仓库内可以支撑的最窄 page-local 恢复路径，是在 detail 页现场从 `/explore/<note_id>` referrer 恢复 `note_id`。
- 这个规则的作用只是避免把 `source_note_id` 升格为 admitted canonical derivation input，同时让 detail reuse-shape 继续保持 `note_id` only。
- 当前仓库没有证据支持更宽的 referrer 推断，也没有证据支持把 `source_note_id`、其他 transport alias 或其他页面路径升格为 formal truth。

仓库内依据：

### 1. target-page baseline 已经收窄到 detail 页现场

- `docs/dev/specs/FR-0025-xhs-detail-user-home-command-surface-baseline/spec.md`
  - `xhs.detail` 的 current target-page baseline 是 `explore_detail_tab`
  - target-page 不为 `explore_detail_tab` 时必须按 invalid-args / blocked 处理
- `src/commands/xhs-input.ts`
  - `xhs.detail` 在非 `explore_detail_tab` 时直接拒绝

### 2. 当前 in-repo runtime / tests 已把 referrer 作为 detail request-context 上下文的一部分

- `extension/xhs-read-execution.ts`
  - request-context 命中后会读取 captured artifact 的 `referrer`
- `tests/xhs-read-execution.fallback.test.ts`
  - detail admitted template 保留 `referrer`
  - detail request body 仍只把 `source_note_id` 保留在 transport/request 侧
- `tests/xhs-read-request-context.test.ts`
  - detail artifact 的 canonical shape 保持 `note_id` only
  - artifact `referrer` 明确是 `https://www.xiaohongshu.com/explore/<note_id>`
  - `image_scenes` 与 `source_note_id` 都不进入 detail shape
- `tests/main-world-bridge.contract.test.ts`
  - current candidate implementation 已有以 detail 页现场配合 `/api/sns/web/v1/feed` body 做 note 归一的 contract evidence

### 3. 当前仓库仍缺少更宽推断的 formal 证据

- 没有证据支持把 `source_note_id` 冻结为 admitted canonical derivation input
- 没有证据支持把任意 referrer、其他 pathname 或跨页面 transport alias 冻结为 formal truth

因此本 FR 选择：

- detail capture admission 只允许两种来源：
  - 已经 canonical 的 `note_id`
  - `explore_detail_tab` 下 `/explore/<note_id>` referrer 恢复出的 page-local `note_id`
- 其他 transport / referrer 推断一律不在本 FR 内 formalize
