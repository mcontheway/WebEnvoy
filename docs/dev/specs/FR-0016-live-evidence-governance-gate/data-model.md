# FR-0016 数据模型

## 范围说明

本文件只描述 FR-0016 的治理态共享对象，不引入新的 SQLite 表、迁移、索引或 runtime 持久化实体。

`gate_applicability`、`live_evidence_record`、`gate_verdict` 的字段语义与约束以 `contracts/live-evidence-gate.md` 为准；本文件只补充对象职责、关键字段、约束与生命周期，避免把这些共享对象误读成需要落库的新业务表结构。

## 核心实体

### classification_scope

- 职责：提供独立于作者自报 lane 的机器判定输入，让 reviewer / guardian 能先识别 formal spec 套件与治理落库目标集合，再决定 lane 与 blocker。
- 关键字段：
  - `spec_suite_root`
  - `spec_contract_targets`
  - `todo_handoff_target`
  - `governance_issue_ref`
  - `governance_scope_targets`
- 约束：
  - `spec_suite_root` 固定为 `docs/dev/specs/FR-0016-live-evidence-governance-gate/`。
  - `spec_contract_targets` 固定为 formal spec 中承载正式契约语义的文件集合，不包含 FR-0016 的 `TODO.md` handoff 文件。
  - `todo_handoff_target` 固定为 `docs/dev/specs/FR-0016-live-evidence-governance-gate/TODO.md`，且只承担停点恢复与 handoff 记录，不属于治理落库 lane 的允许范围。
  - `governance_issue_ref` 固定为 `#310`，用于限定 FR-0016 治理落库 issue 上下文。
  - `governance_scope_targets` 固定为 FR-0016 的五个治理落库目标文件。
  - reviewer / guardian 命中 `spec_suite_root` 时，应先识别为 FR-0016 spec 上下文；只有继续命中 `spec_contract_targets` 时，才进入 formal spec 相关链路。
  - reviewer / guardian 只有在同时精确命中 `governance_scope_targets`、未混入其他实质性改动，且 `gate_applicability.governance_context_issue_ref` 非空时，才按治理相关链路处理。
  - 若 PR 在 `gate_applicability.governance_context_issue_ref=#310` 上下文中只命中 `governance_scope_targets` 子集，或在其外扩 scope，必须产出 `invalid_governance_landing_scope` 并阻断。
  - 若 PR 精确命中 `governance_scope_targets` 却缺少 `gate_applicability.governance_context_issue_ref`，必须产出 `missing_governance_issue_ref` 并阻断。
  - 若后续治理维护 PR 精确命中 `governance_scope_targets`，且 `gate_applicability.governance_context_issue_ref` 非空但不等于 `#310`，必须被机器化归入 `governance_maintenance_pr`，不能回退到启发式判断。
  - 若同一 PR 同时命中 `spec_contract_targets` 或 `todo_handoff_target`，并且又命中任一治理落库目标文件，不论是否已经构成完整 landing 形态，都必须产出 `mixed_spec_and_governance_scope`。
- 生命周期：
  - 作为 FR-0016 formal contract 的固定判定输入存在，不由作者在每个 PR 中自由改写。

### gate_applicability

- 职责：描述当前 PR 是否落入真实 live evidence 专项门禁，以及 `N/A` 是否允许出现。
- 关键字段：
  - `review_lane`
  - `governance_context_issue_ref`
  - `governance_scope_targets`
  - `in_scope`
  - `trigger_reasons`
  - `n_a_allowed`
- 约束：
  - `review_lane` 必须显式填写，枚举为 `general_pr`、`formal_spec_review_pr`、`governance_landing_pr`、`governance_maintenance_pr`。
  - `review_lane=governance_landing_pr` 或 `review_lane=governance_maintenance_pr` 时，`governance_scope_targets` 必须显式列出 `classification_scope` 冻结的五个治理落库目标文件；其他 lane 必须为空数组。
  - formal spec review PR、governance landing PR、governance maintenance PR 与其他 `in_scope=true` 的 PR 缺少该对象时，必须直接阻断，不得由 reviewer / guardian 代填。
  - reviewer / guardian 若发现 PR 实际变更命中 `classification_scope` 冻结目标，并满足对应的 issue 上下文与完整文件集合约束时，必须按对应 lane 处理，不得被自报 lane 绕过。
  - 若 PR 精确命中治理落库目标文件集合，却缺少 `governance_context_issue_ref`，不得退回 `general_pr`。
  - 若 PR 精确命中治理落库目标文件集合，且 `governance_context_issue_ref=#310`，必须归入 `governance_landing_pr`；若 issue 引用非空且不等于 `#310`，必须归入 `governance_maintenance_pr`。
  - 若 PR 只命中治理落库目标文件子集，或在目标集合外扩 scope，只要携带治理 issue 引用也不得退回 `general_pr`。
  - `in_scope=true` 时，`trigger_reasons` 必须非空，且 `n_a_allowed=false`。
  - `in_scope=false` 时，`trigger_reasons=[]`，且 `n_a_allowed=true`。
  - 只有在 PR 不以真实 live evidence 作为 issue 关闭、完成判定或 merge 放行依据时，才允许 `in_scope=false`；纯文档、纯研究 / spike、formal spec / design input 不是无条件豁免项。
- 生命周期：
  - 由作者 PR 描述、reviewer 判断和 guardian 判定共同消费。
  - 仅在 PR review / merge 决策窗口内有效；PR head、关闭语义或 evidence 依据变化后必须重新判定。
  - 仅要求专项门禁 PR、formal spec review PR、governance landing PR 与 governance maintenance PR 显式承载；不把 FR-0016 扩成所有 PR 的 repo-wide 元数据要求。

### live_evidence_record

