# FR-0010 数据模型（门禁执行）

## 目标

定义 Sprint 2 门禁执行最小共享实体，确保 `#208/#209` 与后续实现可稳定消费门禁结果。

## 实体 1：GateInput

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

## 实体 2：GateDecision

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

## 实体 3：ApprovalRecord

- `approval_id` string PK
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

## 实体 4：AuditRecord

- `event_id` string PK
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

## 生命周期

1. 接收执行请求后生成 `GateInput`。
2. 计算门禁后生成 `GateDecision`。
3. 若请求 live 升级，生成或更新 `ApprovalRecord`。
4. 不论放行或阻断，写入 `AuditRecord`。

## 与现有 FR 对齐

- 与 `FR-0009`：FR-0009 保留治理基线；FR-0010 作为 Sprint 2 实现与测试的唯一消费契约。
- 与 `FR-0004`：复用运行标识与最小可观测信息，不重建外层错误壳。
- 与 Sprint 2 issue 分解：`#218/#219/#221/#223` 与 `#208/#209` 及后续 Sprint 3 follow-up 共享同一冻结字段（`target_domain`、`target_tab_id`、`target_page`、`action_type`、`requested_execution_mode`、`effective_execution_mode`、`gate_decision`、`gate_reasons`）。

## FR-0009 -> FR-0010 字段迁移映射（规约层）

| FR-0009 对象/字段 | FR-0010 对象/字段 | 迁移说明 |
|---|---|---|
| `execution_mode_gate.default_mode` | `GateDecision.effective_execution_mode` | 默认生效模式由门禁结果对象承接 |
| `execution_mode_gate.manual_confirmation_checks` | `ApprovalRecord.checks` | 审批检查项落入可追溯记录 |
| `risk_state.live_experiment_status` | `GateInput.risk_state` | 状态输入保持一致语义 |
| `execution_mode_gate`（整体） | `GateInput + GateDecision` | 拆分为“请求模式”与“生效模式” |
| `resume_requirements` | `ApprovalRecord + AuditRecord` | 恢复前置改为审批与审计可检索记录 |

约束：

1. FR-0010 不与 FR-0009 并存双套可执行机器字段；Sprint 2 实现按 FR-0010 单口径消费。
2. 旧字段兼容若有需要，应在实现 PR 做显式映射层，不回灌到 FR-0010 正式字段命名。
