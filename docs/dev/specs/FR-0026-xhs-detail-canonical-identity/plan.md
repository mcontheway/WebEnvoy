# FR-0026 实施计划

## 实施目标

冻结 current v1 `xhs.detail` canonical identity 只包含 `note_id`，明确 `image_scenes` 当前不进入 identity，并保留 `source_note_id` 仍未 formalize 的边界，为后续实现 PR 提供不可歧义的 identity 基线。

## 分阶段拆分

### 阶段 1：仓库内证据收敛

- 产出：`research.md`
- 重点：收口 current runtime/tests 只围绕 `note_id` 工作、`source_note_id` 尚不足以 formalize 为 identity truth、以及仓库内缺少 `image_scenes` admission-ready 证据这一事实

### 阶段 2：identity contract 冻结

- 产出：`spec.md`、`contracts/detail-canonical-identity.md`
- 重点：冻结 `note_id` only identity，以及 non-identity 字段边界

### 阶段 3：风险与准入条件收口

- 产出：`risks.md`、`TODO.md`
- 重点：防止后续实现 PR 擅自把 `image_scenes` 写入 identity，并明确 future spec revision 的准入条件

### 阶段 4：spec review PR 准备

- 产出：spec-only Draft PR、纯度门禁记录、PR 结构化元数据
- 重点：确保 PR 只承载 `FR-0026` formal suite 与 issue-sync map，不混实现代码

## 实现约束

- 不修改 runtime、extension、CLI、测试实现或真实执行路径代码。
- 不重写 `#504` 的 command surface / request-context baseline，也不把其行为前提写成 current main formal truth。
- 不重写 `FR-0024` 的 search-only contract。
- 不在当前 PR 中推进 `#500` 修复、`#445` closeout、latest-main rerun 或 live evidence。
- 不提前承诺 future identity expansion。

## 测试与验证策略

- 规约对照：
  - 对照 `src/commands/xhs-input.ts`、`src/commands/xhs-runtime.ts`，确认 current implementation 只以 `note_id` 作为 detail command input 的稳定锚点
  - 对照 `extension/xhs-read-execution.ts` 与 `tests/xhs-read-execution.fallback.test.ts`，确认当前只存在 request-side field 观测，尚不足以把 `source_note_id` formalize 为 verified transport truth
  - 对照 `tests/content-script-handler.xhs-read.contract.test.ts`、`tests/extension.service-worker.gate-approval.suite.ts`、`tests/xhs-read-execution.fallback.test.ts`，确认 in-tree tests 没有把 `image_scenes` 写成 identity 前提
  - 对照 `FR-0024` research，确认 `image_scenes` 缺少仓库内 admission-ready 证据
- 文档门禁：
  - `bash scripts/docs-guard.sh`
  - `bash scripts/spec-guard.sh`
  - `bash scripts/check-pr-purity.sh docs/FR-0026-xhs-detail-canonical-identity main`
  - `git diff --check`
- PR 校验：
  - `Closing=Refs #505`
  - `gate_applicability.review_lane=formal_spec_review_pr`
  - `live_evidence_record=N/A`

## TDD 范围

- 当前 formal suite 不进入实现代码 TDD。
- 后续实现 PR 至少应补齐以下测试矩阵：
  - `note_id` only identity 不回退
  - `source_note_id` 继续不进入 current v1 formal identity truth
  - `image_scenes` 不进入 canonical identity anchor，也不成为额外 identity discriminator
  - future revision 前，不得把 `image_scenes` 的 placement 或非 identity shape 误写成 current v1 formal truth

## 并行 / 串行关系

- 可并行：
  - `#504` 的 formal review
  - 其他不触碰 `FR-0026` 套件的 formal / implementation 事项
- 串行 / 依赖：
  - 替代 `#501` 的新实现 PR 必须等待 `FR-0025` 与 `FR-0026` 都通过 spec review
  - `#445` closeout 必须等待新实现 PR merge 与 latest-main rerun

## 进入实现前条件

- FR-0026 spec review 通过。
- reviewer 确认 current v1 detail identity 只包含 `note_id`。
- reviewer 确认 `source_note_id` 当前仍未被 formalize 为 verified transport truth 或 identity normalization 规则。
- reviewer 确认 `image_scenes` 当前只被冻结为 not-in-identity，而未被扩写成 placement 或非 identity shape 真相。
- reviewer 确认本 FR 未把完整 detail shape / lookup / eligibility / `shape_key` 预先冻结为 formal truth。
- reviewer 确认 future identity expansion 必须等待新的仓库内证据和新的 spec 修订。
