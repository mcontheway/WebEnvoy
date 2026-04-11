# Live Evidence 治理门禁契约

## 边界与适用范围

本契约定义 FR-0016 的稳定共享对象，用于统一作者、reviewer、guardian 与 merge-ready 判定之间的 live evidence 口径。

本契约不定义：

- runtime 实现或验证脚本
- 页面交互行为本身
- GitHub Action / bot 的具体实现
- `#308` / `#309` 的 runtime 契约

## 共享对象

FR-0016 的机器判定输入至少包含以下对象：

1. `classification_scope`
2. `gate_applicability`
3. `gate_verdict`

`classification_scope` 用于在不信任作者自报 lane 的前提下，先判定 PR 是否命中 formal spec 套件或治理落库目标集合。

```json
{
  "classification_scope": {
    "spec_suite_root": "docs/dev/specs/FR-0016-live-evidence-governance-gate/",
    "spec_contract_targets": [
      "docs/dev/specs/FR-0016-live-evidence-governance-gate/spec.md",
      "docs/dev/specs/FR-0016-live-evidence-governance-gate/plan.md",
      "docs/dev/specs/FR-0016-live-evidence-governance-gate/contracts/live-evidence-gate.md",
      "docs/dev/specs/FR-0016-live-evidence-governance-gate/data-model.md",
      "docs/dev/specs/FR-0016-live-evidence-governance-gate/research.md",
      "docs/dev/specs/FR-0016-live-evidence-governance-gate/risks.md"
    ],
    "todo_handoff_target": "docs/dev/specs/FR-0016-live-evidence-governance-gate/TODO.md",
    "governance_issue_ref": "#310",
    "governance_scope_targets": [
      "AGENTS.md",
      "docs/dev/AGENTS.md",
      "code_review.md",
      "docs/dev/review/guardian-review-addendum.md",
      ".github/PULL_REQUEST_TEMPLATE.md"
    ]
  }
}
```

约束：

1. `classification_scope` 是 FR-0016 共享 contract 的固定判定输入，不依赖作者自报 `review_lane`。
2. reviewer / guardian 若发现 PR 实际变更命中 `spec_suite_root`，必须先视为 FR-0016 spec 上下文相关链路；其中只有命中 `spec_contract_targets` 的正式契约文件时，才进入 `formal_spec_review_pr` lane。
3. `spec_contract_targets` 冻结 formal spec 中承载正式契约语义的文件集合；`todo_handoff_target` 不在其中，因为它只承担停点恢复与 handoff 记录，不承载正式治理契约语义。
4. `todo_handoff_target` 不属于 `governance_landing_pr` 的允许范围；若治理落库尝试携带该文件，必须拆分为独立 PR，而不是在 landing lane 内再区分“进度回写”或“语义回写”。
5. `governance_issue_ref` 固定为 `#310`，用于限定 FR-0016 治理落库链路的 issue 上下文，避免把未来其他治理文案修订误判为本 FR 的 landing PR。
6. 若 PR 实际变更命中 `governance_scope_targets` 中任一目标文件，且 `gate_applicability.governance_context_issue_ref` 非空，但其文件范围不是“精确等于五个治理目标文件集合”，reviewer / guardian 必须产出 `invalid_governance_landing_scope`，并阻断合并。
7. 若 PR 实际变更精确等于 `governance_scope_targets` 冻结的五个目标文件集合，但 `gate_applicability.governance_context_issue_ref` 为空，reviewer / guardian 必须产出 `missing_governance_issue_ref`，并阻断合并。
8. reviewer / guardian 只有在 PR 同时满足“实际变更精确等于 `governance_scope_targets` 冻结的五个目标文件集合”与“`gate_applicability.governance_context_issue_ref=#310`”时，才能先视为 `governance_landing_pr` 相关链路；若 issue 引用非空且不等于 `#310`，则必须按 `governance_maintenance_pr` 相关链路处理。
9. 若同一 PR 同时命中 `spec_contract_targets` 中任一正式契约文件，或命中 `todo_handoff_target`，且又命中 `governance_scope_targets` 中任一治理落库目标文件，无论是否已经满足完整 landing 形态，都必须产出 `mixed_spec_and_governance_scope`，并阻断合并。

当 PR 落入专项门禁，或其 `review_lane` 属于 `formal_spec_review_pr` / `governance_landing_pr` / `governance_maintenance_pr` 时，门禁共享输出还至少包含以下对象：

1. `gate_applicability`
2. `gate_verdict`

`live_evidence_record` 是条件必选对象：

