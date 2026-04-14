# FR-0023 请求级 admission 结果契约

## 边界

本契约定义 WebEnvoy 在消费上游授权输入后返回的请求级结果对象：

1. `request_admission_result`
2. `execution_audit`

本契约只描述 request-time admission 与请求级执行证据，不定义上游审批产品审计系统，也不改写 `FR-0010`、`FR-0011`、`FR-0014` 的既有 ownership。

## 内部运行时语义归属

以下语义继续属于 WebEnvoy 内部运行时，不作为上游授权主协议字段：

- `dry_run`
- `recon`
- `live_read_limited`
- `live_read_high_risk`
- `live_write`
- request-time admission
- execution audit
- session rhythm
- recovery probe
- cooldown gating

约束：

1. 上游正式对象只提供动作、资源、授权与现场；内部 mode 选择由 WebEnvoy 自行决定。
2. `FR-0010` 继续拥有 gate 输入 / 输出与 persisted trail。
3. `FR-0011` 继续拥有 admission evidence 与 live-entry 约束。
4. `FR-0014` 继续拥有 session rhythm / recovery 控制对象。
5. 本契约只冻结这些内部语义对外暴露的请求级结果边界。

## request_admission_result

```json
{
  "request_admission_result": {
    "request_ref": "upstream_req_001",
    "admission_decision": "blocked",
    "normalized_action_type": "read",
    "normalized_resource_kind": "anonymous_context",
    "runtime_target_match": false,
    "grant_match": true,
    "anonymous_isolation_ok": false,
    "effective_runtime_mode": "dry_run",
    "reason_codes": [
      "TARGET_RUNTIME_MISMATCH",
      "ANONYMOUS_CONTEXT_REQUIRES_LOGGED_OUT_SITE_CONTEXT"
    ],
    "derived_from": {
      "gate_input_ref": "run_001",
      "approval_admission_ref": "approval_admission_001",
      "audit_admission_ref": "audit_admission_001"
    },
    "decided_at": "2026-04-14T10:00:10Z"
  }
}
```

约束：

1. `admission_decision` 至少允许：
  - `allowed`
  - `blocked`
  - `degraded`
2. `reason_codes` 不得为空，必须独立解释为什么允许、阻断或降级。
3. `normalized_action_type` 必须与 `FR-0010.gate_input.action_type` 兼容。
4. `normalized_resource_kind` 必须与 `resource_binding.resource_kind` 一致。
5. `runtime_target_match=false` 时，必须返回 `admission_decision=blocked`，不得降级，也不得静默继续执行。
6. `anonymous_isolation_ok=false` 时，必须阻断匿名请求。
7. `effective_runtime_mode` 只作为 WebEnvoy 内部 mode 的请求级结果投影，不是上游正式审批字段。
8. `request_admission_result` 只能返回请求级事实，不得把 `active / cool_down / paused` 等上游资源状态写成 WebEnvoy 长期真相源。

## execution_audit

```json
{
  "execution_audit": {
    "audit_ref": "exec_audit_001",
    "request_ref": "upstream_req_001",
    "consumed_inputs": {
      "action_request_ref": "upstream_req_001",
      "resource_binding_ref": "binding_001",
      "authorization_grant_ref": "grant_001",
      "runtime_target_ref": "target_001"
    },
    "compatibility_refs": {
      "gate_run_id": "run_001",
      "approval_admission_ref": "approval_admission_001",
      "audit_admission_ref": "audit_admission_001",
      "approval_record_ref": "approval_run_001",
      "audit_record_ref": "gate_evt_001",
      "session_rhythm_window_id": "rhythm_win_001",
      "session_rhythm_decision_id": "rhythm_decision_001"
    },
    "request_admission_decision": "blocked",
    "risk_signals": [
      "ANONYMOUS_CONTEXT_LOGIN_CONTAMINATION",
      "RUNTIME_TARGET_OUT_OF_SCOPE"
    ],
    "recorded_at": "2026-04-14T10:00:11Z"
  }
}
```

约束：

1. `execution_audit` 是请求级执行证据，不等于上游审批产品的审计系统。
2. `consumed_inputs` 必须完整指向本次请求实际消费的四个外部正式对象。
3. `compatibility_refs` 必须允许回链到：
  - `FR-0010.approval_record / audit_record`
  - `FR-0011.approval_admission_evidence / audit_admission_evidence`
  - `FR-0014.session_rhythm_*`
4. `risk_signals` 不得为空数组；若无额外风险，也必须显式记录为无风险信号状态。
5. `execution_audit` 可以表达 request-time admission 与内部 rhythm / gate 的关系，但不得借此宣称自己拥有上游长期资源状态权威。

## 兼容映射要求

1. `request_admission_result` 必须能被确定性映射到 `FR-0010.gate_outcome` 的允许 / 阻断 / 降级结果。
2. `execution_audit.compatibility_refs` 必须支持从新输入对象回链到 `FR-0010/0011/0014` 的真相源对象。
3. `FR-0011.approval_admission_evidence` 与 `audit_admission_evidence` 继续是 pre-gate evidence，不得被 `execution_audit` 误写成 persisted trail。
4. `FR-0014.session_rhythm_decision.decision=allowed|blocked|deferred` 只影响 request-time admission / execution_audit，不得上升成上游资源运营状态真相源。

## 兼容性

1. 新增字段只允许向后兼容追加可选字段。
2. 若需要新增请求级结果对象、重定义 `admission_decision` 枚举，或改变 `effective_runtime_mode` 的角色，必须重新进入独立 spec review。
