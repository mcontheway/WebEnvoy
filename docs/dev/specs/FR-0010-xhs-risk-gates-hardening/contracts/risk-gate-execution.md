# FR-0010 门禁执行契约

## 边界

本契约定义 Sprint 2 风险门禁与执行硬化的稳定输出对象，供运行时门禁实现、`#208`、`#209` 与后续审计链路消费。
凡后续 FR 扩展 live 读模式，必须继续沿用本契约冻结的 `gate_input` / `gate_outcome` / `approval_record` / `audit_record` / `consumer_gate_result`，不得为同一字段再定义并行正式语义。

不定义：

- 平台业务命令实现细节
- 反风控完整行为引擎
- FR-0001 CLI 外层参数语义

## 输出对象

门禁判定必须包含以下对象：

1. `scope_context`
2. `gate_input`
3. `gate_outcome`
4. `approval_record`
5. `audit_record`
6. `consumer_gate_result`

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
    "target_tab_id": 924,
    "target_page": "search_result_tab",
    "action_type": "read",
    "requested_execution_mode": "live_read_high_risk",
    "risk_state": "paused"
  }
}
```

枚举：

- `action_type`: `read | write | irreversible_write`
- `requested_execution_mode`: `dry_run | recon | live_read_limited | live_read_high_risk | live_write`
- `risk_state`: `paused | limited | allowed`

约束：

1. `target_tab_id` 与 `target_page` 必须共同表达“目标 tab + 页面语义”；不允许只给页面类型字符串替代 tab 选择边界。
2. `requested_execution_mode` 只表示请求方模式，不承载门禁降级后的实际执行结果。
3. `requested_execution_mode=live_read_limited` 只允许与 `action_type=read` 搭配；写动作或不可逆写动作不得请求该模式。

## gate_outcome

```json
{
  "gate_outcome": {
    "effective_execution_mode": "dry_run",
    "gate_decision": "blocked",
    "gate_reasons": [
      "TARGET_TAB_NOT_EXPLICIT",
      "RISK_STATE_PAUSED",
      "MANUAL_CONFIRMATION_MISSING"
    ],
    "requires_manual_confirmation": true
  }
}
```

约束：

1. 默认 `effective_execution_mode` 必须是 `dry_run` 或 `recon`。
2. `requested_execution_mode` 为 `live_*` 时，如任一前置缺失必须 `gate_decision=blocked`。
3. `gate_reasons` 不得为空，必须可用于审计复盘。
4. `gate_decision` 在整个 FR-0010 套件中固定为标量枚举，不可作为对象层名称复用。
5. `gate_decision=blocked` 时，`effective_execution_mode` 只允许表示真实未继续 live 的降级模式，不得返回未实际执行的 `live_*`。
6. `effective_execution_mode=live_read_limited` 只允许表示读动作的真实继续执行路径，不得用于写动作或不可逆写动作。

## approval_record

```json
{
  "approval_record": {
    "approved": false,
    "approver": null,
    "approved_at": null,
    "checks": {
      "target_domain_confirmed": true,
      "target_tab_confirmed": true,
      "target_page_confirmed": true,
      "risk_state_checked": true,
      "action_type_confirmed": true
    }
  }
}
```

约束：

1. `approved=true` 时，`approver` 与 `approved_at` 必填。
2. `checks` 任一项为 `false`，不得放行 live。
3. `requested_execution_mode|effective_execution_mode` 命中 `live_read_limited`、`live_read_high_risk` 或 `live_write` 且 `gate_decision=allowed` 时，必须存在完整审批证据。

## audit_record

```json
{
  "audit_record": {
    "event_id": "gate_evt_001",
    "run_id": "run_001",
    "session_id": "nm-session-001",
    "profile": "xhs_account_001",
    "target_domain": "www.xiaohongshu.com",
    "target_tab_id": 924,
    "target_page": "search_result_tab",
    "action_type": "read",
    "requested_execution_mode": "live_read_high_risk",
    "effective_execution_mode": "dry_run",
    "gate_decision": "blocked",
    "gate_reasons": [
      "RISK_STATE_PAUSED",
      "MANUAL_CONFIRMATION_MISSING"
    ],
    "approver": null,
    "approved_at": null,
    "recorded_at": "2026-03-22T08:00:00Z"
  }
}
```

约束：

1. 每次门禁判定都必须生成审计记录。
2. 记录必须可被 `run_id/session_id` 检索。
3. `gate_reasons` 不得为空，必须能独立解释本次放行或阻断原因。
4. 若 `gate_decision=allowed`，`approver` 与 `approved_at` 必填；若为阻断，可为空。
5. `requested_execution_mode|effective_execution_mode` 命中 `live_read_limited`、`live_read_high_risk` 或 `live_write` 且 `gate_decision=allowed` 时，审计记录必须能独立证明审批已完成。

## consumer_gate_result

`#208` 与 `#209` 必须消费同一个标准化对象，不允许定义私有判定字段绕过门禁：

```json
{
  "consumer_gate_result": {
    "target_domain": "www.xiaohongshu.com",
    "target_tab_id": 924,
    "target_page": "search_result_tab",
    "action_type": "read",
    "requested_execution_mode": "live_read_high_risk",
    "effective_execution_mode": "dry_run",
    "gate_decision": "blocked",
    "gate_reasons": [
      "RISK_STATE_PAUSED"
    ]
  }
}
```

约束：

1. `target_domain`、`target_tab_id`、`target_page`、`action_type`、`requested_execution_mode`、`effective_execution_mode`、`gate_decision`、`gate_reasons` 为冻结字段。
2. `#208` 与 `#209` 只允许追加附加字段，不允许重定义冻结字段语义。
3. `requested_execution_mode` 与 `effective_execution_mode` 的正式枚举包含 `live_read_limited`，后续事项不得再为同一字段引入私有 mode 语义。

## #223 统一状态机锚点（规约层）

`#223` 在 Sprint 2 仅允许扩展本契约，不允许新建并行门禁契约。可引用锚点如下：

1. `gate_input.risk_state`：统一状态机的输入状态集合（当前 `paused|limited|allowed`）。
2. `gate_outcome.gate_decision` + `gate_outcome.gate_reasons`：统一阻断策略的可审计输出边界。
3. `audit_record`：统一状态机与阻断策略的追溯记录载体。

## 兼容性

1. 新增字段可追加，不允许改变既有字段语义。
2. FR-0009 作为治理基线保留；Sprint 2 实现统一消费本契约对象。
3. `gate_decision` 枚举值变更必须经过独立 spec review。
4. `gate_reasons` 的新增代码允许追加，不允许复用同义码造成歧义。
