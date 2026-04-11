# FR-0016 实施计划

## 实施目标

本 FR 的实施目标不是继续补写 `#311` 的治理文案，而是先为 `#310` 输出 formal spec review 输入。该输入必须让后续治理落库 PR 可以直接按统一结论更新根级规范、开发区规范、review 基线、guardian 常驻审查摘要与 PR 模板，而不再在实现 PR 中临时讨论触发条件、字段清单、阻断规则或关闭语义。

## 分阶段拆分

### 阶段 1：冻结治理范围与适用边界

- 产出：
  - `spec.md`
  - `research.md`
- 目标：
  - 冻结哪些 PR 落入 live evidence 专项门禁，哪些 PR 不落入。
  - 冻结 issue `#310` 与现有 PR `#311` 的角色边界。

### 阶段 2：冻结共享契约与阻断口径

- 产出：
  - `contracts/live-evidence-gate.md`
  - `data-model.md`
  - `risks.md`
- 目标：
  - 冻结最低 live evidence 元数据契约。
  - 冻结 reviewer / guardian / merge-ready / closing semantics 的共享阻断条件。

### 阶段 3：冻结落库顺序与 split 约束

- 产出：
  - `TODO.md`
- 目标：
  - 明确 formal spec review PR 与治理落库 PR 的拆分要求。
  - 明确后续 `#311` 或其替代 PR 只能承接已冻结结论，不得继续扩 scope。

## 实现约束

1. 不得在本 FR 中直接修改 runtime、extension、CLI、tests 或任何 live 验证脚本。
2. 不得把 live evidence 门禁扩展成适用于所有 PR 的统一门禁。
3. 不得在 formal spec review PR 中混入 `AGENTS.md`、`docs/dev/AGENTS.md`、`code_review.md`、`docs/dev/review/guardian-review-addendum.md` 或 `.github/PULL_REQUEST_TEMPLATE.md` 的治理落库改动。
4. 不得允许不同文档对专项门禁适用范围采用不同触发集合。
5. 不得允许 `N/A` 在落入专项门禁的 PR 中被用作规避披露手段。
6. 不得把 `#308`、`#309` 的 runtime 或 evidence 产物要求误写成 `#310` 的实现前置。

## 测试与验证策略

本次 formal spec review PR 的验证应包括：

1. 文档与规约门禁：
  - `git diff --check`
  - `bash scripts/docs-guard.sh`
  - `bash scripts/spec-guard.sh`
2. 套件完整性检查：
  - `spec.md`、`plan.md`、`TODO.md` 已补齐
  - 高风险治理套件已补齐 `contracts/`、`data-model.md`、`research.md`、`risks.md`
3. 规约一致性检查：
  - `classification_scope` 足以让 reviewer / guardian 在不信任作者自报 lane 的前提下，先判定 spec 套件命中与治理落库目标命中
  - `mixed_spec_and_governance_scope` 对 `spec_contract_targets` 与 `todo_handoff_target` 都必须生效，确保治理落库 PR 不会再夹带 FR-0016 的 `TODO.md` handoff 回写
  - formal spec PR 只要碰任一治理落库目标文件，就必须直接触发 `mixed_spec_and_governance_scope`，不需要等到完整 landing 形态
  - `classification_scope` 对治理落库的判定必须同时消费 `governance_issue_ref=#310`，避免把未来其他治理文件修订误吸进 FR-0016 landing lane
  - `governance_landing_pr` 与 `governance_maintenance_pr` 都必须以完整五文件落库为前提，不能被任一单文件或子集落库 PR 提前占用 lane 与 closing semantics
  - 未来其他命中五处治理目标文件的维护 PR，必须显式提供 `gate_applicability.governance_context_issue_ref`，并由 reviewer / guardian 机器化归入 `governance_maintenance_pr`
  - formal spec review PR、governance landing PR、governance maintenance PR 与所有 `in_scope=true` PR 缺少 `gate_applicability` 时必须直接 blocked，不能靠 reviewer/guardian 事后脑补
  - FR-0016 `TODO.md` 只作为 handoff 文件存在，不再作为治理落库 lane 的同行例外；若需要更新停点或恢复说明，必须拆到独立 PR
  - `governance_landing_pr` 与 `governance_maintenance_pr` 都必须是精确五文件落库范围，不能夹带其他实质性改动
  - 精确命中五个治理落库目标文件却缺少 `governance_context_issue_ref` 时，必须直接 blocked，不能降格成普通 PR
  - `governance_landing_pr` 即使 `not_applicable`，closing semantics 也只能是 `Refs #310` 或 `Fixes #310`，不得退成 `n_a`
  - `governance_maintenance_pr` 即使 `not_applicable`，closing semantics 也只能引用其 `governance_context_issue_ref`，不得退成 `n_a`
  - 带 `#310` 上下文但只命中治理目标文件子集、或在五文件之外扩 scope 的 PR，也必须直接 blocked，不能退回普通 PR
  - docs-only closeout PR 的 latest-head gate evidence 必须以 PR 描述中的 `live_evidence_record` 为准；仓库 formal 文档中的固定样本不得被要求逐提交追写当前 PR head SHA
  - `spec.md`、`contracts/` 与 `risks.md` 对专项门禁触发条件保持同一集合
  - `Fixes` / `Refs` 与 `merge-ready` 的 live evidence 条件保持一致
  - `review_lane` 足以机器化地区分 `formal_spec_review_pr`、`governance_landing_pr`、`governance_maintenance_pr` 与 `general_pr`
  - `governance_scope_targets` 足以让 reviewer / guardian 机器化校验治理落库 lane，不被自报 `general_pr` 绕过
  - `mixed_spec_and_governance_scope` 足以让 reviewer / guardian 机器化阻断 spec review PR 与治理落库 PR 的重新混线
  - PR 描述中的结构化元数据必须对专项门禁 PR、formal spec review PR、governance landing PR 与 governance maintenance PR 承载 `gate_applicability`，且对 in-scope PR 额外承载条件化 `live_evidence_record`
  - `latest_head_sha`、`run_id`、`evidence_collected_at`、`artifact_identity` 与 `artifact_log_ref` 能共同区分“当前 latest head fresh rerun”与“同一 head 的历史 artifact”