- 职责：承载 PR 描述里的最低 live evidence 元数据，让 reviewer / guardian 能复核 latest head、真实执行面、最小复现路径与 artifact 线索。
- 关键字段：
  - `latest_head_sha`
  - `profile`
  - `browser_channel`
  - `execution_surface`
  - `page_url`
  - `target_tab_id`
  - `run_id`
  - `evidence_collected_at`
  - `artifact_identity`
  - `relay_path`
  - `interaction_locator`
  - `success_signals`
  - `minimum_replay`
  - `artifact_log_ref`
  - `failure_reason`
  - `blocker_level`
- 约束：
  - 该对象是条件必选对象：`gate_applicability.in_scope=true` 或 `gate_applicability.n_a_allowed=false` 时必须提供；`in_scope=false && n_a_allowed=true` 时允许省略或置为 `null`。
  - 上述字段均属于已冻结最低字段集，只可追加新字段，不得删除、重命名或降格为可选。
  - `latest_head_sha` 必须对应当前 PR latest head。
  - `run_id` 必须是 provider-scoped 的稳定执行标识，不得退化为自由文本标签。
  - `evidence_collected_at` 必须记录当前 latest head 这次 fresh rerun 的采集时间；若同一 head 下复用历史 artifact，该对象仍视为 stale。
  - `artifact_identity` 必须是 provider-scoped 的稳定 artifact 标识，用来区分同一 head 下不同 rerun 的产物身份。
  - `interaction_locator` 必须是与当前 evidence 场景匹配的中性定位字段，既能承载写路径交互定位，也能承载 read/runtime-only 复核入口。
  - 只有 `execution_surface=real_browser` 才可能成为有效 evidence 来源。
  - 成功态下 `failure_reason` / `blocker_level` 必须为 `N/A`；失败或阻断态下二者必须填写非空内容。
  - `live_evidence_record` 是 PR 级 latest-head gate 元数据；仓库 formal 文档中的固定样本、历史失败事实或已固化 run 记录，不是这份对象的替代物。
  - docs-only formal closeout PR 若在仓库文档中保留固定样本，只要未把其误写成当前 latest head gate evidence，就不得仅因其 SHA 与当前 PR head 不一致而被视为 stale。
- 生命周期：
  - 随 PR 描述维护，不单独进入 SQLite 或 runtime 状态表。
  - 任何新提交导致 latest head 改变后，旧 `live_evidence_record` 自动失效，必须重新复验并更新字段。

### gate_verdict

- 职责：承载 reviewer / guardian 对专项门禁的最终判定、阻断原因、关闭语义与 merge-ready 状态。
- 关键字段：
  - `status`
  - `closing_semantics`
  - `merge_ready`
  - `blocking_reasons`
- 约束：
  - `blocking_reasons` 非空时，`status=blocked`。
  - `status=blocked` 时，`closing_semantics=refs_only` 且 `merge_ready=false`。
  - `status=ready` 时，`merge_ready=true`；若 `review_lane=formal_spec_review_pr`，则 `closing_semantics` 必须为 `refs_only`；其他 lane 才可按普通 Issue 闭环语义选择 `refs_only` 或 `fixes_allowed`。live evidence 专项门禁只解除“因证据不足而不得使用 `Fixes`”这一层限制，不强制要求作者必须改成 `Fixes`。
  - `status=not_applicable` 时，`blocking_reasons=[]` 且 `gate_applicability.in_scope=false`，`merge_ready=true`；此时 `closing_semantics` 可按普通 Issue 闭环语义选择 `n_a`、`refs_only` 或 `fixes_allowed`，但 `review_lane=formal_spec_review_pr` 时必须为 `refs_only`，`review_lane=governance_landing_pr` 或 `review_lane=governance_maintenance_pr` 时只允许为 `refs_only` 或 `fixes_allowed`。
  - `merge_ready=true` 只表示 live evidence 专项门禁自身不阻断，不替代普通 review / GitHub checks / guardian 总体合并门禁。
  - 只有 `review_lane=governance_landing_pr` 且 formal spec review 未通过时，才必须包含 `spec_review_not_completed`，且 `status=blocked`。
  - formal spec review PR、governance landing PR、governance maintenance PR 与其他 `in_scope=true` 的 PR 若缺少 `gate_applicability`，必须包含 `missing_gate_applicability_metadata`，且 `status=blocked`。
  - 若 PR 在 `#310` 上下文中只命中五个治理落库目标文件子集，或在五文件之外扩 scope，必须包含 `invalid_governance_landing_scope`，且 `status=blocked`。
  - 若 PR 精确命中五个治理落库目标文件却缺少 `gate_applicability.governance_context_issue_ref`，必须包含 `missing_governance_issue_ref`，且 `status=blocked`。
  - 若同一 PR 同时改动 FR-0016 `spec_contract_targets` 中任一正式契约文件，或命中 `todo_handoff_target`，且又命中任一治理落库目标文件，不论是否已经构成完整 landing 形态，都必须包含 `mixed_spec_and_governance_scope`，且 `status=blocked`。
- 生命周期：
  - reviewer / guardian 基于当前 PR 描述、latest head 和 formal spec review 状态即时产出。
  - 若 PR head 或 review 前置状态发生变化，旧 verdict 自动过期，必须重新计算。

## 非持久化与兼容边界

- 本 FR 不新增数据库实体，不要求写入 `.webenvoy/` 或 SQLite。
- 后续若新增自动校验器或结构化 bot，也必须直接消费 `contracts/live-evidence-gate.md` 和本文件定义的对象语义，不能自建一套字段模型。
- 如未来确实要把 live evidence 元数据落库，必须另起独立 FR，不能在 `#311` 治理落库 PR 中顺手引入。
