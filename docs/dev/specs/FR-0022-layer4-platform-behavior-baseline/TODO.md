# FR-0022 TODO

## 评审阻断项

- [ ] `spec.md` 顶部已显式声明 `Canonical Issue: #238`。
- [ ] `spec.md` 已明确 `#238` 的 Layer 4 范围是“平台历史行为基线与偏移评估”，不越界为账号运营系统。
- [ ] `spec.md` 已明确挂接 `#423 -> #238` 与 `FR-0020`（`#239`）验证前置，且继承 `FR-0010/0011/0014` 边界。
- [ ] `spec.md` 已明确 `FR-0022` 只消费 `FR-0020` 的 `anti_detection_baseline_snapshot` / `anti_detection_baseline_registry_entry` / `anti_detection_validation_record`，且 `validation_scope=cross_layer_baseline` 是唯一正式输入入口。
- [ ] `spec.md` 已明确 active baseline 判定只能通过 `anti_detection_baseline_registry_entry.active_baseline_ref` 解析，不得由 Layer 4 仅凭 snapshot / record 自行宣布当前生效基线。
- [ ] `spec.md` 已明确 `platform_behavior_signal_batch` 必须携带 `request_ref/sample_ref/record_ref`，且三者必须属于同一条 `FR-0020` formal lineage。
- [ ] `spec.md` 已明确 `effective_execution_mode` 与 `probe_bundle_ref` 仍属于 Layer 4 baseline identity，不得把不同 recon/live scope 或不同 probe bundle 的 baseline 合并到同一 state / assessment。
- [ ] `spec.md` 已冻结 `baseline_state`（仅 `unseeded|learning|ready|degraded`）、`drift_level`、`decision_hint` 最小枚举。
- [ ] reviewer 已确认 Layer 4 结果只作为 `decision_hint`，不直接改写门禁真相源。
- [ ] reviewer 已确认当前 implementation-ready formal 输入不再把未 canonical 的 proxy binding 标为 Layer 4 必填字段；如未来要引入 `proxy_binding_ref`，必须先补上游 formal contract。
- [ ] reviewer 已确认 `platform_behavior_signal_batch`、`platform_behavior_baseline_state`、`platform_behavior_assessment` 已保留 `effective_execution_mode` 与 `probe_bundle_ref`，不再丢失 `FR-0020` formal baseline scope keys。
- [ ] reviewer 已确认 `platform_behavior_assessment` 已补齐 `baseline_ref` 与 `threshold_config_snapshot_ref`，满足 replay / audit 对基线快照与阈值快照的最小回链要求。
- [ ] reviewer 已确认 `platform_behavior_baseline_state` 以 `baseline_ref` 对齐上游 `active_baseline_ref`，不再使用未定义的 `baseline_version` 作为并行标识。
- [ ] reviewer 已确认 `browser_channel` 与 `execution_surface` 已分别收敛到 `Google Chrome stable` 与 `FR-0016` 共享枚举，不再并行发明私有编码。
- [ ] reviewer 已确认 `platform_behavior_baseline_state` 与 `platform_behavior_assessment` 的条件字段语义一致：`ready_at/last_assessed_at`、`decision_id/audit_record_ref` 不再跨文档漂移。
- [ ] reviewer 已确认 `session_id` 只作为可选会话坐标，不再被写成每个 Layer 4 signal batch 的硬前置。
- [ ] reviewer 已确认 pure-read 继承 `FR-0019`：只允许 `navigate|locate|click|extract|wait_settled`，且 `click` 只复用 `action=click + interaction_semantics=reveal_only_click`；出现 `type|submit|confirm|publish|purchase|dispatch|bind` 任一动作即不得标记为 `pure_read`。
- [ ] reviewer 已确认 `click_kind_mix`、`interaction_semantics` 与 `click_kind` 已保留 reveal-only click 语义，不会把 `FR-0019` 的合法点击退化为裸 `click`。
- [ ] reviewer 已确认下载链路进入 Layer 4 前必须先映射到 `goal_kind=read|write`，不再把 `download` 冻结为独立 Layer 4 goal。
- [ ] reviewer 已确认冷启动、学习期、ready、degraded、reseed 条件描述可形成实现断言。
- [ ] reviewer 已确认 `degraded` 与 `reseed_required` 的触发准则已冻结到 freshness、连续高漂移、污染/invalidated baseline 三类场景。
- [ ] `plan.md` 已补齐七节最小结构并写清实现前前置。
- [ ] `contracts/layer4-platform-behavior-baseline.md` 已冻结稳定对象与约束。
- [ ] `data-model.md` 已明确 `(profile, platform, browser_channel, execution_surface, effective_execution_mode, probe_bundle_ref)` 维度隔离，且未把未 canonical 的 proxy binding 写成当前 formal 必填输入。
- [ ] `risks.md` 已覆盖假阳性、样本污染、并行真相源和隐私最小化风险。

## 进入实现前必须完成

- [ ] FR-0022 spec review 通过并形成明确结论。
- [ ] `FR-0020`（`#239`）已合入 `main`，并提供 Layer 4 可消费的 `anti_detection_baseline_snapshot`、`anti_detection_baseline_registry_entry`、`anti_detection_validation_record` 与 `validation_scope=cross_layer_baseline` 正式输入。
- [ ] `FR-0020` 的 `effective_execution_mode` 与 `probe_bundle_ref` 已在 `FR-0022` baseline identity 中被保留，不会把不同 scope 的 baseline 合并。
- [ ] reviewer 确认 Layer 4 与 `FR-0010/0011` 门禁链路兼容。
- [ ] reviewer 确认 Layer 4 的数据最小化约束可执行。

## spec 通过后的实施清单（非本 PR）

- [ ] 实现行为信号归一化采集与入库校验。
- [ ] 实现基线状态迁移与漂移等级判定。
- [ ] 实现 `platform_behavior_assessment` 输出与审计留痕。
- [ ] 实现 Layer 4 输出被门禁链路消费的最小集成路径。
- [ ] 补齐状态机、阈值判定和回滚开关测试。

## 关联事项

- [ ] Refs #423
- [ ] Refs #238
- [ ] Refs #239
