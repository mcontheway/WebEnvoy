# FR-0011 最小反风控执行契约

## 边界与适用范围

本契约定义 Sprint 3 的最小反风控执行能力输出对象，供 `#208` 与 `#209` 在进入 live 扩展前统一消费。
凡涉及 `requested_execution_mode`、`effective_execution_mode`、`gate_decision`、`approval_record`、`audit_record` 的稳定机器边界，本 FR 显式继承 `FR-0010` 的 `gate_outcome` / `approval_record` / `audit_record` / `consumer_gate_result`，只补充 Sprint 3 对 `live_read_limited` 与状态机的新增约束，不并行重定义另一套门禁结果对象。

本契约不定义：
- 平台规避策略细节
- 完整发布流程实现
- 账号矩阵调度模型

## 输出对象

必须新增或冻结以下七个 Sprint 3 对象：
1. `plugin_gate_ownership`
2. `read_execution_policy`
3. `write_interaction_tier`
4. `session_rhythm_policy`
5. `risk_state_machine`
6. `issue_action_matrix`
7. `risk_transition_audit`

同时必须继续复用 `FR-0010` 的以下门禁结果对象作为实现落点：
1. `gate_outcome`
2. `approval_record`
3. `audit_record`
4. `consumer_gate_result`

## plugin_gate_ownership

```json
{
  "plugin_gate_ownership": {
    "background_gate": ["target_domain_check", "target_tab_check", "mode_gate"],
    "content_script_gate": ["page_context_check", "action_tier_check"],
    "main_world_gate": ["signed_call_scope_check"],
    "cli_role": "request_and_result_shell_only"
  }
}
```

约束：
- `background_gate` 至少包含域名与目标页确认。
- `cli_role` 不能表达“核心门禁判定在 CLI”。

## read_execution_policy

```json
{
  "read_execution_policy": {
    "default_mode": "dry_run",
    "allowed_modes": ["dry_run", "recon", "live_read_limited", "live_read_high_risk"],
    "blocked_actions": ["expand_new_live_surface_without_gate"],
    "live_entry_requirements": [
      "risk_state_not_paused",
      "target_domain_confirmed",
      "manual_confirmation_recorded"
    ]
  }
}
```

约束：
- `live_read_limited` 是正式公开的受控 live 读模式，可由外部请求方显式请求。
- `live_read_limited` 与 `live_read_high_risk` 进入 live 前都必须满足 `live_entry_requirements`，且审批证据要求不可分叉。
- 若请求被门禁阻断，`effective_execution_mode` 不得表达未实际继续执行的 `live_*` 模式。

## write_interaction_tier

```json
{
  "write_interaction_tier": {
    "tiers": [
      { "name": "observe_only", "live_allowed": false },
      { "name": "reversible_interaction", "live_allowed": "limited" },
      { "name": "irreversible_write", "live_allowed": false }
    ],
    "synthetic_event_default": "blocked",
    "upload_injection_default": "blocked"
  }
}
```

## session_rhythm_policy

```json
{
  "session_rhythm_policy": {
    "min_action_interval_ms": 3000,
    "min_experiment_interval_ms": 30000,
    "cooldown_strategy": "exponential_backoff",
    "cooldown_base_minutes": 30,
    "cooldown_cap_minutes": 720,
    "resume_probe_mode": "recon_only"
  }
}
```

## risk_state_machine

```json
{
  "risk_state_machine": {
    "states": ["paused", "limited", "allowed"],
    "transitions": [
      { "from": "allowed", "to": "limited", "trigger": "risk_signal_detected" },
      { "from": "limited", "to": "paused", "trigger": "account_alert_or_repeat_risk" },
      { "from": "paused", "to": "limited", "trigger": "cooldown_backoff_window_passed_and_manual_approve" },
      { "from": "limited", "to": "allowed", "trigger": "stability_window_passed_and_manual_approve" }
    ],
    "hard_block_when_paused": ["live_write", "live_read_high_risk"]
  }
}
```

## issue_action_matrix

