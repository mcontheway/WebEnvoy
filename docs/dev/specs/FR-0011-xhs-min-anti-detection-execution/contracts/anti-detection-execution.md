# FR-0011 最小反风控执行契约

## 边界与适用范围

本契约定义 Sprint 3 的最小反风控执行能力输出对象，供 `#208` 与 `#209` 在进入 live 扩展前统一消费。
凡涉及 `requested_execution_mode`、`effective_execution_mode`、`gate_decision`、`approval_record`、`audit_record` 的稳定机器边界，本 FR 显式继承 `FR-0010` 的 `gate_outcome` / `approval_record` / `audit_record` / `consumer_gate_result`，只补充 Sprint 3 对 `live_read_limited` 与状态机的新增约束，不并行重定义另一套门禁结果对象。

本契约不定义：
- 平台规避策略细节
- 完整发布流程实现
- 账号矩阵调度模型
- `xhs.editor_input` / `xhs.interact` 的正式命令 schema

## `#208` 命令边界补充

`issue_action_matrix` 中 `issue_208` 使用的 `reversible_interaction_with_approval`，是治理动作类别，不是正式命令接口名。

补充约束：
- `FR-0008.minimal_action_candidates.action_id=editor_input` 只表示“当前推荐作为 `#208` 正式验证对象的最小页面交互动作”，不等于已冻结 `xhs.editor_input` 命令。
- 当前 FR 允许实现侧围绕 `issue_208` 暴露 gate-only 验证结果，并在 `allowed + approval + audit` 前置满足时暴露 `editor_input` 的单动作真实验证结果；但不允许借此宣称 `xhs.editor_input` 或 `xhs.interact` 已拥有正式稳定的命令名、输入 schema、输出 schema、错误码或 live 写结果契约。
- 上述 `editor_input` 真实验证路径在正式机器字段上，必须继续复用 `FR-0010` 的 `action_type=write`、`requested_execution_mode=live_write`、`effective_execution_mode=live_write`、`gate_decision=allowed`；`reversible_interaction_with_approval` 只作为 issue 级治理动作类别，不新增私有 execution mode。
- 若后续需要新增 `xhs.editor_input` 或 `xhs.interact`，必须先通过独立正式 contract 冻结命令边界，再进入实现合并。

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
      "gate_input_risk_state_limited_or_allowed",
      "risk_state_checked",
      "target_domain_confirmed",
      "target_tab_confirmed",
      "target_page_confirmed",
      "action_type_confirmed",
      "approval_record_approved_true",
      "approval_record_approver_present",
      "approval_record_approved_at_present",
      "approval_record_checks_all_true"
    ]
  }
}
```

约束：
- `live_read_limited` 是正式公开的受控 live 读模式，可由外部请求方显式请求。
- `live_read_limited` 与 `live_read_high_risk` 进入 live 前都必须满足 `live_entry_requirements`，且审批证据要求不可分叉。
- `live_entry_requirements` 仅定义 live 读模式共享必备前置；其满足仅表示进入 live 判定所需必要条件，不表示在当前 `risk_state` 自动放行全部 live 读模式。
- `gate_input_risk_state_limited_or_allowed` 表示 `FR-0010.gate_input.risk_state` 只能为 `limited` 或 `allowed`；若为 `paused`，不得进入 live 判定。
- `approval_record_approved_true` 表示 `FR-0010.approval_record.approved=true`；`approval_record_approver_present` / `approval_record_approved_at_present` 表示 `approver` 与 `approved_at` 已填写。
- `approval_record_checks_all_true` 表示 `FR-0010.approval_record.checks.target_domain_confirmed`、`target_tab_confirmed`、`target_page_confirmed`、`risk_state_checked`、`action_type_confirmed` 全为 `true`。
- `manual_confirmation_recorded` 不再作为独立机器条件名存在；人工确认的正式机器承载统一落在 `approval_record.approved=true`、`approver`、`approved_at` 与完整 `checks` 上。
- `live_entry_requirements` 必须与 `FR-0010.approval_record` / `FR-0010.audit_record` 的完整审批与审计证据保持同一口径，至少显式覆盖 `risk_state_checked` 与 `action_type_confirmed`，不允许保留更宽松的只读前置。
- `FR-0010.audit_record` 在本 FR 中继续作为门禁判定后的必写审计留痕，而不是 live 放行前置；当 `gate_decision=allowed` 时，审计记录必须能独立证明审批已完成。
- 具体 `(issue_scope, state, execution_mode)` 是否允许，必须再受 `issue_action_matrix` 的显式边界约束；若与 `live_entry_requirements` 出现冲突，以 `issue_action_matrix` 为准。
- 若请求被门禁阻断，`effective_execution_mode` 不得表达未实际继续执行的 `live_*` 模式。

## write_interaction_tier

```json
{
  "write_interaction_tier": {
    "tiers": [
      { "name": "observe_only", "live_allowed": false },
      { "name": "reversible_interaction", "live_allowed": "allowed" },
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
    "hard_block_when_paused": ["live_read_limited", "live_read_high_risk", "live_write"]
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
        "conditional_actions": [],
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
        "allowed_actions": ["dry_run", "recon"],
        "conditional_actions": [],
        "blocked_actions": [
          "live_read_limited",
          "live_read_high_risk",
          "reversible_interaction_with_approval",
          "irreversible_write",
          "live_write",
          "expand_new_live_surface_without_gate"
        ]
      },
      {
        "issue_scope": "issue_208",
        "state": "allowed",
        "allowed_actions": ["dry_run", "recon"],
        "conditional_actions": [
          {
            "action": "reversible_interaction_with_approval",
            "requires": [
              "approval_record_approved_true",
              "approval_record_approver_present",
              "approval_record_approved_at_present",
              "approval_record_checks_all_true"
            ]
          }
        ],
        "blocked_actions": [
          "live_read_limited",
          "live_read_high_risk",
          "irreversible_write",
          "upload_submit_publish_chain",
          "expand_new_live_surface_without_gate"
        ]
      },
      {
        "issue_scope": "issue_209",
        "state": "paused",
        "allowed_actions": ["dry_run", "recon"],
        "conditional_actions": [],
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
        "allowed_actions": ["dry_run", "recon"],
        "conditional_actions": [
          {
            "action": "live_read_limited",
            "requires": [
              "approval_record_approved_true",
              "approval_record_approver_present",
              "approval_record_approved_at_present",
              "approval_record_checks_all_true"
            ]
          }
        ],
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
          "recon"
        ],
        "conditional_actions": [
          {
            "action": "live_read_limited",
            "requires": [
              "approval_record_approved_true",
              "approval_record_approver_present",
              "approval_record_approved_at_present",
              "approval_record_checks_all_true"
            ]
          },
          {
            "action": "live_read_high_risk",
            "requires": [
              "approval_record_approved_true",
              "approval_record_approver_present",
              "approval_record_approved_at_present",
              "approval_record_checks_all_true"
            ]
          }
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
- 在当前 formal contract freeze 中，`issue_208` 只允许在 `allowed` 下通过 `conditional_actions` 放行 `reversible_interaction_with_approval`，且该动作仅限 `editor_input` 单动作正式验证，不得扩张到上传、提交、发布确认或完整写链路。
- `issue_208` 的 `reversible_interaction_with_approval` 一旦被放行，必须继续落在 `FR-0010` 已冻结的门禁字段上：`action_type=write`、`requested_execution_mode=live_write`，且只有真实交互实际发生时才允许 `effective_execution_mode=live_write`；若仍停留 gate-only，则 `effective_execution_mode` 只能为 `dry_run` 或 `recon`。
- 每个 `(issue_scope, state)` 都必须同时定义 `allowed_actions` 与 `blocked_actions`；若存在需附加审批/审计前置的动作，还必须定义 `conditional_actions`，不得把条件放行集合留给实现阶段猜测。
- `conditional_actions` 在所有 entry 中都必须显式出现；无条件动作场景下使用空数组，不得靠字段缺失表达“无条件动作”。
- `allowed_actions` 仅表示无需额外审批前置即可执行的动作；`conditional_actions` 表示命中当前 `(issue_scope, state)` 后仍需满足 `requires` 中附加审批/审计条件的动作。
- live 读模式不得以裸字符串形式出现在 `allowed_actions` 中；若需审批证据，必须落入 `conditional_actions` 并显式列出 `requires`。
- `issue_209` 在 `limited` 下仅可通过 `conditional_actions` 放行 `live_read_limited`，不得放行 `live_read_high_risk`。
- `upload_submit_publish_chain` 表示所有超出 `editor_input` 单动作验证边界的写链路集合；该集合在 `issue_208` 当前 formal contract freeze 中必须持续阻断。

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

## `#208` gate-only 可观测性补充

当 `issue_scope=issue_208` 且请求仍处于 gate-only 验证前置阶段时，返回对象必须满足以下最小语义：

```json
{
  "observability": {
    "page_state": {
      "page_kind": "compose|login|unknown",
      "url": "normalized_url",
      "title": "document title",
      "ready_state": "loading|interactive|complete"
    },
    "key_requests": [],
    "failure_site": null
  }
}
```

补充约束：
1. gate-only success 必须返回最小 `observability.page_state`；`failure_site` 必须为 `null`；`key_requests` 必须为空数组。
2. gate blocked 允许返回最小 `observability.page_state`；`key_requests` 仍必须为空数组；`failure_site` 必须继续继承 `FR-0004.observability.failure_site` 的最小字段集合（`stage`、`component`、`target`、`summary`），其中 `component` 必须为 `gate`。
3. 上述两类场景都不得返回真实页面写入完成信号，不得返回真实 `interaction_result`，也不得触发真实编辑器写入。
4. `page_state` 最小字段继续复用 `FR-0004` 的正式定义；本 FR 只补充 `#208` gate-only 场景下“必须返回/允许返回”的使用边界，不重定义字段本身。

## `#208` 真实验证结果补充

当 `issue_scope=issue_208`、`risk_state=allowed` 且 `reversible_interaction_with_approval` 满足附加审批/审计前置时，返回对象允许携带 `editor_input` 单动作真实验证结果。

```json
{
  "interaction_result": {
    "validation_action": "editor_input",
    "target_page": "creator.xiaohongshu.com/publish",
    "success_signals": ["editor_focused", "text_visible", "text_persisted_after_blur"],
    "failure_signals": ["focus_lost", "text_reverted", "risk_prompt", "dom_variant"],
    "minimum_replay": ["focus_editor", "type_short_text", "blur_or_reobserve"],
    "out_of_scope_actions": ["image_upload", "submit", "publish_confirm"]
  }
}
```

补充约束：
1. `interaction_result` 只允许出现在 `issue_208` 的真实验证场景，不得复用为通用写命令输出壳。
2. `validation_action` 当前只能为 `editor_input`，且目标页固定为 `creator.xiaohongshu.com/publish`。
3. 当 `interaction_result` 出现时，对应门禁记录必须仍复用 `FR-0010` 冻结字段：`action_type=write`、`requested_execution_mode=live_write`、`effective_execution_mode=live_write`、`gate_decision=allowed`。
4. `success_signals` 必须至少覆盖“聚焦成功、文本可见、最小失焦或重新观测后仍保留”三类信号。
5. `failure_signals` 必须至少覆盖“焦点丢失、文本回退、风险提示、DOM 漂移”四类信号。
6. `minimum_replay` 只定义最小复现实验步骤，不等于稳定 API/CLI contract。
7. `out_of_scope_actions` 必须显式排除上传、提交、发布确认等超范围动作。
7. 该场景下 `interaction_result` 只能作为 `FR-0010.consumer_gate_result` 的补充字段返回，不得新建平行结果对象，也不得改写其冻结字段语义。

## 公开模式与阻断语义补充

1. `live_read_limited` 作为 Sprint 3 的正式公开模式，只适用于受控读 live，不得外溢为写路径或不可逆动作的隐式降级口径。
2. `gate_decision=allowed` 且 `requested_execution_mode|effective_execution_mode` 命中 `live_read_limited` 或 `live_read_high_risk` 时，必须复用 `FR-0010.approval_record` 与 `FR-0010.audit_record` 作为审批证据载体；其中 `approval_record.approved=true`、`approver`、`approved_at` 与完整 `checks` 均为必需。
3. `gate_decision=blocked` 时，`effective_execution_mode` 只允许表示真实未继续 live 的降级结果（当前为 `dry_run` 或 `recon`）；不得返回未实际执行的 `live_read_limited`。
4. `consumer_gate_result` 在 Sprint 3 中继续沿用 `FR-0010` 冻结字段；`issue_209` 的受控 live 继续使用 `live_read_limited`，`issue_208` 的 `editor_input` 真实验证继续使用 `action_type=write` 与 `requested_execution_mode|effective_execution_mode=live_write` 的既有字段组合；`#208/#209` 与后续实现事项不得自行定义私有 mode、私有审批证据字段或平行 gate result 绕过 `approval_record` / `audit_record`。
5. `#208` 的 `editor_input` 单动作真实验证不新增新的 `requested_execution_mode` / `effective_execution_mode` 枚举；它在门禁字段上复用 `live_write`，在 issue 级边界上受 `issue_action_matrix` 的 `reversible_interaction_with_approval` 条件约束。