4. 后续治理落库 PR 的最小验证要求：
  - 根级规范、开发区规范、review 基线与 PR 模板使用同一触发集合
  - guardian 常驻审查摘要 `docs/dev/review/guardian-review-addendum.md` 与上述治理文案使用同一触发集合和阻断口径
  - 即使 live evidence 区块填写 `N/A`，治理落库 PR 也必须显式提供 `gate_applicability.review_lane/in_scope/trigger_reasons/n_a_allowed`
  - `live_evidence_record` 的最小定位字段必须使用中性命名，不能把 write-flow 专用 locator 冻结成所有 in-scope PR 的统一必填项
  - 最低字段清单必须完整覆盖 `contracts/live-evidence-gate.md` 已冻结的全部 `live_evidence_record` 字段，且只可追加、不可删减或降格为可选
  - reviewer / guardian 必须能用 `run_id`、`evidence_collected_at`、`artifact_identity` 与 `artifact_log_ref` 排除“同一 latest head 下复用历史 artifact”的假新鲜复验
  - formal spec review PR 无论 `ready` 还是 `not_applicable` 都不得使用 `Fixes #...` 提前关闭治理落库 issue
  - `N/A` 仅在非适用 PR 中出现
  - review/guardian 文案能直接阻断 stub/fake host、旧 head、`runtime.ping`、`runtime.bootstrap`

## TDD 范围

本 FR 为 spec-only 治理事项，不要求新增代码级测试。

后续治理落库 PR 若引入脚本或自动校验器，再单独定义其测试范围；当前不在本 FR 内承接。

## 并行 / 串行关系

- 可并行：
  - formal spec 文档起草
  - 现有 PR / review blocker 对照梳理
- 串行：
  - 必须先完成 FR-0016 的 spec review，才能继续推进 live evidence 门禁落库 PR。
  - 必须先冻结 shared contract，才能回写 `AGENTS.md`、`docs/dev/AGENTS.md`、`code_review.md`、`docs/dev/review/guardian-review-addendum.md` 与 PR 模板。
  - 若当前 `#311` 继续存在，必须先明确其不具备 merge-ready 资格，再决定是关闭、重开为 Draft，还是拆出新的落库 PR。
- 明确拆开：
  - formal spec review PR 与治理落库 PR 必须拆开。
  - runtime / evidence 实现事项（如 `#308`、`#309`）不得混入 FR-0016 的后续落库链路。

## 进入实现前条件

1. FR-0016 的 formal spec review 已通过，reviewer 明确认可其足以支撑 `#310` 治理落库。
2. `contracts/live-evidence-gate.md` 与 `risks.md` 已被 reviewer 认可，能够解释适用范围、最低字段、无效 evidence 与阻断条件。
3. 后续治理落库 PR 明确只更新 `AGENTS.md`、`docs/dev/AGENTS.md`、`code_review.md`、`docs/dev/review/guardian-review-addendum.md` 与 `.github/PULL_REQUEST_TEMPLATE.md`，不混入其他治理或 runtime 改动。
4. 后续治理落库 PR 若尚未完整满足 `#310` 关闭条件，继续使用 `Refs #310`；若该 PR 已按 FR-0016 完整落库五处治理文案并满足 `#310` 关闭条件，则必须改用 `Fixes #310`，不保留“已闭环但仍用 Refs”的例外口径。
5. 在这些条件满足前，当前 `#311` 或其替代 PR 不得申报 `merge-ready`。
