# FR-0011 最小反风控执行契约

## 边界与适用范围

本契约定义 Sprint 3 的最小反风控执行能力输出对象，供 `#208` 与 `#209` 在进入 live 扩展前统一消费，并作为 `#223` 的统一状态机/阻断策略接口基线。

本契约不定义：
- 平台规避策略细节
- 完整发布流程实现
- 账号矩阵调度模型

## 输出对象

必须包含以下七个对象：
1. `plugin_gate_ownership`
2. `read_execution_policy`
3. `write_interaction_tier`
4. `session_rhythm_policy`
5. `risk_state_machine`
6. `issue_action_matrix`
7. `risk_transition_audit`

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
    "allowed_modes": ["dry_run", "recon", "live_limited"],
    "blocked_actions": ["expand_new_live_surface_without_gate"],
    "live_entry_requirements": [
      "risk_state_not_paused",
      "target_domain_confirmed",
      "manual_confirmation_recorded"
    ]
  }
}
```

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
    "cooldown_after_risk_minutes": 60,
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
      { "from": "paused", "to": "limited", "trigger": "cooldown_passed_and_manual_approve" },
      { "from": "limited", "to": "allowed", "trigger": "stability_window_passed" }
    ],
    "hard_block_when_paused": ["live_write", "high_risk_live_read"]
  }
}
```

## issue_action_matrix

```json
{
  "issue_action_matrix": {
    "issue_208": {
      "paused": ["dry_run", "recon"],
      "limited": ["recon", "reversible_interaction_with_approval"],
      "allowed": ["approved_scope_actions"],
      "blocked_actions": ["live_write", "irreversible_write"]
    },
    "issue_209": {
      "paused": ["dry_run", "recon"],
      "limited": ["recon", "live_read_limited_with_approval"],
      "allowed": ["approved_scope_actions"],
      "blocked_actions": ["live_write", "expand_new_live_surface_without_gate"]
    }
  }
}
```

约束：
- `issue_208` 与 `issue_209` 必须共享同一状态集合（`paused/limited/allowed`）。
- `paused` 下两者都不得包含任何 live 写或高风险 live 读动作。
- `limited` 下 `issue_208` 不得包含不可逆写动作。
- 每个 issue scope 都必须显式给出 `blocked_actions`，不得把阻断集合留给实现阶段猜测。

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
      "reason",
      "approver",
      "approved_at"
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
