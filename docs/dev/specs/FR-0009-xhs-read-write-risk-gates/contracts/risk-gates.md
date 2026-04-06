# XHS 读写风险门禁契约

## 边界与适用范围

本契约定义 FR-0009 规约阶段的稳定输出对象，用于约束 XHS 读写路径风险审查与 live 执行门禁决策。

本契约不定义：

- 具体风控规避策略
- 发布/上传实现代码
- FR-0001 CLI 外层参数格式
- FR-0002 / FR-0003 通信与会话状态机细节

## 输出对象

门禁输出必须包含以下四个对象：

1. `path_scope`
2. `risk_state`
3. `execution_mode_gate`
4. `resume_requirements`

## path_scope

描述读写路径范围与域名分离边界。

```json
{
  "path_scope": {
    "read_domain": "www.xiaohongshu.com",
    "write_domain": "creator.xiaohongshu.com",
    "read_capabilities": ["xhs.search"],
    "write_capabilities": ["xhs.minimal_interaction_candidate"],
    "domain_mixing_forbidden": true
  }
}
```

约束：

1. `read_domain` 与 `write_domain` 必须显式填写，不允许隐式继承。
2. `domain_mixing_forbidden=true` 时，禁止以单域成功推断另一域可放行。

## risk_state

描述当前账号与实验风险状态。

```json
{
  "risk_state": {
    "account_alert_present": true,
    "live_experiment_status": "paused",
    "risk_level": "high",
    "evidence_status": "partial",
    "notes": "平台已出现自动化风险预警"
  }
}
```

枚举：

- `live_experiment_status`: `paused | limited | allowed`
- `risk_level`: `low | medium | high`
- `evidence_status`: `missing | partial | sufficient`

## execution_mode_gate

描述动作执行模式门禁判定。

```json
{
  "execution_mode_gate": {
    "default_mode": "dry_run",
    "allowed_modes": ["dry_run", "recon"],
    "blocked_modes": ["live_read_limited", "live_read_high_risk", "live_write"],
    "manual_confirmation_required": true,
    "manual_confirmation_checks": [
      "target_domain_confirmed",
      "account_risk_checked",
      "action_type_confirmed"
    ]
  }
}
```

约束：

1. `default_mode` 在本 FR 生效阶段必须是 `dry_run` 或 `recon`。
2. 若 `manual_confirmation_required=true`，检查项必须非空。
3. 规约阶段的人工确认责任人默认是发起本次 live 恢复 / 扩展请求的实现负责人。
4. formal closeout 的 review / sync 记录可保留在 GitHub issue / PR 中，但后续 live 放行的正式审批载体不得只依赖这些 GitHub 记录。

## resume_requirements

描述从“暂停高风险 live 实验”恢复到“允许有限 live”所需前置。

```json
{
  "resume_requirements": {
    "spec_review_passed": true,
    "risk_review_completed": true,
    "limited_read_rollout_ready": true,
    "explicit_scope_for_208": true,
    "explicit_scope_for_209_extension": true,
    "approver_recorded": true,
    "approval_record_ref": "approval_run_001",
    "audit_record_ref": "gate_evt_001"
  }
}
```

约束：

1. `spec_review_passed=false`、`risk_review_completed=false` 或 `approver_recorded=false` 时，不得进入任何 live 放行。
2. `limited_read_rollout_ready=false` 时，不得放行为未来受控读侧 staged rollout 保留的治理前置，包括 `live_read_limited` 的讨论前置。
3. `explicit_scope_for_209_extension=false` 时，不得放行任何读侧 live 扩展，包括 `live_read_limited`。
4. `explicit_scope_for_208=false` 时，不得放行 `live_write` 或任何 `#208` 真实交互；该字段本身不阻断受控读侧 `live_read_limited`。
6. 必须保留可被后续事项引用的审批记录；formal closeout 留痕与未来运行时审批 / 审计记录不得混为同一正式载体。
7. `approver_recorded=true` 表示 live 放行所需的审批已被真实记录，且该记录可被后续执行契约消费；本 FR 不把具体实现硬编码为 GitHub issue / PR 记录。
8. `approver_recorded=true` 只有在同时存在以下两类可复核记录时才成立：
   - approval record：至少包含 `approver`、`approved_at`、`checks`、`approval_record_ref`
   - audit trail：至少包含与同一次恢复判断对应的执行模式、门禁决策、`recorded_at`、`audit_record_ref`
9. `approval_record_ref` 与 `audit_record_ref` 必须是稳定、可复核、不可歧义的 live-approval 记录引用；formal closeout 阶段的 PR review artifact / sync comment permalink 只用于 review evidence，不得单独满足 `approver_recorded=true`。
10. `limited_read_rollout_ready=true` 只表示治理前置已齐备；在 `FR-0010` 与 `FR-0011` 都完成各自 formal 收口前，不得据此单独恢复 `live_read_limited`。

## 兼容性约束

1. 新增字段可追加，不允许改变既有字段语义。
2. `blocked_modes` 减少项必须在 spec review 中显式说明理由。
3. 任何“恢复 live”结论必须同步更新 `resume_requirements` 证据状态。
4. 本契约仅冻结规约阶段稳定输出对象，不提前吸收 `FR-0010` 的统一消费字段。
