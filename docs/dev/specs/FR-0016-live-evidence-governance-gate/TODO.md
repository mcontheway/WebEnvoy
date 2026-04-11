# FR-0016 TODO

> GitHub Issue / PR / Project 是进度真相源。
> 本文件只保留 FR-0016 formal blocker、拆分要求和进入治理落库前条件，不维护本地完成态账本。

## Review 阶段待办

- [ ] 若继续修订 FR-0016 formal 文档，先确认本 FR 只承接 `#310` 的治理输入冻结，不把 TODO 扩写为治理落库执行清单。
- [ ] 若需要调整专项门禁触发条件，先同时核对 `spec.md`、`contracts/live-evidence-gate.md` 与 `risks.md`，避免再次出现文档间口径漂移。
- [ ] 若需要修订 `N/A`、`Fixes` / `Refs` 或 `merge-ready` 语义，先确认 reviewer / guardian / PR 模板三者是否仍引用同一套前提。
- [ ] 若 `#455` 这类 follow-up 需要修复 docs-only governance maintenance / closeout 阻断，先在 formal contract 中明确 `governance_landing_pr`、`governance_maintenance_pr` 与 `governance_context_issue_ref` 的边界，再进入五文件治理回写。
- [ ] 若 `#455` 这类 follow-up 需要处理 latest-head 自指阻断，先冻结“PR 级 `live_evidence_record` 承载当前 gate evidence，仓库 formal 文档可保留固定样本”的分层，不在治理落库 PR 中临时口头解释。

## 进入治理落库前条件

- [ ] FR-0016 的 spec review 已通过，且 reviewer 明确认可“formal spec PR 与治理落库 PR 分离”。
- [ ] `contracts/live-evidence-gate.md` 已冻结最低字段、适用范围与无效 evidence 集合，不再依赖口头补充。
- [ ] 当前 `#311` 已根据 formal 结论做出后续动作：关闭、转 Draft，或拆成新的治理落库 PR；不得继续以“缺 formal 输入”的状态申报可合并。
- [ ] 后续治理落库 PR 已明确只承接 `.github/PULL_REQUEST_TEMPLATE.md`、`AGENTS.md`、`code_review.md`、`docs/dev/AGENTS.md`、`docs/dev/review/guardian-review-addendum.md` 五处同类回写，不混入其他治理事项。
- [ ] 后续治理落库 PR 的 closing semantics 已按实际闭环程度选择：未完整满足 `#310` 关闭条件时使用 `Refs #310`；若已完整落库五处治理文案并满足关闭条件，则使用 `Fixes #310`。
- [ ] 若是 `#455` 这类后续治理维护，精确命中五文件时必须显式提供 `governance_context_issue_ref`，并由 reviewer / guardian 机器化判定进入 `governance_maintenance_pr`；不得继续依赖口头说明。

## 实现停点

- [ ] formal spec review 未通过前，停在 FR-0016 套件，不继续扩写 live evidence 门禁实现文案。
- [ ] 若 reviewer 认为 `#310` 仍缺更上位架构输入，先回到 formal 规约链路，不在 `#311` 中继续补门禁措辞。
- [ ] 若后续治理落库 PR 再次混入 spec-only 以外的 scope，必须拆 PR，而不是在 TODO 中继续记录例外。
- [ ] 若 docs-only closeout PR 再次因为仓库 formal 文档未追写当前 PR head SHA 被阻断，先回到 FR-0016 contract 核对 PR 级 gate evidence 语义，而不是继续追写仓库固定样本。
