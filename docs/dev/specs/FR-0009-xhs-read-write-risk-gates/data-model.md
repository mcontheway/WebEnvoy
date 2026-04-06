# FR-0009 数据模型（门禁共享对象）

> 本文仅定义门禁共享对象，不涉及持久化 schema 变更。

## 实体 1：PathScope

- 语义：描述读写能力的域名范围与边界分离。
- 核心字段：
  - `read_domain`：读域名（当前固定 `www.xiaohongshu.com`）
  - `write_domain`：写域名（当前固定 `creator.xiaohongshu.com`）
  - `read_capabilities`：读能力列表
  - `write_capabilities`：写能力列表
  - `domain_mixing_forbidden`：是否禁止跨域混推
- 生命周期：在 FR-0009 审查通过后作为后续事项前置输入。

## 实体 2：RiskState

- 语义：描述账号风险与实验状态。
- 核心字段：
  - `account_alert_present`
  - `live_experiment_status`
  - `risk_level`
  - `evidence_status`
  - `notes`
- 生命周期：每轮风险评审更新；未满足恢复条件时保持 `paused/limited`。

## 实体 3：ExecutionModeGate

- 语义：描述默认模式、放行模式与人工确认要求。
- 核心字段：
  - `default_mode`
  - `allowed_modes`
  - `blocked_modes`
  - `manual_confirmation_required`
  - `manual_confirmation_checks`
- 生命周期：作为 `#208/#209` 后续事项与后续读写实现的模式前置。
- 说明：责任人与 formal closeout 留痕可在 GitHub issue / PR 中追溯，但这类记录不替代后续执行契约中的正式审批 / 审计载体。

## 实体 4：ResumeRequirements

- 语义：描述恢复 live 的必要前置。
- 核心字段：
  - `spec_review_passed`
  - `risk_review_completed`
  - `explicit_scope_for_208`
  - `explicit_scope_for_209_extension`
  - `approver_recorded`
- 生命周期：全部满足前，live 不得放行。
- 说明：`approver_recorded` 表示 live 放行所需的审批已被真实记录并可复核，但不把 GitHub issue / PR 记录硬编码为唯一正式载体。

## 约束与一致性

1. 四实体字段语义与 `contracts/risk-gates.md` 一致。
2. 任一实体缺失时，判定为“门禁输入不完整”，不得放行 live。
3. 本 FR 不新增数据库字段；后续若落地持久化，需在实现 FR 中补迁移方案。
