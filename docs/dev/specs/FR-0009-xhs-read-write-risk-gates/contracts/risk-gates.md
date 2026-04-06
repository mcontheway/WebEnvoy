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
    "blocked_modes": ["live_read_high_risk", "live_write"],
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
    "explicit_scope_for_208": true,
    "explicit_scope_for_209_extension": true,
    "approver_recorded": true
  }
}
```

约束：

1. 任一字段为 `false` 时，不得进入 live 放行。
2. 必须保留可被后续事项引用的审批记录；formal closeout 留痕与未来运行时审批 / 审计记录不得混为同一正式载体。
3. `approver_recorded=true` 只表示“后续执行契约要求的审批载体已被定义并可复核”，不把具体实现硬编码为 GitHub issue / PR 记录。

## 兼容性约束

1. 新增字段可追加，不允许改变既有字段语义。
2. `blocked_modes` 减少项必须在 spec review 中显式说明理由。
3. 任何“恢复 live”结论必须同步更新 `resume_requirements` 证据状态。
4. 本契约仅冻结规约阶段稳定输出对象，不提前吸收 `FR-0010` 的统一消费字段。
