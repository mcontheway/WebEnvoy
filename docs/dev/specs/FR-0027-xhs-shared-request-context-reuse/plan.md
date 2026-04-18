# FR-0027 实施计划

## 实施目标

冻结 XHS read family 的 shared request-context reuse semantics，补齐 replacement implementation 在 `#502/#504/#505` 之外仍缺失的 formal gate，让后续实现不再自行决定 page-local namespace、route bucket、`shape_key`、bucket state、detail `note_id` derivation 与 fail-closed 规则。

## 分阶段拆分

### 阶段 1：shared model scope 收敛

- 产出：`spec.md`
- 重点：把 `#503/#504/#505` 已冻结内容与尚未拥有的 shared reuse semantics 拆清，避免 formal owner 重叠

### 阶段 2：共享契约冻结

- 产出：`contracts/request-context-reuse.md`、`data-model.md`
- 重点：冻结 page-local `page_context_namespace`、route bucket、shape slot、bucket state 与 read-family canonical shape

### 阶段 3：风险与 gate 收口

- 产出：`risks.md`、`TODO.md`
- 重点：明确 replacement implementation 进入实现前必须等待 `#508`，并防止实现 PR 越权定规则

### 阶段 4：spec review PR 准备

- 产出：spec-only Draft PR、纯度门禁记录、PR 结构化元数据
- 重点：确保 PR 只承载 `FR-0027` formal suite 与 issue-sync map，不混实现代码

## 实现约束

- 不修改 runtime、extension、CLI 或测试实现代码。
- 不重写 `FR-0024` search-only formal truth。
- 不重写 `FR-0025` command surface / request-context baseline。
- 不重写 `#505` 的 detail identity-only formal freeze。
- 不在本 PR 中混入 `#489/#500` 实现修复、`#445` closeout 或 latest-main rerun。

## 测试与验证策略

- 规约对照：
  - 对照 `FR-0024`，确认 search-only shape 与 search fail-closed 规则不被重开
  - 对照 `FR-0025`，确认 command surface / request-context baseline 继续由 `#504` 承载
  - 对照 `#505` 当前 issue truth，确认 detail identity 继续独立于 shared reuse semantics
  - 对照 replacement implementation 与相关测试，确认 shared slotting / bucket state / freshness 字段 / rejected-source / detail `note_id` derivation 语义已成为必须 formalize 的输入
- 文档门禁：
  - `bash scripts/docs-guard.sh`
  - `bash scripts/spec-guard.sh`
  - `bash scripts/check-pr-purity.sh docs/FR-0027-xhs-shared-request-context-reuse main`
  - `git diff --check`
- PR 校验：
  - `Closing=Refs #508`
  - `gate_applicability.review_lane=formal_spec_review_pr`
  - `live_evidence_record=N/A`

## TDD 范围

- 当前 formal suite 不进入实现代码 TDD。
- 后续 replacement implementation 至少应补齐以下测试矩阵：
  - detail/user_home 的 page-local namespace、route bucket 与 shape slotting
  - admitted / rejected / incompatible bucket state 分层与最小结构字段
  - synthetic / failed source 不进入 admitted template
  - detail capture-side `note_id` derivation 不回退到 `source_note_id`
  - exact-match / freshness / fail-closed diagnostics
  - replacement implementation 不绕开 `#508` formal truth

## 并行 / 串行关系

- 可并行：
  - `#505 / FR-0026` 的 formal review
  - 不触碰 shared reuse semantics 的其他 formal / implementation 事项
- 串行 / 依赖：
- replacement implementation PR 必须等待 `#502/#504/#505/#508` formal freeze 全部完成
  - `#445` closeout 必须等待 replacement implementation merge 与 latest-main rerun

## 进入实现前条件

- FR-0027 spec review 通过。
- reviewer 确认 `#502/#504/#505/#508` 的 formal owner 已无重叠或缺口。
- reviewer 确认 page-local namespace、route bucket、shape slot、bucket state、exact-match / freshness / fail-closed 已冻结为 shared reuse truth。
- reviewer 确认 detail/user_home canonical reuse-shape 已冻结为 `note_id` / `user_id` only，且 detail capture-side `note_id` derivation 已先冻结，并与 `#505` 不冲突。
- reviewer 确认 replacement implementation formal gate 已更新为必须等待 `#508`。