- 当 `gate_applicability.in_scope=true` 或 `gate_applicability.n_a_allowed=false` 时，必须提供完整 `live_evidence_record`
- 当 `gate_applicability.in_scope=false` 且 `gate_applicability.n_a_allowed=true` 时，允许省略 `live_evidence_record` 或将其置为 `null`，以对应 PR 模板整块填写 `N/A` 的路径
- `live_evidence_record` 是 PR 级 latest-head fresh rerun 门禁对象；仓库内 formal 文档、研究记录或 TODO 中保留的固定样本，不是该对象的替代物

## gate_applicability

描述 PR 是否落入 live evidence 专项门禁。

```json
{
  "gate_applicability": {
    "review_lane": "general_pr",
    "governance_context_issue_ref": null,
    "governance_scope_targets": [],
    "in_scope": true,
    "trigger_reasons": [
      "merge_unblock_by_live_evidence",
      "real_runtime_claim"
    ],
    "n_a_allowed": false
  }
}
```

非适用 PR 的最小示例：

```json
{
  "gate_applicability": {
    "review_lane": "formal_spec_review_pr",
    "governance_context_issue_ref": null,
    "governance_scope_targets": [],
    "in_scope": false,
    "trigger_reasons": [],
    "n_a_allowed": true
  }
}
```

触发枚举至少包含：

- `real_runtime_claim`
- `real_page_interaction_claim`
- `live_read_write_claim`
- `issue_closure_by_live_evidence`
- `completion_claim_by_live_evidence`
- `merge_unblock_by_live_evidence`

`review_lane` 枚举：

- `general_pr`
- `formal_spec_review_pr`
- `governance_landing_pr`
- `governance_maintenance_pr`

`governance_scope_targets` 仅在 `review_lane=governance_landing_pr` 或 `review_lane=governance_maintenance_pr` 时允许非空，目标集合冻结为：

- `AGENTS.md`
- `docs/dev/AGENTS.md`
- `code_review.md`
- `docs/dev/review/guardian-review-addendum.md`
- `.github/PULL_REQUEST_TEMPLATE.md`

约束：

1. `review_lane` 必须显式填写，不得依赖 PR 标题、路径或人工上下文推断。
2. `review_lane=governance_landing_pr` 或 `review_lane=governance_maintenance_pr` 时，`governance_scope_targets` 必须非空，且只能由上述五个冻结目标文件组成；其他 lane 必须填写空数组。
3. 若 formal spec review PR、governance landing PR、governance maintenance PR 或任何 `in_scope=true` 的 PR 缺少必需的结构化 `gate_applicability` 元数据，reviewer / guardian 必须阻断，不得改用路径、标题或 issue 引用代填 PR 模板义务。
4. `governance_context_issue_ref` 仅在 `review_lane=governance_landing_pr` 或 `review_lane=governance_maintenance_pr` 时允许非空；其他 lane 必须填写 `null`。
5. 若 PR 实际变更命中 `classification_scope.governance_scope_targets` 中任一目标文件，且 `gate_applicability.governance_context_issue_ref` 非空，但其文件范围不是“精确等于五个治理目标文件集合”，reviewer / guardian 必须阻断，不得把它降格为 `general_pr`。
6. 若 PR 实际变更精确等于 `classification_scope.governance_scope_targets` 冻结的五个目标文件集合，但 `gate_applicability.governance_context_issue_ref` 为空，reviewer / guardian 必须阻断，不得把它降格为 `general_pr`。
7. 若 PR 同时满足“实际变更精确等于 `classification_scope.governance_scope_targets` 冻结的五个目标文件集合”与“`gate_applicability.governance_context_issue_ref=#310`”，reviewer / guardian 必须按 `governance_landing_pr` 处理，不得被作者自报的其他 lane 覆盖。
8. 若 PR 同时满足“实际变更精确等于 `classification_scope.governance_scope_targets` 冻结的五个目标文件集合”与“`gate_applicability.governance_context_issue_ref` 非空且不等于 `#310`”，reviewer / guardian 必须按 `governance_maintenance_pr` 处理，不得仅因路径命中退回 `general_pr`。
9. 若 PR 实际变更命中 `classification_scope.spec_contract_targets` 中任一正式契约文件，reviewer / guardian 必须按 `formal_spec_review_pr` 处理，除非同时命中 FR-0016 治理落库目标文件而触发混线阻断。
10. `in_scope=true` 时，`trigger_reasons` 必须非空。
11. `in_scope=true` 时，`n_a_allowed` 必须为 `false`。
12. `in_scope=false` 时，`trigger_reasons` 必须为空数组。
13. `in_scope=false` 时，`n_a_allowed` 必须为 `true`，以便 formal spec / 治理前置 / 纯文档 / 纯研究 PR 可以稳定填写 `N/A`，避免被默认值误挡。
14. 只有在 PR 明确不以真实 live evidence 作为 issue 关闭、完成判定或 merge 放行依据时，才允许 `in_scope=false`；即使 PR 是纯文档、纯研究 / spike 或 formal spec / design input，只要命中任一触发原因，也必须设为 `in_scope=true`。

