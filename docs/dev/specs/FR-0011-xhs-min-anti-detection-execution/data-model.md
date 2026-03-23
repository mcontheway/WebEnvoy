# FR-0011 数据模型（最小反风控执行能力）

## 范围说明

本模型描述 FR-0011 规约阶段需要稳定交付的共享对象，不新增持久化 schema，仅定义实现阶段必须遵循的数据结构语义。
凡涉及门禁输入/结果、审批证据与审计留痕的机器字段，本模型显式继承 `FR-0010` 的 `GateInput`、`GateDecision`、`ApprovalRecord`、`AuditRecord` 与 `ConsumerGateResult` 作为承载对象，FR-0011 只补充 Sprint 3 的增量约束。

## 实体 1：PluginGateOwnership

- `background_gate` ARRAY NOT NULL
- `content_script_gate` ARRAY NOT NULL
- `main_world_gate` ARRAY NOT NULL
- `cli_role` TEXT NOT NULL

约束：
- `background_gate` 至少包含 `target_domain_check` 与 `target_tab_check`。
- `cli_role` 仅允许描述“请求/结果壳”，不得声明门禁主判定。

## 实体 2：ReadExecutionPolicy

- `default_mode` ENUM NOT NULL（`dry_run` | `recon`）
- `allowed_modes` ARRAY NOT NULL
- `blocked_actions` ARRAY NOT NULL
- `live_entry_requirements` ARRAY NOT NULL

约束：
- `default_mode` 在 FR-0011 生效阶段只能是 `dry_run` 或 `recon`，不得为任何 `live_*`。
- `live_read_limited` 作为 `allowed_modes` 成员时，表示正式公开的受控 live 模式，不得仅作为内部 fallback 枚举存在。
- `blocked_actions` 为空时视为无效对象。
- `live_entry_requirements` 必须显式覆盖 `FR-0010.GateInput.risk_state` 的 live 准入边界、`target_domain_confirmed`、`target_tab_confirmed`、`target_page_confirmed`、`action_type_confirmed`、以及完整审批证据；审计要求继续作为门禁判定后的必写留痕，不得弱于 `FR-0010.ApprovalRecord` / `FR-0010.AuditRecord` 的正式边界。

## 实体 3：WriteInteractionTier

- `tiers` ARRAY NOT NULL
- `synthetic_event_default` ENUM NOT NULL（`blocked` | `limited` | `allowed`）
- `upload_injection_default` ENUM NOT NULL（`blocked` | `limited` | `allowed`）

约束：
- 必须存在 `irreversible_write` tier，且默认不可直接 live 放行。

## 实体 4：SessionRhythmPolicy

- `min_action_interval_ms` INTEGER NOT NULL
- `min_experiment_interval_ms` INTEGER NOT NULL
- `cooldown_strategy` ENUM NOT NULL（`exponential_backoff`）
- `cooldown_base_minutes` INTEGER NOT NULL
- `cooldown_cap_minutes` INTEGER NOT NULL
- `resume_probe_mode` ENUM NOT NULL（`recon_only` | `dry_run_only`）

约束：
- 所有间隔字段必须 > 0。
- `cooldown_strategy` 当前只允许 `exponential_backoff`，不得回退为固定冷却。

## 实体 5：RiskStateMachine

- `states` ARRAY NOT NULL（必须包含 `paused`、`limited`、`allowed`）
- `transitions` ARRAY NOT NULL
- `hard_block_when_paused` ARRAY NOT NULL

约束：
- `states` 缺任一基线状态视为无效。
- `hard_block_when_paused` 不能为空。
- `hard_block_when_paused` 必须显式包含所有 live 读写模式，至少覆盖 `live_read_limited`、`live_read_high_risk` 与 `live_write`。

## 实体 6：IssueActionMatrix

- `issue_scope` ENUM NOT NULL（`issue_208` | `issue_209`）
- `state` ENUM NOT NULL（`paused` | `limited` | `allowed`）
- `allowed_actions` ARRAY NOT NULL
- `conditional_actions` ARRAY NOT NULL
- `blocked_actions` ARRAY NOT NULL

约束：
- `issue_208` 与 `issue_209` 必须覆盖相同的 `state` 枚举集合。
- `paused` 的 `allowed_actions` 只能包含 `dry_run` 或 `recon` 类动作。
- `conditional_actions` 的每个元素必须至少包含 `action` 与 `requires` 两个字段。
- `conditional_actions.requires` 只允许引用已在 `ReadExecutionPolicy.live_entry_requirements` 中冻结的机器条件名。
- 所有 `IssueActionMatrix` entry 都必须显式包含 `conditional_actions`；当不存在附加前置动作时，取空数组。
- `paused` 的 `blocked_actions` 必须显式覆盖所有 live 动作，不得依赖实现推断补全。
- `issue_208` 在 `limited` 下不得出现不可逆写动作。
- `blocked_actions` 不得为空，必须与 `allowed_actions`、`conditional_actions` 一起定义完整边界。
- live 读模式若需要审批证据，不得直接出现在 `allowed_actions` 中，必须落入 `conditional_actions`。
- `issue_209` 在 `limited` 下只允许把 `live_read_limited` 放入 `conditional_actions`，不得把 `live_read_high_risk` 视为可放行动作。

## 实体 7：RiskTransitionAuditRecord

- `run_id` TEXT NOT NULL
- `session_id` TEXT NOT NULL
- `issue_scope` ENUM NOT NULL（`issue_208` | `issue_209` | `shared`）
- `prev_state` ENUM NOT NULL（`paused` | `limited` | `allowed`）
- `next_state` ENUM NOT NULL（`paused` | `limited` | `allowed`）
- `trigger` TEXT NOT NULL
- `decision` ENUM NOT NULL（`allow` | `block` | `rollback`）
- `approver` TEXT NULL
- `approved_at` TEXT NULL
- `reason` TEXT NOT NULL

约束：
- 缺失 `run_id/session_id/prev_state/next_state/decision/reason` 任一字段时，状态变更无效。
- 当 `trigger` 依赖人工批准恢复，或 `next_state=allowed` 会扩大 live 放行范围时，缺失 `approver/approved_at` 不得判定为有效。
- 状态变更无效时，执行层必须回退到 `paused` 并阻断 live。

## 跨 FR 继承约束

- FR-0011 不新增 `requested_execution_mode`、`effective_execution_mode`、`gate_decision` 的并行实体定义；对应稳定字段与基础约束一律继承 `FR-0010.GateInput` / `FR-0010.GateDecision` / `FR-0010.ConsumerGateResult`。
- 在继承 `FR-0010` 冻结对象的前提下，FR-0011 仅补充 Sprint 3 增量语义：
  - `live_read_limited` 作为正式公开的受控 live 模式存在，但只允许用于读动作。
  - `gate_decision=blocked` 时，`effective_execution_mode` 只能表达真实未继续 live 的降级模式。
  - `gate_decision=allowed` 且 `requested_execution_mode|effective_execution_mode` 命中 `live_read_limited` 或 `live_read_high_risk` 时，审批证据必须继续落在 `FR-0010.ApprovalRecord` 与 `FR-0010.AuditRecord` 中。
  - `consumer_gate_result` 是下游消费的唯一结果投影承载对象；`#208/#209` 与后续实现事项不得派生并行私有结果对象或私有字段投影。

## 生命周期

1. FR-0011 规约阶段：冻结字段语义与约束。
2. 实现阶段：以该模型映射到运行时策略对象与测试用例。
3. 后续阶段：仅允许追加字段；改语义需独立 spec review。
