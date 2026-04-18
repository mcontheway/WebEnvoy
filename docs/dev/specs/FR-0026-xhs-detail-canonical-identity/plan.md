# FR-0026 实施计划

## 实施目标

冻结 current v1 `xhs.detail` canonical identity 只包含 `note_id`，明确 `image_scenes` 当前不进入 identity，并明确 current synthetic / candidate 证据仍不足以 formalize `source_note_id` 的 admitted canonical mapping，同时堵住未冻结 reuse 语义被单独实现 PR 越权定义的路径。

## 分阶段拆分

### 阶段 1：仓库内证据收敛

- 产出：`research.md`
- 重点：收口 current runtime/tests 只围绕 `note_id` 工作、当前 observed `source_note_id` 仍停留在 synthetic / candidate / failed 证据层而不足以扩写成 admitted canonical mapping 或更广 transport alias / route truth、以及仓库内缺少 `image_scenes` admission-ready 证据这一事实

### 阶段 2：identity contract 冻结

- 产出：`spec.md`、`contracts/detail-canonical-identity.md`
- 重点：冻结 `note_id` only identity，以及 non-identity 字段边界

### 阶段 3：风险与准入条件收口

- 产出：`risks.md`、`TODO.md`
- 重点：防止后续实现 PR 擅自把 `image_scenes` 写入 identity，并明确 future spec revision 与 deferred reuse 语义都必须先经过 formal spec review；其中 shared reuse semantics 由 `#508` 接管

### 阶段 4：spec review PR 准备

- 产出：spec-only Draft PR、纯度门禁记录、PR 结构化元数据
- 重点：确保 PR 只承载 `FR-0026` formal suite 与 issue-sync map，不混实现代码

## 实现约束

- 不修改 runtime、extension、CLI、测试实现或真实执行路径代码。
- 不重写 `#504` 的 command surface / request-context baseline，也不把未冻结的 request-shape / reuse 语义错误回指给 `#504`。
- 不重写 `FR-0024` 的 search-only contract。
- 不在当前 PR 中推进 `#500` 修复、`#445` closeout、latest-main rerun 或 live evidence。
- 不提前承诺 future identity expansion。

## 测试与验证策略

- 规约对照：
  - 对照 `src/commands/xhs-input.ts`、`src/commands/xhs-runtime.ts`，确认 current implementation 只以 `note_id` 作为 detail command input 的稳定锚点
  - 对照 `extension/xhs-read-execution.ts` 与 `tests/xhs-read-execution.fallback.test.ts`，确认当前只存在 synthetic request 侧 `source_note_id` 证据；再对照 `FR-0005` 研究中的 detail primary candidate/failure 记录，确认 admitted canonical mapping 证据仍缺失
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
- 在 `#508` formal freeze 冻结相关共享规则后，后续实现 PR 至少应补齐以下测试矩阵：
  - `note_id` only identity 不回退
  - `source_note_id` 继续不进入 frozen identity baseline，也不得在缺少 admission-ready 证据时被实现侧擅自提升为 admitted canonical mapping
  - `image_scenes` 不进入 canonical identity anchor，也不成为额外 identity discriminator
  - future revision 前，不得把 `image_scenes` 的 placement 或其他非目标语义误写成 current v1 formal truth

## 并行 / 串行关系

- 可并行：
  - `#504` 的 formal review
  - 其他不触碰 `FR-0026` 套件的 formal / implementation 事项
- 串行 / 依赖：
- 替代 `#501` 的新实现 PR 必须等待 `#504` / `#505` / `#508` 的 formal freeze 都完成
  - `#445` closeout 必须等待新实现 PR merge 与 latest-main rerun

## 进入实现前条件

- FR-0026 spec review 通过。
- reviewer 确认 current v1 detail identity 只包含 `note_id`。
- reviewer 确认 `source_note_id` 未被提升为 frozen identity baseline、第二个 identity 字段、admitted canonical mapping 或更广 transport alias / route truth。
- reviewer 确认 `image_scenes` 当前已被冻结为 not-in-identity。
- reviewer 确认本 FR 未把 `image_scenes` 的 placement 或其他非目标语义扩写成 current v1 formal truth。
- reviewer 确认本 FR 未把 compatibility、rejected-source matching、template reuse 等 identity 之外的 detail matching 语义预先冻结为 formal truth，也未把它们错误回指给 `#504`。
- reviewer 确认 future identity expansion 或 request/artifact canonical mapping / alias freeze 必须等待新的仓库内证据和新的 spec 修订。
- reviewer 确认 detail request-shape truth、shape_key、lookup slotting、route eligibility 与 reuse 语义如需冻结，必须先经过 `#508` 对应的 formal spec review，而不是留给单独实现 PR 自行决定。