## live_evidence_record

描述作者在 PR 中提供的最低 live evidence 元数据。

```json
{
  "live_evidence_record": {
    "latest_head_sha": "0227c64a11d58660cff87d153c79648b87664bff",
    "profile": "prod-xhs-a",
    "browser_channel": "Google Chrome stable",
    "execution_surface": "real_browser",
    "page_url": "https://example.com/editor",
    "target_tab_id": 321,
    "run_id": "gha:23953203650:1",
    "evidence_collected_at": "2026-04-01T10:12:33Z",
    "artifact_identity": "gha:23953203650:1:live-evidence.log",
    "relay_path": "cli->native-messaging->extension->content-script",
    "interaction_locator": "[data-testid='editor']",
    "success_signals": [
      "editor_updated",
      "page_reflected_change"
    ],
    "minimum_replay": "Open the page and replay the same write flow on latest head.",
    "artifact_log_ref": "actions://run/123/artifacts/live-evidence.log",
    "failure_reason": "N/A",
    "blocker_level": "N/A"
  }
}
```

非适用 PR 且 `n_a_allowed=true` 时，允许省略该对象，或显式写为：

```json
{
  "live_evidence_record": null
}
```

`execution_surface` 枚举至少包含：

- `real_browser`
- `stub`
- `fake_host`
- `other`

约束：

1. `latest_head_sha` 必须对应当前 PR latest head。
2. `execution_surface=real_browser` 才可能成为有效 live evidence；其余枚举默认无效。
3. `run_id` 必须是 provider-scoped 的稳定执行标识，格式为 `<provider>:<run-or-session-id>[:<attempt>]`；不得填写临时文案或自由文本标签。
4. `evidence_collected_at` 必须填写当前 latest head 这次 fresh rerun 的 RFC 3339 UTC 时间戳；不得复用同一 head 的历史 artifact 时间戳来冒充新鲜复验。
5. `artifact_identity` 必须是 provider-scoped 的稳定 artifact 标识，格式为 `<provider>:<run-or-session-id>[:<attempt>]:<artifact-name-or-id>`；不得填写自由文本描述。
6. `run_id`、`evidence_collected_at`、`artifact_identity` 与 `artifact_log_ref` 必须能共同指向当前 latest head 的这次 fresh rerun；若同一 head 上存在多次历史 run，旧 run 的 artifact 仍视为 `stale_head_or_artifact`。
7. 当 evidence 成功时，`failure_reason` 与 `blocker_level` 必须填写 `N/A`。
8. 当 evidence 失败或阻断时，`failure_reason` 与 `blocker_level` 必须为非空，且不得用 `N/A` 规避。
9. `interaction_locator` 必须提供与当前 live evidence 相匹配的最小交互或观测定位；不得强制要求 write-flow 专用字段去适配 runtime-only 或 read-only 场景。
10. `success_signals` 必须描述真实页面交互或真实闭环结果，不能只写控制面存活信号。
11. 仅当 `gate_applicability.in_scope=true` 或 `gate_applicability.n_a_allowed=false` 时，以上字段约束才对 `live_evidence_record` 生效；`in_scope=false && n_a_allowed=true` 的非适用 PR 可以不提供该对象。
12. reviewer / guardian 必须以 PR 描述中的 `live_evidence_record` 作为 latest-head 门禁的唯一判定输入；仓库内 formal 文档、研究记录或 TODO 中保留的固定样本，不得被要求逐提交追写当前 PR head SHA 来替代这份 PR 级元数据。
13. docs-only formal closeout PR 若在仓库文档中保留固定样本、历史失败事实或已固化 run 记录，只要这些内容没有被误写成“当前 latest head gate evidence”，就不得因为其 SHA 不等于当前 PR latest head 而被判定为 stale gate evidence。

## gate_verdict

描述 reviewer / guardian 基于同一契约得出的门禁结论。

