# FR-0028 实施计划

## 实施目标

冻结 current v1 `xhs.detail` capture-side canonical `note_id` derivation：把 admitted template 可接受的 derivation source 收口为 response-side detail response candidate record，把 `source_note_id` / referrer / metadata-only note field 限定为 candidate-only observation，并把 replacement implementation 的 detail formal gate 明确绑定到本 FR。

## 分阶段拆分

### 阶段 1：formal truth 与仓库证据收敛

- 产出：`research.md`
- 重点：确认 `FR-0025`、`FR-0026`、`#508`、`#510` 的边界；确认 `FR-0005` 与 in-tree tests 对 `source_note_id`、response-side note fields、metadata-only failure 的现有证据等级
  - 同时把 detail replacement path 的 prerequisite tree 与已 merge 的 detail formal suites 对齐，避免仓库内出现两套 implementation-ready gate

### 阶段 2：capture-side derivation contract 冻结

- 产出：`spec.md`、`contracts/detail-capture-note-id-derivation.md`
- 重点：冻结 admitted derivation source、candidate-only source 边界、response-side note field 的 current formal 地位

### 阶段 3：replacement gate 与 review 风险收口

- 产出：`data-model.md`、`risks.md`、`TODO.md`
- 重点：堵住后续实现 PR 越权把 `source_note_id`、referrer 或 metadata-only note field 写成 admitted truth 的路径，并把 replacement implementation 的 detail gate 收入口径写清

## 实现约束

- 不修改 runtime、extension、CLI、测试实现或任何非文档文件。
- 不改写 `FR-0025` 已冻结的 command surface / request-context baseline。
- 不改写 `FR-0026` 已冻结的 `note_id`-only identity truth。
- 不替 `#508` 冻结 shared reuse semantics、shape_key、lookup slotting、route eligibility、exact-match / freshness 或 rejected-source 行为。
- 不推进 replacement implementation、`#445` closeout、live rerun 或 guardian rerun。

## 测试与验证策略

- 规约对照：
  - 对照 `docs/dev/specs/FR-0025-xhs-detail-user-home-command-surface-baseline/spec.md`，确认 detail command-side input 仍是 `note_id` only
  - 对照 `docs/dev/specs/FR-0026-xhs-detail-canonical-identity/spec.md`，确认本 FR 不把 `source_note_id` 或 `image_scenes` 写回 identity truth
  - 对照 `docs/dev/specs/FR-0005-xhs-read-spike/research.md`，确认 `/api/sns/web/v1/feed` 目前只有 `source_note_id` candidate / failed 级证据
  - 对照 `tests/xhs-read-execution.fallback.test.ts`，确认 `body.data.note` 命中目标 `note_id` 时成功，`body.data.items[*].note_card` 命中目标 `note_id` 时成功，`body.data.items[*]` target-missing failure 会命中 direct-item candidate inspection，且 metadata-only `current_note_id` 单独出现时失败
  - 对照 `extension/xhs-read-execution.ts`，确认 current matcher 固定先取 `body.data ?? body`；仅在顶层 `body.data` 缺失时才回看 `body`，若 `body.data` 已存在但不是对象则不会再次退回 `body`；并只沿 detail-shaped self root、`note`、`note_card`、`note_card_list`、`current_note`、`item`、`items`、`notes` 与递归 `note` / `note_card` / `current_note` / `item` 收集 detail candidate record
- 文档门禁：
  - `git diff --check`
  - `git status --short`
- 纯度校验：
  - 以 `docs/dev/specs/FR-0028-xhs-detail-capture-note-id-derivation/**` 为主
  - 若为保持已 merge formal suite 的 prerequisite tree 与 canonical gate 一致，允许最小范围回写 `docs/dev/specs/FR-0026-xhs-detail-canonical-identity/**`

## TDD 范围

- 当前 formal suite 不进入实现代码 TDD。
- replacement implementation 在消费本 FR 后，至少应补齐以下测试矩阵：
  - admitted matcher boundary 固定为 current main `getDetailResponseCandidates()` 已接受的 response root / self root / direct entry / recursive nested key 家族
  - admitted template 只接受 response-side detail response candidate record 的 canonical `note_id` derivation
  - metadata-only note id 不得构成 admitted success evidence
  - `source_note_id` / referrer 只能停留在 candidate-only observation
  - detail path implementation-ready gate 必须消费 `FR-0025`、`FR-0026`、`#508` 与本 FR

## 并行 / 串行关系

- 可并行：
  - 其他不触碰 `FR-0028` 套件的 spec / impl 工作
- 串行 / 依赖：
- replacement implementation 的 detail admitted template 路径必须在本 FR formal freeze 后才能宣告 implementation-ready
- 本 FR 必须与 `FR-0025`、`FR-0026`、`#508` 一起构成 detail replacement path 的 formal prerequisite 组合

## 进入实现前条件

- reviewer 确认 admitted detail capture-side canonical `note_id` derivation 已冻结为 response-side note record only。
- reviewer 确认 `source_note_id`、referrer、metadata-only note field 没有被提升为 admitted canonical truth。
- reviewer 确认本 FR 未越权冻结 shared reuse semantics。
- reviewer 确认 replacement implementation 的 detail formal gate 已明确消费本 FR。
- 只有在 spec review 通过后，replacement implementation 才允许把 detail admitted template path 标记为 implementation-ready，并在实现 PR 中消费本 FR。
