# FR-0010 数据模型（门禁执行）

## 目标

定义 Sprint 2 门禁执行最小共享实体，确保 `#208/#209` 与后续实现可稳定消费门禁结果。

## 实体 1：ScopeContext

- `platform` string NOT NULL
- `read_domain` string NOT NULL
- `write_domain` string NOT NULL
- `domain_mixing_forbidden` boolean NOT NULL
- `spec_review_passed` boolean NOT NULL
- `risk_review_completed` boolean NOT NULL
- `limited_read_rollout_ready` boolean NOT NULL
- `explicit_scope_for_209_extension` boolean NOT NULL
- `explicit_scope_for_208` boolean NOT NULL

约束：

1. 读写域必须显式存在，不允许隐式继承。
2. `domain_mixing_forbidden=true` 时，不允许单域成功推导另一域放行。
3. `spec_review_passed` 与 `risk_review_completed` 属于治理侧 hard gate，不得由调用方请求载荷直接声明。
4. `limited_read_rollout_ready` 是治理侧 staged rollout readiness gate，不得由调用方请求载荷直接声明。
5. `explicit_scope_for_209_extension=false` 时，不得放行任何读侧 live 扩展。
6. `explicit_scope_for_208=false` 时，不得放行 `live_write` 或任何 `#208` 真实交互。

## 实体 2：GateInput

- `run_id` string NOT NULL
- `session_id` string NOT NULL
- `profile` string NOT NULL
- `target_domain` string NOT NULL
- `target_tab_id` integer NOT NULL
- `target_page` string NOT NULL
- `action_type` ENUM NOT NULL (`read` | `write` | `irreversible_write`)
- `requested_execution_mode` ENUM NOT NULL (`dry_run` | `recon` | `live_read_limited` | `live_read_high_risk` | `live_write`)
- `risk_state` ENUM NOT NULL (`paused` | `limited` | `allowed`)
- `created_at` datetime NOT NULL

约束：

1. 所有门禁请求都必须提供 `target_tab_id` 与 `target_page`，不得在非 live 请求中留空。
2. `target_domain` 必须属于 `scope_context` 定义的读域或写域之一。
3. `requested_execution_mode=live_read_limited` 只允许与 `action_type=read` 搭配。
4. `requested_execution_mode=live_read_limited` 在 `FR-0011` 未完成 formal 收口前只能得到 `blocked` 结果，不得被视为 Sprint 2 已拥有的公开 live 模式。
5. `requested_execution_mode=live_read_limited` 时仍必须同时满足 `ScopeContext.limited_read_rollout_ready=true`，否则只能得到 `blocked` 结果。

## 实体 3：GateDecision

- `decision_id` string PK
- `run_id` string NOT NULL
- `effective_execution_mode` ENUM NOT NULL (`dry_run` | `recon` | `live_read_limited` | `live_read_high_risk` | `live_write`)
- `gate_decision` ENUM NOT NULL (`allowed` | `blocked`)
- `gate_reasons` JSON array NOT NULL
- `requires_manual_confirmation` boolean NOT NULL
- `recorded_at` datetime NOT NULL

约束：

1. `gate_decision=blocked` 时，`gate_reasons` 必须至少包含 1 项。
2. 默认情况下 `effective_execution_mode` 不得为 `live_*`。
3. `gate_decision=blocked` 时，`effective_execution_mode` 只能表示真实未继续 live 的降级模式，不得返回未实际执行的 `live_*`。
4. `effective_execution_mode=live_read_limited` 只允许与读动作绑定，不得作为写动作或不可逆写动作的生效模式。

## 实体 4：ApprovalRecord

- `approval_id` string PK
- `decision_id` string NOT NULL
- `run_id` string NOT NULL
- `approved` boolean NOT NULL
- `approver` string NULL
- `approved_at` datetime NULL
- `checks` JSON object NOT NULL

约束：

1. `approved=true` 时，`approver` 与 `approved_at` 必填。
2. `checks` 必含：
  - `target_domain_confirmed` boolean
  - `target_tab_confirmed` boolean
  - `target_page_confirmed` boolean
  - `risk_state_checked` boolean
  - `action_type_confirmed` boolean
3. `requested_execution_mode|effective_execution_mode` 命中 `live_read_limited`、`live_read_high_risk` 或 `live_write` 且门禁放行时，`ApprovalRecord` 不得缺失。
4. `approval_id` 是 `FR-0009.approval_record_ref` 的等价承载，必须稳定、可检索、不可歧义。
5. `decision_id` 必须指向同一次 `GateDecision`，保证 live 放行的审批记录可定位到唯一门禁决策。

## 实体 5：AuditRecord

