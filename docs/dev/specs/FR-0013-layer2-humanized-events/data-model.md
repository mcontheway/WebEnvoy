# FR-0013 数据模型（Layer 2 事件级拟人模拟增强）

## 范围说明

本模型描述 FR-0013 规约阶段需要稳定交付的共享对象，不新增持久化 schema。它只定义实现阶段必须遵循的 Layer 2 共享实体语义，并显式继承 `FR-0011` 已冻结的门禁与状态机对象。

## 继承边界

以下对象由 `FR-0011` 继续作为唯一正式来源，FR-0013 只允许引用，不允许重定义：

- `write_interaction_tier`
- `session_rhythm_policy`
- `risk_state_machine`
- `issue_action_matrix`
- `approval_record`
- `audit_record`
- `consumer_gate_result`

FR-0013 的新增对象必须把这些对象视为前置输入或外部约束，而不是并列替代对象。

## 实体 1：Layer2EventStrategyProfile

- `action_kind` ENUM NOT NULL
- `preferred_path` ENUM NOT NULL（`real_input` | `mixed_input`）
- `fallback_path` ENUM NULL（`synthetic_chain`）
- `requires_focus` BOOLEAN NOT NULL
- `requires_hover_confirm` BOOLEAN NOT NULL
- `requires_settled_wait` BOOLEAN NOT NULL
- `blocked_when_tier` ARRAY NOT NULL

约束：

- `action_kind` 至少覆盖 `click`、`focus`、`keyboard_input`、`composition_input`、`hover`、`scroll`。
- `preferred_path` 不允许直接取 `synthetic_chain`。
- `fallback_path` 为空表示该动作不允许合成回退。
- `blocked_when_tier` 必须引用 `FR-0011.write_interaction_tier` 的正式等级名。

## 实体 2：Layer2EventChainPolicy

- `chain_name` TEXT NOT NULL
- `action_kind` ENUM NOT NULL
- `required_events` ARRAY NOT NULL
- `optional_events` ARRAY NOT NULL
- `completion_signal` ARRAY NOT NULL
- `requires_settled_wait` BOOLEAN NOT NULL

约束：

- `chain_name` 至少覆盖 `focus_acquire`、`plain_text_input`、`composition_input`、`hover_click`、`change_blur_finalize`。
- `required_events` 不得为空。
- `plain_text_input` 与 `composition_input` 的 `required_events` 不得完全相同。
- 若 `completion_signal` 为空，视为无效对象。

## 实体 3：Layer2RhythmProfile

- `profile_name` TEXT NOT NULL
- `hover_confirm_min_ms` INTEGER NOT NULL
- `hover_confirm_max_ms` INTEGER NOT NULL
- `typing_delay_min_ms` INTEGER NOT NULL
- `typing_delay_max_ms` INTEGER NOT NULL
- `punctuation_pause_multiplier` REAL NOT NULL
- `long_pause_probability` REAL NOT NULL
- `scroll_segment_min_px` INTEGER NOT NULL
- `scroll_segment_max_px` INTEGER NOT NULL
- `lookback_probability` REAL NOT NULL

约束：

- 所有时间和距离字段必须 > 0。
- `hover_confirm_max_ms` 必须 >= `hover_confirm_min_ms`。
- `typing_delay_max_ms` 必须 >= `typing_delay_min_ms`。
- 概率字段必须在 `0` 到 `1` 之间。
- 本对象只表达事件级节奏，不得承载 session 级状态或跨页面记忆。

## 实体 4：Layer2StrategySelection

- `action_kind` ENUM NOT NULL
- `selected_path` ENUM NOT NULL（`real_input` | `mixed_input` | `synthetic_chain` | `blocked`）
- `strategy_profile` TEXT NOT NULL
- `event_chain` TEXT NOT NULL
- `rhythm_profile` TEXT NOT NULL
- `fallback_reason` TEXT NULL
- `blocked_by` TEXT NULL

约束：

- `selected_path=synthetic_chain` 时，`fallback_reason` 必填。
- `selected_path=blocked` 时，`blocked_by` 必填。
- `blocked_by` 只能引用 `FR-0011` 的风险状态、动作分级或本 FR 明确的事件约束。

## 实体 5：Layer2ExecutionTrace

- `action_kind` ENUM NOT NULL
- `selected_path` ENUM NOT NULL
- `event_chain` TEXT NOT NULL
- `rhythm_profile_source` ENUM NOT NULL（`default` | `platform_override`）
- `settled_wait_applied` BOOLEAN NOT NULL
- `settled_wait_result` ENUM NOT NULL（`settled` | `timeout` | `skipped`）
- `failure_category` TEXT NULL

约束：

- `failure_category` 为空表示该次链路未进入失败分类。
- 若 `settled_wait_applied=true`，则 `settled_wait_result` 不得为 `skipped`。
- `rhythm_profile_source=platform_override` 时，不得改变本 FR 的字段语义，只允许覆盖值。

## 生命周期

1. FR-0013 规约阶段：冻结 Layer 2 共享实体语义。
2. 实现阶段：将这些实体映射到策略配置、运行时选择结果与测试夹具。
3. 后续阶段：平台适配器只允许覆盖值，不允许改语义；若需改语义，必须独立 spec review。
