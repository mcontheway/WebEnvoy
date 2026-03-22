# FR-0010 数据模型（门禁执行）

## 目标

定义 Sprint 2 门禁执行最小共享实体，确保 `#208/#209` 与后续实现可稳定消费门禁结果。

## 实体 1：GateInput

- `run_id` string NOT NULL
- `session_id` string NOT NULL
- `profile` string NOT NULL
- `target_domain` string NOT NULL
- `target_tab_id` integer NULL
- `action_type` ENUM NOT NULL (`read` | `write` | `irreversible_write`)
- `requested_mode` ENUM NOT NULL (`dry_run` | `recon` | `live_read_high_risk` | `live_write`)
- `risk_state` ENUM NOT NULL (`paused` | `limited` | `allowed`)
- `created_at` datetime NOT NULL

约束：

1. `requested_mode` 为 `live_*` 时，`target_tab_id` 不得为空。
2. `target_domain` 必须属于 `scope_context` 定义的读域或写域之一。

## 实体 2：GateDecision

- `decision_id` string PK
- `run_id` string NOT NULL
- `effective_mode` ENUM NOT NULL (`dry_run` | `recon` | `live_read_high_risk` | `live_write`)
- `decision` ENUM NOT NULL (`allowed` | `blocked`)
- `reasons` JSON array NOT NULL
- `requires_manual_confirmation` boolean NOT NULL
- `recorded_at` datetime NOT NULL

约束：

1. `decision=blocked` 时，`reasons` 必须至少包含 1 项。
2. 默认情况下 `effective_mode` 不得为 `live_*`。

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
  - `target_page_confirmed` boolean
  - `risk_state_checked` boolean
  - `action_type_confirmed` boolean

## 实体 4：AuditRecord

- `event_id` string PK
- `run_id` string NOT NULL
- `session_id` string NOT NULL
- `profile` string NOT NULL
- `target_domain` string NOT NULL
- `action_type` ENUM NOT NULL
- `requested_mode` ENUM NOT NULL
- `effective_mode` ENUM NOT NULL
- `decision` ENUM NOT NULL
- `recorded_at` datetime NOT NULL

约束：

1. 所有门禁判定都必须写一条 `AuditRecord`。
2. `run_id + recorded_at` 必须可排序，支持时间线复盘。

## 生命周期

1. 接收执行请求后生成 `GateInput`。
2. 计算门禁后生成 `GateDecision`。
3. 若请求 live 升级，生成或更新 `ApprovalRecord`。
4. 不论放行或阻断，写入 `AuditRecord`。

## 与现有 FR 对齐

- 与 `FR-0009`：继承门禁对象语义，不改变字段含义。
- 与 `FR-0004`：复用运行标识与最小可观测信息，不重建外层错误壳。
