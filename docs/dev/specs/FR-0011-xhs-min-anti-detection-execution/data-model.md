# FR-0011 数据模型（最小反风控执行能力）

## 范围说明

本模型描述 FR-0011 规约阶段需要稳定交付的共享对象，不新增持久化 schema，仅定义实现阶段必须遵循的数据结构语义。

## 实体 1：PluginGateOwnership

- `background_gate` ARRAY NOT NULL
- `content_script_gate` ARRAY NOT NULL
- `main_world_gate` ARRAY NOT NULL
- `cli_role` TEXT NOT NULL

约束：
- `background_gate` 至少包含 `target_domain_check` 与 `target_tab_check`。
- `cli_role` 仅允许描述“请求/结果壳”，不得声明门禁主判定。

## 实体 2：ReadExecutionPolicy

- `default_mode` ENUM NOT NULL（`dry_run` | `recon` | `live_limited`）
- `allowed_modes` ARRAY NOT NULL
- `blocked_actions` ARRAY NOT NULL
- `live_entry_requirements` ARRAY NOT NULL

约束：
- `default_mode` 在 FR-0011 生效阶段不得为高风险 live。
- `blocked_actions` 为空时视为无效对象。

## 实体 3：WriteInteractionTier

- `tiers` ARRAY NOT NULL
- `synthetic_event_default` ENUM NOT NULL（`blocked` | `limited` | `allowed`）
- `upload_injection_default` ENUM NOT NULL（`blocked` | `limited` | `allowed`）

约束：
- 必须存在 `irreversible_write` tier，且默认不可直接 live 放行。

## 实体 4：SessionRhythmPolicy

- `min_action_interval_ms` INTEGER NOT NULL
- `min_experiment_interval_ms` INTEGER NOT NULL
- `cooldown_after_risk_minutes` INTEGER NOT NULL
- `resume_probe_mode` ENUM NOT NULL（`recon_only` | `dry_run_only`）

约束：
- 所有间隔字段必须 > 0。

## 实体 5：RiskStateMachine

- `states` ARRAY NOT NULL（必须包含 `paused`、`limited`、`allowed`）
- `transitions` ARRAY NOT NULL
- `hard_block_when_paused` ARRAY NOT NULL

约束：
- `states` 缺任一基线状态视为无效。
- `hard_block_when_paused` 不能为空。

## 生命周期

1. FR-0011 规约阶段：冻结字段语义与约束。
2. 实现阶段：以该模型映射到运行时策略对象与测试用例。
3. 后续阶段：仅允许追加字段；改语义需独立 spec review。
