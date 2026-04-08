# FR-0019 TODO

## 评审阻断项

- [ ] `spec.md` 已明确 FR-0019 只承接 L2 首次可用，不混入完整 L2 平台、L1 兜底或导入/交付。
- [ ] `spec.md` 已明确继承 `FR-0017`、现有运行主链与风控边界，不重定义既有对象。
- [ ] `spec.md` 已冻结最小能力面、最小成功判定与最小失败大类。
- [ ] reviewer 已确认 `goal_kind=read` 的 `success=true` 必须完成 `extract` 并返回实际读取结果；`reveal_only_click` 仅为支持步骤，不构成独立成功终态。
- [ ] reviewer 已确认 `goal_kind=read` 的 request-side `allowed_actions` 必须显式包含 `extract`，否则请求需在进入执行前被拒绝。
- [ ] reviewer 已确认 `risk_state=paused | limited | allowed` 在本 FR 中的执行语义已冻结：`paused` 必阻断，`limited | allowed` 可执行当前受控 pure-read 路径。
- [ ] `spec.md` 已冻结 `candidate_shell_seed` 等 handoff 输出，并明确它不等于候选能力描述本身。
- [ ] `plan.md` 已补齐七节最小结构，并写清与 `#155/#153`、L1 fallback 的并行 / 串行关系。
- [ ] `contracts/l2-first-usable-capability.md` 已冻结稳定对象与边界。
- [ ] `data-model.md` 已明确成功产物与 handoff 输入结构。
- [ ] `risks.md` 已覆盖“首次成功被误当成已验证”“L2 失败伪装成成功”等风险。

## 进入实现前必须完成

- [ ] FR-0019 spec review 通过并形成明确结论。
- [ ] reviewer 确认 `#157` 在 `#368` 下的定位已表述清楚。
- [ ] reviewer 确认本 FR 没有重写现有运行主链、诊断与风控对象。
- [ ] reviewer 确认 L2 首次可用与 L1 fallback 的边界无冲突。

## spec 通过后的实施清单（非本 PR）

- [ ] 实现 L2 首次可用任务编排。
- [ ] 实现结构化成功产物与 handoff 输出构造。
- [ ] 实现最小失败大类映射。
- [ ] 为 L2 首次可用路径补齐契约测试与基本集成测试。

## 关联事项

- [ ] Refs #368
- [ ] Refs #157
- [ ] Refs #155
- [ ] Refs #153
