# FR-0013 Layer 2 事件级拟人模拟契约

## 边界与适用范围

本契约定义 Layer 2 事件级拟人模拟增强的稳定机器边界，供后续读路径、写路径、平台适配器与测试模块共同消费。

本契约只定义：

1. 事件策略对象
2. 事件链对象
3. 节奏对象
4. 策略选择结果
5. 最小执行 trace

本契约不定义：

- `FR-0011` 的门禁、审批、审计、风险状态机或写路径动作等级
- Layer 3 session 行为引擎
- Layer 4 平台长期画像
- 平台完整发布闭环

## 继承约束

以下对象继续由 `FR-0011` 作为唯一正式来源：

- `write_interaction_tier`
- `risk_state_machine`
- `issue_action_matrix`
- `approval_record`
- `audit_record`
- `consumer_gate_result`

调用顺序必须是：

1. 先消费 `FR-0011` 的门禁结果与动作等级约束
2. 再选择 FR-0013 的 Layer 2 事件策略
3. 再执行状态收敛等待与结构化 trace 回传

## event_strategy_profile

```json
{
  "event_strategy_profile": {
    "action_kind": "composition_input",
    "preferred_path": "mixed_input",
    "fallback_path": "synthetic_chain",
    "requires_focus": true,
    "requires_hover_confirm": false,
    "requires_settled_wait": true,
    "blocked_when_tier": ["irreversible_write"]
  }
}
```

约束：

- `preferred_path` 只能是 `real_input` 或 `mixed_input`。
- `fallback_path` 只允许为 `synthetic_chain` 或为空。
- `mixed_input` 表示“真实 focus / click + 合成输入链”的混合路径。
- `blocked_when_tier` 只能引用 `FR-0011.write_interaction_tier` 的正式等级名。

## event_chain_policy

```json
{
  "event_chain_policy": {
    "chain_name": "composition_input",
    "action_kind": "composition_input",
    "required_events": [
      "focus",
      "compositionstart",
      "compositionupdate",
      "compositionend",
      "input",
      "change",
      "blur"
    ],
    "optional_events": ["mousedown", "mouseup", "click"],
    "completion_signal": ["dom_settled", "framework_value_updated"],
    "requires_settled_wait": true
  }
}
```

约束：

- `required_events` 不得为空。
- `completion_signal` 至少包含一个可判定结果。
- 若 `action_kind=plain_text_input`，`required_events` 不得自动继承 `composition*` 事件。
- 若 `requires_settled_wait=true`，执行方必须进入统一状态收敛等待。

## rhythm_profile

```json
{
  "rhythm_profile": {
    "profile_name": "default_layer2",
    "hover_confirm_min_ms": 80,
    "hover_confirm_max_ms": 200,
    "typing_delay_min_ms": 60,
    "typing_delay_max_ms": 220,
    "punctuation_pause_multiplier": 1.8,
    "long_pause_probability": 0.08,
    "scroll_segment_min_px": 120,
    "scroll_segment_max_px": 480,
    "lookback_probability": 0.12
  }
}
```

约束：

- 本对象只表达事件级节奏，不承载跨页面或跨 session 状态。
- `lookback_probability` 只用于滚动段内的回头翻看，不等于 Layer 3 的完整浏览行为。

## strategy_selection

```json
{
  "strategy_selection": {
    "action_kind": "composition_input",
    "selected_path": "mixed_input",
    "strategy_profile": "composition_input_default",
    "event_chain": "composition_input",
    "rhythm_profile": "default_layer2",
    "fallback_reason": null,
    "blocked_by": null
  }
}
```

约束：

- `selected_path` 允许取值：`real_input`、`mixed_input`、`synthetic_chain`、`blocked`。
- 当 `selected_path=synthetic_chain` 时，`fallback_reason` 必填。
- 当 `selected_path=blocked` 时，`blocked_by` 必填，且必须能追溯到 `FR-0011` 或本 FR 的正式约束。

## execution_trace

```json
{
  "execution_trace": {
    "action_kind": "composition_input",
    "selected_path": "mixed_input",
    "event_chain": "composition_input",
    "rhythm_profile_source": "default",
    "settled_wait_applied": true,
    "settled_wait_result": "settled",
    "failure_category": null
  }
}
```

约束：

- `rhythm_profile_source` 只允许 `default` 或 `platform_override`。
- `failure_category` 为空表示该次链路未进入失败分类。
- 最小失败分类建议至少覆盖：
  - `focus_not_acquired`
  - `framework_state_not_updated`
  - `target_drifted`
  - `blocked_by_fr0011`

## 兼容策略

- 本契约在 FR-0013 阶段冻结字段语义，后续实现只能追加字段，不能改写既有字段含义。
- 平台覆盖只允许改值，不允许发明另一套平行对象名称。
