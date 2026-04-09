# FR-0022 TODO

## 评审阻断项

- [ ] `spec.md` 顶部已显式声明 `Canonical Issue: #238`。
- [ ] `spec.md` 已明确 `#238` 的 Layer 4 范围是“平台历史行为基线与偏移评估”，不越界为账号运营系统。
- [ ] `spec.md` 已明确挂接 `#423 -> #238` 与 `FR-0020`（`#239`）验证前置，且继承 `FR-0010/0011/0014` 边界。
- [ ] `spec.md` 已冻结 `baseline_state`（仅 `unseeded|learning|ready|degraded`）、`drift_level`、`decision_hint` 最小枚举。
- [ ] reviewer 已确认 Layer 4 结果只作为 `decision_hint`，不直接改写门禁真相源。
- [ ] reviewer 已确认 `platform_behavior_signal_batch`、`platform_behavior_baseline_state`、`platform_behavior_assessment` 已补齐 `browser_channel/execution_surface/runtime_context_id/proxy_binding_ref` 等必填语义。
- [ ] reviewer 已确认 pure-read 继承 `FR-0019`：只允许 `navigate|locate|reveal_only_click|extract|wait_settled`，出现 `type|submit` 即不得标记为 `pure_read`。
- [ ] reviewer 已确认冷启动、学习期、ready、degraded、reseed 条件描述可形成实现断言。
- [ ] `plan.md` 已补齐七节最小结构并写清实现前前置。
- [ ] `contracts/layer4-platform-behavior-baseline.md` 已冻结稳定对象与约束。
- [ ] `data-model.md` 已明确 profile/platform 维度隔离与审计回链。
- [ ] `risks.md` 已覆盖假阳性、样本污染、并行真相源和隐私最小化风险。

## 进入实现前必须完成

- [ ] FR-0022 spec review 通过并形成明确结论。
- [ ] `FR-0020`（`#239`）已合入 `main`，并冻结 Layer 4 验证方法与阈值评估口径。
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
