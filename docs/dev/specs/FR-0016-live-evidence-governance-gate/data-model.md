# FR-0016 数据模型

## 范围说明

本文件只描述 FR-0016 的治理态共享对象，不引入新的 SQLite 表、迁移、索引或 runtime 持久化实体。

`gate_applicability`、`live_evidence_record`、`gate_verdict` 的字段语义与约束以 `contracts/live-evidence-gate.md` 为准；本文件只补充对象职责、关键字段、约束与生命周期，避免把这些共享对象误读成需要落库的新业务表结构。

## 核心实体

### gate_applicability

- 职责：描述当前 PR 是否落入真实 live evidence 专项门禁，以及 `N/A` 是否允许出现。
- 关键字段：
  - `in_scope`
  - `trigger_reasons`
  - `n_a_allowed`
- 约束：
  - `in_scope=true` 时，`trigger_reasons` 必须非空，且 `n_a_allowed=false`。
  - `in_scope=false` 时，`trigger_reasons=[]`，且 `n_a_allowed=true`。
  - 只有在 PR 不以真实 live evidence 作为 issue 关闭、完成判定或 merge 放行依据时，才允许 `in_scope=false`；纯文档、纯研究 / spike、formal spec / design input 不是无条件豁免项。
- 生命周期：
  - 由作者 PR 描述、reviewer 判断和 guardian 判定共同消费。
  - 仅在 PR review / merge 决策窗口内有效；PR head、关闭语义或 evidence 依据变化后必须重新判定。

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
  - `relay_path`
  - `editor_locator`
  - `success_signals`
  - `minimum_replay`
  - `artifact_log_ref`
  - `failure_reason`
  - `blocker_level`
- 约束：
  - 该对象是条件必选对象：`gate_applicability.in_scope=true` 或 `gate_applicability.n_a_allowed=false` 时必须提供；`in_scope=false && n_a_allowed=true` 时允许省略或置为 `null`。
  - 上述字段均属于已冻结最低字段集，只可追加新字段，不得删除、重命名或降格为可选。
  - `latest_head_sha` 必须对应当前 PR latest head。
  - 只有 `execution_surface=real_browser` 才可能成为有效 evidence 来源。
  - 成功态下 `failure_reason` / `blocker_level` 必须为 `N/A`；失败或阻断态下二者必须填写非空内容。
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
  - `status=ready` 时，`merge_ready=true`，且 `closing_semantics` 可为 `fixes_allowed`。
  - `status=not_applicable` 时，`blocking_reasons=[]` 且 `gate_applicability.in_scope=false`，`merge_ready=true`；此时 `closing_semantics` 可按普通 Issue 闭环语义选择 `n_a`、`refs_only` 或 `fixes_allowed`。
  - `merge_ready=true` 只表示 live evidence 专项门禁自身不阻断，不替代普通 review / GitHub checks / guardian 总体合并门禁。
  - formal spec review 未通过时，治理落库 PR 必须包含 `spec_review_not_completed`，且 `status=blocked`。
- 生命周期：
  - reviewer / guardian 基于当前 PR 描述、latest head 和 formal spec review 状态即时产出。
  - 若 PR head 或 review 前置状态发生变化，旧 verdict 自动过期，必须重新计算。

## 非持久化与兼容边界

- 本 FR 不新增数据库实体，不要求写入 `.webenvoy/` 或 SQLite。
- 后续若新增自动校验器或结构化 bot，也必须直接消费 `contracts/live-evidence-gate.md` 和本文件定义的对象语义，不能自建一套字段模型。
- 如未来确实要把 live evidence 元数据落库，必须另起独立 FR，不能在 `#311` 治理落库 PR 中顺手引入。