- `event_id` string PK
- `decision_id` string NOT NULL
- `approval_id` string NULL
- `run_id` string NOT NULL
- `session_id` string NOT NULL
- `profile` string NOT NULL
- `target_domain` string NOT NULL
- `target_tab_id` integer NOT NULL
- `target_page` string NOT NULL
- `action_type` ENUM NOT NULL
- `requested_execution_mode` ENUM NOT NULL
- `effective_execution_mode` ENUM NOT NULL
- `gate_decision` ENUM NOT NULL
- `gate_reasons` JSON array NOT NULL
- `approver` string NULL
- `approved_at` datetime NULL
- `recorded_at` datetime NOT NULL

约束：

1. 所有门禁判定都必须写一条 `AuditRecord`。
2. `run_id + recorded_at` 必须可排序，支持时间线复盘。
3. `gate_reasons` 必须至少包含 1 项，保证门禁审计可独立复盘。
4. `gate_decision=allowed` 时，`approver` 与 `approved_at` 必填。
5. `requested_execution_mode|effective_execution_mode` 命中 `live_read_limited`、`live_read_high_risk` 或 `live_write` 且门禁放行时，审计记录必须能独立证明审批已完成。
6. `event_id` 是 `FR-0009.audit_record_ref` 的等价承载，必须稳定、可检索、不可歧义。
7. `decision_id` 必须指向同一次 `GateDecision`，保证审计记录能回链到唯一门禁结论。
8. `approval_id` 在 live 放行时必填，且必须引用对应 `ApprovalRecord.approval_id`，确保 `approval_record_ref` 与 `audit_record_ref` 能唯一对应同一 live 恢复/扩展决策。

## 生命周期

1. 先加载治理侧 `ScopeContext`。
2. 接收执行请求后生成 `GateInput`。
3. 计算门禁后生成 `GateDecision`。
4. 若请求 live 升级，生成或更新 `ApprovalRecord`，并绑定对应 `decision_id`。
5. 不论放行或阻断，写入 `AuditRecord`；若 live 放行，必须回链同一 `decision_id` 与 `approval_id`。

## 与现有 FR 对齐

- 与 `FR-0009`：FR-0009 保留治理基线；FR-0010 作为 Sprint 2 实现与测试的唯一消费契约。
- 与 `FR-0004`：复用运行标识与最小可观测信息，不重建外层错误壳。
- 与 Sprint 2 issue 分解：`#218/#219/#221/#223` 与 `#208/#209` 共享同一冻结字段（`target_domain`、`target_tab_id`、`target_page`、`action_type`、`requested_execution_mode`、`effective_execution_mode`、`gate_decision`、`gate_reasons`）。

## FR-0009 -> FR-0010 字段迁移映射（规约层）

| FR-0009 对象/字段 | FR-0010 对象/字段 | 迁移说明 |
|---|---|---|
| `execution_mode_gate.default_mode` | `GateDecision.effective_execution_mode` | 默认生效模式由门禁结果对象承接 |
| `execution_mode_gate.manual_confirmation_checks` | `ApprovalRecord.checks` | 审批检查项落入可追溯记录 |
| `risk_state.live_experiment_status` | `GateInput.risk_state` | 状态输入保持一致语义 |
| `execution_mode_gate`（整体） | `GateInput + GateDecision` | 拆分为“请求模式”与“生效模式” |
| `resume_requirements` | `ApprovalRecord + AuditRecord` | 恢复前置改为审批与审计可检索记录 |
| `resume_requirements.spec_review_passed` | `ScopeContext.spec_review_passed` | formal spec review 已通过的治理侧前置 |
| `resume_requirements.risk_review_completed` | `ScopeContext.risk_review_completed` | 风险审查已完成的治理侧前置 |
| `resume_requirements.limited_read_rollout_ready` | `ScopeContext.limited_read_rollout_ready` | 受控读侧 staged rollout 的治理侧前置 |
| `resume_requirements.explicit_scope_for_209_extension` | `ScopeContext.explicit_scope_for_209_extension` | 读侧扩展的显式 scope gate |
| `resume_requirements.explicit_scope_for_208` | `ScopeContext.explicit_scope_for_208` | 写侧真实交互的显式 scope gate |
| `resume_requirements.approval_record_ref` | `ApprovalRecord.approval_id` | 审批记录稳定引用 |
| `resume_requirements.audit_record_ref` | `AuditRecord.event_id` | 审计记录稳定引用 |

约束：

1. FR-0010 不与 FR-0009 并存双套可执行机器字段；Sprint 2 实现按 FR-0010 单口径消费。
2. `live_read_limited` 的 Sprint 3 readiness 字段与放行条件不在本 FR 冻结；在 `FR-0011` formal 收口前，本 FR 只承接其默认阻断语义。
3. 旧字段兼容若有需要，应在实现 PR 做显式映射层，不回灌到 FR-0010 正式字段命名。