```json
{
  "gate_verdict": {
    "status": "blocked",
    "closing_semantics": "refs_only",
    "merge_ready": false,
    "blocking_reasons": [
      "missing_latest_head_fresh_evidence",
      "invalid_execution_surface"
    ]
  }
}
```

`status` 枚举：

- `not_applicable`
- `ready`
- `blocked`

`closing_semantics` 枚举：

- `n_a`
- `refs_only`
- `fixes_allowed`

`blocking_reasons` 至少覆盖：

- `missing_latest_head_fresh_evidence`
- `invalid_execution_surface`
- `control_plane_only_signal`
- `missing_required_fields`
- `missing_gate_applicability_metadata`
- `invalid_governance_landing_scope`
- `missing_governance_issue_ref`
- `stale_head_or_artifact`
- `spec_review_not_completed`
- `mixed_spec_and_governance_scope`

约束：

1. 只要 `blocking_reasons` 非空，`status` 就必须为 `blocked`；不得因为 `gate_applicability.in_scope=false` 而把 `spec_review_not_completed` 等阻断原因降格为 `not_applicable`。
2. `status=blocked` 时，`closing_semantics` 必须为 `refs_only`，且 `merge_ready=false`。
3. `status=ready` 时，`merge_ready=true`；若 `gate_applicability.review_lane=formal_spec_review_pr`，则 `closing_semantics` 必须为 `refs_only`；其他 lane 才可按普通 Issue 闭环语义选择 `refs_only` 或 `fixes_allowed`。live evidence 专项门禁只负责解除“因证据不足而不得使用 `Fixes`”这一层限制，不强制要求作者必须改成 `Fixes`。
4. `status=not_applicable` 时，`blocking_reasons` 必须为空，`gate_applicability.in_scope=false`，且 `merge_ready=true`；此时 `closing_semantics` 默认允许为 `n_a`、`refs_only` 或 `fixes_allowed`，但若 `gate_applicability.review_lane=formal_spec_review_pr`，则只允许为 `refs_only`，不得使用 `n_a` 或 `fixes_allowed`；若 `gate_applicability.review_lane=governance_landing_pr` 或 `gate_applicability.review_lane=governance_maintenance_pr`，则只允许为 `refs_only` 或 `fixes_allowed`，不得使用 `n_a`。
5. `merge_ready=true` 只表示 live evidence 专项门禁自身不阻断，不替代普通 review / GitHub checks / guardian 总体合并门禁。
6. 只有当 `gate_applicability.review_lane=governance_landing_pr` 且 formal spec review 未通过时，才必须在 `blocking_reasons` 中包含 `spec_review_not_completed`，并产出 `status=blocked`。
7. formal spec review PR、governance landing PR、governance maintenance PR 或任何 `in_scope=true` 的 PR 若缺少必需的结构化 `gate_applicability` 元数据，必须在 `blocking_reasons` 中包含 `missing_gate_applicability_metadata`，并产出 `status=blocked`。
8. 若 PR 实际变更命中 `classification_scope.governance_scope_targets` 中任一目标文件，且 `gate_applicability.governance_context_issue_ref` 非空，但其文件范围不是“精确命中五个治理目标文件集合”，必须在 `blocking_reasons` 中包含 `invalid_governance_landing_scope`，并产出 `status=blocked`。
9. 若 PR 实际变更精确命中 `classification_scope.governance_scope_targets`，但 `gate_applicability.governance_context_issue_ref` 为空，必须在 `blocking_reasons` 中包含 `missing_governance_issue_ref`，并产出 `status=blocked`。
10. 若同一 PR 同时改动 `classification_scope.spec_contract_targets` 中任一正式契约文件，或命中 `classification_scope.todo_handoff_target`，且又命中 `classification_scope.governance_scope_targets` 中任一治理落库目标文件，无论是否已经满足完整 landing 形态，都必须在 `blocking_reasons` 中包含 `mixed_spec_and_governance_scope`，并产出 `status=blocked`。

## 兼容性约束

1. 新增触发原因或阻断原因只能追加，不能改变既有语义。
2. `live_evidence_record` 的最低字段清单只允许追加；不得删除、重命名或降格为可选本契约已冻结的任一字段，包括 `latest_head_sha`、`profile`、`browser_channel`、`execution_surface`、`page_url`、`target_tab_id`、`run_id`、`evidence_collected_at`、`artifact_identity`、`relay_path`、`interaction_locator`、`success_signals`、`minimum_replay`、`artifact_log_ref`、`failure_reason`、`blocker_level`。
3. 若未来新增自动校验器，也必须消费同一套共享对象，而不是自创另一套触发集合。
