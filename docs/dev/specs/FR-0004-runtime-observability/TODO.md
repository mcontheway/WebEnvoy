# FR-0004 TODO

> 本文件只记录 FR-0004 的 formal closeout 状态与实现消费边界；在可核实前提下，也允许回写 external review / guardian / merge facts，但不把 writeback 伪装成新的 spec review。

## 进入实现前条件（未来门禁）

- 待获得 `APPROVE`
- 待获得 `ready_for_implementation = true`
- 在后续实现前确认 FR-0004 的实现工作承接 FR-0001 外层壳与 FR-0002 transport 边界，不重写上游契约
- 在后续 formal review 通过后，确认 `contracts/runtime-observability.md`、`plan.md`、`risks.md` 已随套件一起完成 formal closeout 审查

## Formal 收口依据

- [x] `spec.md` 已收敛到 Phase 1 所需的最小观察与诊断面，没有把完整 pause / resume 系统混进来。
- [x] `plan.md` 已随正式套件完成 formal closeout 审查，不再保留未记录的收口前置。
- [x] `contracts/runtime-observability.md` 已与 FR-0001 外层壳兼容，且没有改写 FR-0002 已冻结的 transport 承载边界。
- [x] `#354` 已完成 FR-0001 formal 收口，因此 FR-0004 依赖的 CLI 外层响应壳与错误码兼容基线已冻结。
- [x] `spec.md` 与 `contracts/runtime-observability.md` 已冻结 `page_state`、`key_requests`、`failure_site`、`error.diagnosis` 的最小字段与最小枚举。
- [x] URL 净化、脱敏与截断边界已冻结，不再把这部分留给实现时临场判断。
- [x] `risks.md` 已覆盖敏感信息泄露、误分类、载荷膨胀与处理顺序错误的核心风险。
- [x] FR-0001 与 FR-0004 的职责边界没有交叉冲突。
- [x] `#355` 已完成通信闭环 formal 承接，因此 FR-0004 新增观测字段不构成 transport 侧阻塞。
- [x] 与 `#359` 的诊断落库边界、与 `#360` 的 `run_id` / 能力错误关联边界已冻结。
- [x] 当前 formal closeout 范围内的 findings 与 blockers 已收敛。
- [x] `#373` 承载 FR-0004 actual formal-review record；该 PR 在受控合并前已获得 guardian `APPROVE`，并于 `2026-04-06T06:36:14Z` 合入主干，merge commit 为 `3f16de8d8525aa36e77eaa16dfc028c0163ff016`。以上 PR 编号、guardian 通过结论与 merge commit 共同构成 merge-stable closeout evidence。

## 当前 review 状态

- [x] `#357` 当前只回写 FR-0004 正式套件的 review 状态，不重开 FR-0004 边界或实现范围。
- [x] FR-0004 已记录为 `APPROVE`。
- [x] FR-0004 已记录为 `ready_for_implementation = true`。
- [x] FR-0004 已记录为 `formal_closeout = complete`。

## 进入实现后由后续事项承接

- [ ] 接入成功 / 错误响应的结构化输出
- [ ] 接入 URL 净化、脱敏与截断规则
- [ ] 补齐诊断分类、契约和边界测试
