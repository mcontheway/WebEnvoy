# FR-0024 实施计划

## 实施目标

本轮只做 `#512` maintenance lane：把 `FR-0024` 的 search-side observation schema 回写成与 `#509 / FR-0027` shared reuse contract 兼容的单一 truth，同时保持 `FR-0024 / #502` 仍是 search-only owner。

## 分阶段拆分

### 阶段 1：search-side compatibility/backwrite 收口

- 产出：`spec.md`、`contracts/request-context-shape.md`、`data-model.md`
- 重点：补齐 `RejectedRequestContextObservation` 的最小兼容字段、增加 route-bucket `RouteBucketIncompatibleObservation`、收口 `TemplateLookupResult` 的 `shape_mismatch` 语义

### 阶段 2：maintenance-only 叙述同步

- 产出：`plan.md`、`TODO.md`，必要时补最小 `risks.md`
- 重点：把本轮明确写成 `#512` 的 search-side compatibility/backwrite maintenance，不扩成 shared owner、本体实现或 detail defer/freeze

### 阶段 3：GitHub maintenance PR 准备

- 产出：`#512` maintenance PR、纯度门禁记录、PR 结构化元数据
- 重点：确保 PR 只承载 `FR-0024` compatibility/backwrite truth，不混入 `FR-0027` owner truth、`FR-0028`、runtime 实现或 `#445/#501` closeout

## 实现约束

- 不修改 runtime、extension、CLI、测试实现或真实执行路径代码。
- 不修改 `.github/spec-issue-sync-map.yml`。
- 不修改任何 `FR-0027` / `FR-0028` 本地文件。
- 不把 `FR-0024` 扩写成 shared request-context reuse owner；shared owner 继续属于 `#508 / FR-0027`。
- 不承接 detail rejected-source defer/freeze；该阻断继续留在 `#508/#510` 链路。
- 不改变 public CLI/API surface。
- 不把 `CapturedRequestTemplateRecord` 扩写为持久化 replay/store truth。
- 不推进 `#445` closeout、`#501` superseded 收口或 `#489/#500` 实现修复。

## 测试与验证策略

- 规约对照：
  - 对照 `vision.md` 与 `docs/dev/architecture/system-design/read-write.md`，确认本轮仍在浏览器内页面请求上下文边界内
  - 对照 `FR-0018`，确认 page-local artifact 未漂移成 replay truth
  - 对照 `#502`、`#508`、`#509`、`#510`，确认本轮只解决 search-side compatibility/backwrite 冲突
- 文档门禁：
  - `bash scripts/docs-guard.sh`
  - `bash scripts/spec-guard.sh`
  - `bash scripts/check-pr-purity.sh docs/issue-512-fr0024-compat-backwrite main`
  - `git diff --check`
- PR 校验：
  - `Closing` 使用 `Fixes #512`
  - `Refs #502 #508 #509 #510`
  - `gate_applicability.review_lane=formal_spec_review_pr`
  - `live_evidence_record=N/A`
  - `integration_check` 按 local-only maintenance/spec review 路径填写

## TDD 范围

- 当前 maintenance PR 不进入实现代码 TDD。
- 后续实现或 refresh 验证至少应覆盖：
  - success-only sibling-shape mismatch 走 route-bucket `incompatible`
  - rejected-only sibling-shape 走 `miss(reason="shape_mismatch")`
  - `rejected_source` 仍只绑定同 namespace、同 `shape_key` 槽位
  - `template_missing` 不再吞掉 route-bucket `shape_mismatch`

## 并行 / 串行关系

- 可并行：
  - 不触碰 `FR-0024` 套件的 formal / implementation 事项
  - `#508` / `#509` 之外的其他 formal 事项
- 串行 / 依赖：
  - `#512` merge 前，不 refresh `#509`
  - `#512` merge 后，必须回到 `#509` refresh latest main 并 rerun guardian，验证 FR-0024 相关 finding 已消失
  - `#508` / `#509` 的剩余收口只能在完成这次 maintenance 后继续推进

## 进入实现前条件

- `#512` maintenance PR 已通过 spec review。
- reviewer 确认 `FR-0024 / #502` 仍保持 search-only owner，不替代 `#508 / FR-0027`。
- reviewer 确认 `RejectedRequestContextObservation` 已补齐 shared-compatible 最小字段：`source_kind`、`request_status`。
- reviewer 确认 success-only sibling-shape mismatch 已冻结为 route-bucket `RouteBucketIncompatibleObservation`。
- reviewer 确认 rejected-only sibling-shape 仍返回 `miss(reason="shape_mismatch")` 并映射到 `request_context_incompatible`，而不是被压扁成 `template_missing`。
- reviewer 确认 `rejected_source` 继续只来自同 namespace、同 `shape_key` 槽位。
- reviewer 确认本轮没有承接 `xhs.detail` / `xhs.user_home` shared owner、detail rejected-source defer/freeze 或 `#510` derivation truth。
