# FR-0010 门禁执行契约

## 边界

本契约定义 Sprint 2 风险门禁与执行硬化的稳定输出对象，供运行时门禁实现、`#208`、`#209` 与后续审计链路消费。

不定义：

- 平台业务命令实现细节
- 反风控完整行为引擎
- FR-0001 CLI 外层参数语义

## 输出对象

门禁判定必须包含以下对象：

1. `scope_context`
2. `gate_input`
3. `gate_decision`
4. `approval_record`
5. `audit_record`

## scope_context

```json
{
  "scope_context": {
    "platform": "xhs",
    "read_domain": "www.xiaohongshu.com",
    "write_domain": "creator.xiaohongshu.com",
    "domain_mixing_forbidden": true
  }
}
```

约束：

1. 读写域必须显式存在，不允许隐式继承。
2. `domain_mixing_forbidden=true` 时，不允许单域成功推导另一域放行。

## gate_input

```json
{
  "gate_input": {
    "run_id": "run_001",
    "session_id": "nm-session-001",
    "profile": "xhs_account_001",
    "target_domain": "www.xiaohongshu.com",
    "target_tab_id": 32,
    "action_type": "read",
    "requested_mode": "live_read_high_risk",
    "risk_state": "paused"
  }
}
```

枚举：

- `action_type`: `read | write | irreversible_write`
- `requested_mode`: `dry_run | recon | live_read_high_risk | live_write`
- `risk_state`: `paused | limited | allowed`

## gate_decision

```json
{
  "gate_decision": {
    "effective_mode": "dry_run",
    "decision": "blocked",
    "reasons": [
      "TARGET_TAB_NOT_EXPLICIT",
      "RISK_STATE_PAUSED",
      "MANUAL_CONFIRMATION_MISSING"
    ],
    "requires_manual_confirmation": true
  }
}
```

约束：

1. 默认 `effective_mode` 必须是 `dry_run` 或 `recon`。
2. `requested_mode` 为 `live_*` 时，如任一前置缺失必须 `decision=blocked`。
3. `reasons` 不得为空，必须可用于审计复盘。

## approval_record

```json
{
  "approval_record": {
    "approved": false,
    "approver": null,
    "approved_at": null,
    "checks": {
      "target_domain_confirmed": true,
      "target_page_confirmed": false,
      "risk_state_checked": true,
      "action_type_confirmed": true
    }
  }
}
```

约束：

1. `approved=true` 时，`approver` 与 `approved_at` 必填。
2. `checks` 任一项为 `false`，不得放行 live。

## audit_record

```json
{
  "audit_record": {
    "event_id": "gate_evt_001",
    "run_id": "run_001",
    "session_id": "nm-session-001",
    "target_domain": "www.xiaohongshu.com",
    "action_type": "read",
    "requested_mode": "live_read_high_risk",
    "effective_mode": "dry_run",
    "decision": "blocked",
    "recorded_at": "2026-03-22T08:00:00Z"
  }
}
```

约束：

1. 每次门禁判定都必须生成审计记录。
2. 记录必须可被 `run_id/session_id` 检索。

## 兼容性

1. 新增字段可追加，不允许改变既有字段语义。
2. `decision` 枚举值变更必须经过独立 spec review。
3. `reasons` 的新增代码允许追加，不允许复用同义码造成歧义。