```json
{
  "issue_action_matrix": {
    "entries": [
      {
        "issue_scope": "issue_208",
        "state": "paused",
        "allowed_actions": ["dry_run", "recon"],
        "blocked_actions": [
          "live_read_limited",
          "live_read_high_risk",
          "reversible_interaction_with_approval",
          "live_write",
          "irreversible_write",
          "expand_new_live_surface_without_gate"
        ]
      },
      {
        "issue_scope": "issue_208",
        "state": "limited",
        "allowed_actions": ["dry_run", "recon", "reversible_interaction_with_approval"],
        "blocked_actions": [
          "live_read_limited",
          "live_read_high_risk",
          "irreversible_write",
          "live_write",
          "expand_new_live_surface_without_gate"
        ]
      },
      {
        "issue_scope": "issue_208",
        "state": "allowed",
        "allowed_actions": ["dry_run", "recon", "reversible_interaction_with_approval"],
        "blocked_actions": [
          "live_read_limited",
          "live_read_high_risk",
          "irreversible_write",
          "live_write",
          "expand_new_live_surface_without_gate"
        ]
      },
      {
        "issue_scope": "issue_209",
        "state": "paused",
        "allowed_actions": ["dry_run", "recon"],
        "blocked_actions": [
          "live_read_limited",
          "live_read_high_risk",
          "live_write",
          "irreversible_write",
          "expand_new_live_surface_without_gate"
        ]
      },
      {
        "issue_scope": "issue_209",
        "state": "limited",
        "allowed_actions": ["dry_run", "recon", "live_read_limited"],
        "blocked_actions": [
          "live_read_high_risk",
          "live_write",
          "irreversible_write",
          "expand_new_live_surface_without_gate"
        ]
      },
      {
        "issue_scope": "issue_209",
        "state": "allowed",
        "allowed_actions": [
          "dry_run",
          "recon",
          "live_read_limited",
          "live_read_high_risk"
        ],
        "blocked_actions": [
          "live_write",
          "irreversible_write",
          "expand_new_live_surface_without_gate"
        ]
      }
    ]
  }
}
```

约束：
- `issue_208` 与 `issue_209` 必须共享同一状态集合（`paused/limited/allowed`）。
- `paused` 下两者都不得包含任何 live 写或高风险 live 读动作。
- `limited` 下 `issue_208` 不得包含不可逆写动作。
- 每个 `(issue_scope, state)` 都必须同时定义 `allowed_actions` 与 `blocked_actions`，不得把阻断集合留给实现阶段猜测。

## risk_transition_audit

```json
{
  "risk_transition_audit": {
    "required_fields": [
      "run_id",
      "session_id",
      "issue_scope",
      "prev_state",
      "next_state",
      "trigger",
      "decision",
      "reason"
    ],
    "approval_fields_required_when": [
      "cooldown_backoff_window_passed_and_manual_approve",
      "stability_window_passed_and_manual_approve",
      "next_state_is_allowed"
    ],
    "on_missing_record": "force_pause_and_block_live",
    "rollback_entrypoint": "risk_state_reset_to_paused"
  }
}
```

## 兼容性约束

1. 新字段可追加，不允许改变既有字段语义。
2. `states` 不允许删除 `paused/limited/allowed` 任一状态。
3. `hard_block_when_paused` 缩减必须经过独立 spec review 说明。
4. `issue_action_matrix` 不允许为 `#208` 和 `#209` 定义不同状态集合。
5. `risk_transition_audit.required_fields` 缺失任一字段时，live 放行判定无效。

## 公开模式与阻断语义补充

1. `live_read_limited` 作为 Sprint 3 的正式公开模式，只适用于受控读 live，不得外溢为写路径或不可逆动作的隐式降级口径。
2. `gate_decision=allowed` 且 `requested_execution_mode|effective_execution_mode` 命中 `live_read_limited` 或 `live_read_high_risk` 时，必须复用 `FR-0010.approval_record` 与 `FR-0010.audit_record` 作为审批证据载体；其中 `approval_record.approved=true`、`approver`、`approved_at` 与完整 `checks` 均为必需。
3. `gate_decision=blocked` 时，`effective_execution_mode` 只允许表示真实未继续 live 的降级结果（当前为 `dry_run` 或 `recon`）；不得返回未实际执行的 `live_read_limited`。
4. `consumer_gate_result` 在 Sprint 3 中继续沿用 `FR-0010` 冻结字段，并允许 `requested_execution_mode|effective_execution_mode` 扩展为 `live_read_limited`；`#208/#209/#255` 不得自行定义私有审批证据字段绕过 `approval_record` / `audit_record`。
