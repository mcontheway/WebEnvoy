## 摘要

- 变更目的：
- 主要改动：

## 关联事项

- Issue: {{ISSUE}}
- Closing: {{CLOSING}}

## 风险级别

- `{{RISK_LEVEL}}`
- 判断依据：{{RISK_REASON}}

## 验证

- 已执行：
- 未执行：

## integration_check

- integration_applicable（`yes` / `no`）:
- integration_touchpoint（`none` / `check_required` / `active` / `blocked` / `resolved`）:
- integration_ref:
- shared_contract_changed（`yes` / `no`）:
- external_dependency（`none` / `syvert` / `webenvoy` / `both`）:
- merge_gate（`local_only` / `integration_check_required`）:
- contract_surface（`none` / `execution_provider` / `ids_trace` / `errors` / `raw_normalized` / `diagnostics_observability` / `runtime_modes` / `integration_governance`）:
- joint_acceptance_needed（`yes` / `no`）:
- integration_status_checked_before_pr（`yes` / `no`）:
- integration_status_checked_before_merge（`yes` / `no`）:

补充说明：

- `integration_applicable=no` 时，`integration_ref` 填 `none`；只有 `integration_applicable=yes` 时，`integration_ref` 才必须指向可核查的具体 integration issue / project item，而不是只写 project 根链接。
- `integration_applicable=yes` 时，`integration_touchpoint`、`merge_gate` 与 `contract_surface` 不得留空。
- `integration_touchpoint` 为 `check_required` / `active` / `blocked`、`shared_contract_changed=yes`、`external_dependency != none`、`joint_acceptance_needed=yes`，或当前 PR 改 integration gate / review 语义时，当前事项 / PR 的 `merge_gate` 必须按 `integration_check_required` 收口。
- 只有 `integration_touchpoint=resolved` 且 `shared_contract_changed=no`、`external_dependency=none`、`joint_acceptance_needed=no`，并且当前 PR 未改 integration gate / review 语义时，才可继续使用 `merge_gate=local_only`；其余场景保持 `integration_check_required`。
- 若当前 PR 改 integration gate / review 语义、联合验收口径或其他共享协作契约，`contract_surface` 不得写 `none`；治理型 gate / review 语义变更统一写 `integration_governance`，其他场景填写最接近的共享表面。
- merge 前必须再次核对 `integration_ref` 对应 integration issue / project item 的状态、依赖与联合验收约束。

## gate_applicability（对 formal spec review PR、live evidence 治理落库/治理维护 PR，以及所有落入真实 live evidence 专项门禁的 PR 必填）

- review_lane（`general_pr` / `formal_spec_review_pr` / `governance_landing_pr` / `governance_maintenance_pr`）:
- governance_context_issue_ref（仅治理相关 lane 使用；`#310` 仅用于 `governance_landing_pr`；其他治理维护使用独立 issue；非治理场景写 `null`）:
- governance_scope_targets（仅治理相关 lane 时填写冻结目标文件数组；必须精确列出 `AGENTS.md`、`docs/dev/AGENTS.md`、`code_review.md`、`docs/dev/review/guardian-review-addendum.md`、`.github/PULL_REQUEST_TEMPLATE.md`；其他场景写 `[]`）:
- in_scope（`true` / `false`）:
- trigger_reasons（命中触发原因时填写数组；不适用写 `[]`）:
- n_a_allowed（`true` / `false`）:

补充说明：

- 只有在当前 PR 实际变更精确等于上述五个冻结治理目标文件时，治理相关 lane 才成立；子集、超集或缺少 `governance_context_issue_ref` 都必须视为阻断
- `review_lane=governance_landing_pr` 仅当 `governance_context_issue_ref=#310` 时成立；`review_lane=governance_maintenance_pr` 仅当 `governance_context_issue_ref` 非空且不等于 `#310` 时成立
- 若当前 PR 同时触碰 FR-0016 正式契约文件或 `docs/dev/specs/FR-0016-live-evidence-governance-gate/TODO.md`，且又触碰任一治理目标文件，必须拆分；不要继续在同一 PR 混合 spec 与治理范围
- `governance_landing_pr` 在 formal spec review 通过前必须保持 blocked；该 lane 即使 `in_scope=false` 且 `live_evidence_record=N/A`，也不能绕过此前置条件

## live_evidence_record（仅当 `gate_applicability.in_scope=true` 时必填；若 `in_scope=false && n_a_allowed=true`，整块可写 `N/A` 或 `null`）

- latest_head_sha:
- profile:
- browser_channel:
- execution_surface（`real_browser` / `stub` / `fake_host` / `other`）:
- page_url:
- target_tab_id:
- run_id:
- evidence_collected_at（当前 latest head 这次 fresh rerun 的 RFC 3339 UTC 时间）:
- artifact_identity:
- relay_path:
- interaction_locator（或等价交互/观测定位）:
- success_signals:
- minimum_replay:
- artifact_log_ref:
- failure_reason（成功填 `N/A`）:
- blocker_level（成功填 `N/A`）:

补充说明：

- latest-head 门禁以 PR 描述中的 `live_evidence_record` 为准；仓库 formal 文档中的固定样本、历史失败事实或已固化 run 记录，只要未被误写成当前 latest-head gate evidence，就不需要逐提交追写当前 PR head SHA

## 作者执行现场自述（供 review 参考）

- 本次执行现场：
- worktree / clone 路径：
- 是否保持单 worktree 单 issue/PR：
- PR 创建后是否扩 scope（如有，拆分到哪一个 PR）：
- 纯度预检门禁执行记录（命令与结果）：

## 回滚

- 回滚方式：{{ROLLBACK}}

## 检查清单

- [ ] 已确认本 PR 不直接推送主分支
- [ ] 已确认标题和提交信息符合中文 Conventional Commits 约束
- [ ] 已补充与风险相匹配的验证证据
- [ ] 如有对应 Issue，已在 PR 描述中显式写出正确的关闭语义（`Fixes #...` 或 `Refs #...`）
- [ ] 若本 PR 属于 formal spec review PR、live evidence 治理落库/治理维护 PR 或落入真实 live evidence 专项门禁，已补齐 `gate_applicability`
- [ ] 若本 PR 属于治理相关 lane，已确认 `governance_context_issue_ref`、`review_lane`、精确五文件治理范围与 closing 语义彼此一致，且未混入 FR-0016 formal spec / `docs/dev/specs/FR-0016-live-evidence-governance-gate/TODO.md` 范围
- [ ] 若本 PR 落入真实 live evidence 专项门禁，已补齐 latest head 的有效 `live_evidence_record`，且未把 stub/fake host、`runtime.ping` 或 `runtime.bootstrap` 误写为真实闭环证据
- [ ] 若事项触及跨仓共享契约、跨仓依赖、联合验收，或当前 PR 改 integration gate / review 语义，PR 描述已补齐 `integration_check`，且提 PR 前与合并前都核对过 `integration_ref`
- [ ] 如涉及 FR / 架构 / 高风险目录，已补充必要上下文与影响说明
- [ ] 如涉及正式 spec / 架构规约，已先完成 spec review，且未与实现代码混在同一 PR
- [ ] 如本 PR 是正式套件起草 / 修订，已补齐 GWT、异常场景、测试策略与 TDD 范围
- [ ] 作者已填写“执行现场自述”，并提供可复核的纯度预检记录
