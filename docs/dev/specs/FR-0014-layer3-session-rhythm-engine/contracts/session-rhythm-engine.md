# FR-0014 Layer 3 session 行为节律引擎契约

## 边界与继承规则

本契约定义 `#237` 的稳定机器对象。它在 `FR-0010` / `FR-0011` / `#226` 的单口径基础上追加 Layer 3 所需的完整 session 节律对象。

以下对象继续继承，不得并行重定义：

1. `gate_input`
2. `gate_outcome`
3. `approval_record`
4. `audit_record`
5. `consumer_gate_result`
6. `risk_state_output`

本契约新增并冻结以下对象：

1. `session_rhythm_engine_input`
2. `session_rhythm_window_state`
3. `session_rhythm_event`
4. `session_rhythm_decision`
5. `session_rhythm_status_view`

## session_rhythm_engine_input

```json
{
  "session_rhythm_engine_input": {
    "run_id": "run_237_001",
    "session_id": "nm-session-237",
    "profile": "xhs_account_001",
    "platform": "xhs",
    "issue_scope": "issue_209",
    "risk_state": "limited",
    "requested_execution_mode": "live_read_limited",
    "action_type": "read",
    "triggered_at": "2026-03-24T08:00:00Z",
    "approval_record_ref": "approval_run_237_001",
    "latest_audit_event_id": "gate_evt_237_010"
  }
}
```

约束：

1. `risk_state`、`requested_execution_mode` 与 `action_type` 的语义一律继承 `FR-0010/0011`。
2. 该对象是引擎输入，不替代 `gate_input`。

## session_rhythm_window_state

```json
{
  "session_rhythm_window_state": {
    "window_id": "rhythm_win_001",
    "profile": "xhs_account_001",
    "platform": "xhs",
    "issue_scope": "issue_209",
    "session_id": "nm-session-237",
    "current_phase": "recovery_probe",
    "risk_state": "limited",
    "window_started_at": "2026-03-24T08:00:00Z",
    "window_deadline_at": "2026-03-24T08:05:00Z",
    "cooldown_until": "2026-03-24T08:00:00Z",
    "recovery_probe_due_at": "2026-03-24T08:02:00Z",
    "stability_window_until": "2026-03-24T08:20:00Z",
    "risk_signal_count": 2,
    "last_event_id": "rhythm_evt_007",
    "source_run_id": "run_237_001",
    "updated_at": "2026-03-24T08:01:00Z"
  }
}
```

约束：

1. `current_phase` 仅允许：
  - `warmup`
  - `steady`
  - `cooldown`
  - `recovery_probe`
  - `afterglow_hook`
2. 同一 `(profile, platform, issue_scope)` 同时只能有一个可写窗口。
3. `cooldown`、`recovery_probe`、稳定观察阶段必须显式填写对应截止时间字段。

## session_rhythm_event

```json
{
  "session_rhythm_event": {
    "event_id": "rhythm_evt_007",
    "profile": "xhs_account_001",
    "platform": "xhs",
    "issue_scope": "issue_209",
    "session_id": "nm-session-237",
    "window_id": "rhythm_win_001",
    "event_type": "recovery_probe_passed",
    "phase_before": "recovery_probe",
    "phase_after": "steady",
    "risk_state_before": "limited",
    "risk_state_after": "limited",
    "source_audit_event_id": "gate_evt_237_010",
    "reason": "RECON_PROBE_WITHOUT_RISK_SIGNAL",
    "recorded_at": "2026-03-24T08:01:00Z"
  }
}
```

约束：

1. `event_type` 只记录节律事件，不重写审批真相。
2. 由门禁/审批触发的事件必须能回链到 `audit_record.event_id`。

## session_rhythm_decision

```json
{
  "session_rhythm_decision": {
    "decision_id": "rhythm_decision_001",
    "window_id": "rhythm_win_001",
    "run_id": "run_237_001",
    "session_id": "nm-session-237",
    "profile": "xhs_account_001",
    "current_phase": "recovery_probe",
    "current_risk_state": "limited",
    "next_phase": "steady",
    "next_risk_state": "limited",
    "effective_execution_mode": "recon",
    "decision": "allowed",
    "reason_codes": [
      "RECOVERY_PROBE_ALLOWED",
      "RISK_STATE_LIMITED"
    ],
    "requires": [
      "approval_record_complete",
      "audit_record_present"
    ],
    "decided_at": "2026-03-24T08:01:00Z"
  }
}
```

约束：

1. `decision` 仅允许 `allowed`、`blocked`、`deferred`，不引入 `allow/block/rollback` 并行枚举。
2. `effective_execution_mode` 继续继承 `FR-0010/0011`。
3. `decision=allowed` 且涉及 live 时，必须能追溯到完整 `approval_record` 与 `audit_record`。
4. `decision=deferred` 表示窗口尚未满足，不得被调用方当成放行。

## session_rhythm_status_view

```json
{
  "session_rhythm_status_view": {
    "profile": "xhs_account_001",
    "platform": "xhs",
    "issue_scope": "issue_209",
    "current_phase": "steady",
    "current_risk_state": "limited",
    "window_state": "stability",
    "cooldown_until": null,
    "stability_window_until": "2026-03-24T08:20:00Z",
    "latest_event_id": "rhythm_evt_007",
    "latest_reason": "RECON_PROBE_WITHOUT_RISK_SIGNAL",
    "derived_at": "2026-03-24T08:01:02Z"
  }
}
```

约束：

1. 该对象只作为 `runtime.audit` 等查询接口的读模型。
2. 任何字段冲突时，以 `approval_record`、`audit_record`、`session_rhythm_window_state`、`session_rhythm_event` 真相源为准。

## 兼容性约束

1. 新增字段可追加，不允许改变既有字段语义。
2. 不允许新建 `risk_state_v2`、`approval_record_v2`、`audit_record_v2` 等并行正式对象。
3. `paused|limited|allowed` 仍是唯一正式风险状态集合。
4. `manual_confirmation_recorded` 不得重新成为独立正式机器字段；人工批准继续以 `approval_record` 为唯一正式承载。
5. `runtime.audit` 只读取 `session_rhythm_status_view`，不得直接写入窗口状态或事件链。
