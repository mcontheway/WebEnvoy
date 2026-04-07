# FR-0011 TODO（最小反风控执行能力 formal closeout）

> 本文件记录 FR-0011 在 `#365` 语境下的 formal closeout 实际状态。本轮 writeback 只回写已发生事实，不再改动 `FR-0011` 的正式契约语义，不回滚 `#208` 已在 2026-04-02 完成真实验证并关闭的既有状态。

## Formal Review Repair Snapshot（#365）

- [x] `spec.md` 已覆盖目标、非目标、功能需求、GWT、异常与边界场景、验收标准、依赖与前置条件。
- [x] `plan.md` 已补齐七节最小结构，并把进入实现前条件写成可判定条目。
- [x] `contracts/anti-detection-execution.md` 已冻结 Sprint 3 的稳定对象、`#208` 唯一正式验证对象边界，以及与 `FR-0010` 的继承关系。
- [x] `research.md`、`risks.md`、`data-model.md` 已补齐，并能支撑 formal spec review 判定。
- [x] `#208/#209` 的三态差异化阻断矩阵、`live_read_limited` 正式公开模式语义、`limited_read_rollout_ready_true` 条件载体、以及 `gate_decision=blocked` 时的 `effective_execution_mode` 语义已在 FR-0011 套件内冻结。
- [x] `#208` 的 gate-only `page_state` / `key_requests=[]` / `failure_site` 语义，以及 `editor_input` 单动作真实验证边界、成功/失败信号、最小 replay 与关闭语义已在 FR-0011 套件内冻结。
- [x] `#208` 与 `#209` 均已在 GitHub issue 线程明确回写为 FR-0011 的前置消费者。
- [x] `#216` 的 Sprint / milestone 治理重排已在 2026-03-23 完成，当前里程碑语义已与 roadmap 对齐。
- [x] `#208` 在 2026-03-30 的“验证前置已冻结、不等于正式验证已完成”判断，只适用于 `PR #298` 合入后的阶段；该临时状态已被 2026-04-02 的真实验证闭环关闭事实覆盖，不再作为当前 closeout 结论回写。

## 当前 review 状态

- [x] `#362` 已在 2026-04-07 关闭，作为 FR-0011 closeout 的 hard prerequisite 已满足。
- [x] `#363` 已在 2026-04-07 关闭，作为 FR-0011 closeout 的 strong sequencing dependency 已满足。
- [x] 截至 2026-04-07，FR-0011 当前 formal closeout 不再存在待清零的 spec review 阻断项；本轮只补仓库内 truth sync，不再改写 formal contract。
- [x] `#365` 对应的 closeout 目标固定为：回写 formal review 结论、同步 `#208/#209` 前置语义、保留 `#208` 的已关闭真相、并确认 `#216` 治理编排已落地。

## 已完成的实现前收口项

- [x] 2026-03-23：`#216` 的治理重排已完成并并入主干；对应说明见 `https://github.com/mcontheway/WebEnvoy/issues/216#issuecomment-4109512730`。
- [x] 2026-03-23：`#209` issue 线程已补记 FR-0011 为后续 live 扩展必须共享的状态机、受控 live 模式、审批与审计契约前置；permalink=`https://github.com/mcontheway/WebEnvoy/issues/209#issuecomment-4111040556`。
- [x] 2026-03-30：`PR #298` 已合入，FR-0011 正式冻结 `#208` 的唯一正式验证对象 `editor_input`、验证范围、成功/失败信号、最小 replay 与关闭语义；对应 issue sync comment 为 `https://github.com/mcontheway/WebEnvoy/issues/208#issuecomment-4154709121`。
- [x] 2026-03-30：`#208` issue 线程已明确“前置已冻结，但真实验证尚未完成”的阶段性判断；对应 blocker 收敛 comment 为 `https://github.com/mcontheway/WebEnvoy/issues/208#issuecomment-4155264514`。
- [x] 2026-04-02：`#208` 已因真实 `editor_input` 验证闭环完成而关闭；正式关闭说明见 `https://github.com/mcontheway/WebEnvoy/issues/208#issuecomment-4175558542`。
- [x] 2026-04-07：`#208` / `#209` 已继续同步 FR-0009 与 FR-0010 的 formal closeout 口径，不影响 FR-0011 已冻结边界继续作为 Sprint 3 的单一真相源；对应 comment 分别为 `https://github.com/mcontheway/WebEnvoy/issues/208#issuecomment-4199076361` 与 `https://github.com/mcontheway/WebEnvoy/issues/209#issuecomment-4199076389`。

## Formal Review 现状依据

- `#231` 继续作为 FR-0011 的 open FR 锚点，承接正式规约入口；`#365` 只承接本轮 formal closeout writeback，不替代锚点职责。
- `#217` 保留为 FR-0011 的历史起草 issue；其“建立正式 FR 套件并完成 spec review 准备”的职责已完成，不再承担当前 open anchor 语义。
- `#208` 的时间线必须按绝对日期解释：
  - 2026-03-30：`PR #298` 合入，冻结“进入真实验证前置”和“当时尚未完成”的关闭语义。
  - 2026-04-02：`#208` 后续真实验证闭环完成并关闭；该事实覆盖此前临时状态，不能被 `#365` 回写回未完成。
- `#209` 已关闭的“首个平台 L3 真实读闭环”事实保持不变；FR-0011 在其 issue 线程中的作用，是冻结后续 live 扩展必须继续消费的 Sprint 3 前置，而不是回退既有完成状态。
- `#216` 的治理重排已完成；截至 2026-04-07，里程碑现状仍保持 `sprint-2-risk-gates-hardening`、`sprint-3-min-anti-detection-execution`、`sprint-4-capability-packaging` 三个顺延后的正式阶段名，不再把该治理事项保留为未完成 blocker。
- 本轮 `#365` closeout 只做 docs-only formal truth sync，不进入实现代码，不把 live evidence 自身作为本 PR 的放行依据，也不修改 `FR-0011` 的正式行为边界。

## Spec 通过后的实施清单（后续事项）

- [ ] 实现插件层门禁主落点（background/content-script/main world）。
- [ ] 实现读路径执行模式收敛（默认 `dry_run/recon` + 受控 live）。
- [ ] 实现写路径交互分级判定与默认阻断。
- [ ] 实现最小 risk 状态机（`paused/limited/allowed`）。
- [ ] 实现 `#208/#209` 三态差异化阻断矩阵（统一判定入口）。
- [ ] 实现 session 节律/冷却/恢复最小约束。
- [ ] 实现状态变更审计落盘与缺失审计回退 `paused` 逻辑。
- [ ] 为 `#208` gate-only success / blocked 场景补齐 `page_state` 契约测试。
- [ ] 以 FR-0011 当前冻结的 `editor_input` 验证边界为准，为 `#208` 的单动作真实验证补齐最小 replay 与证据回传。
- [ ] 如需正式引入 `xhs.editor_input` 或 `xhs.interact`，先单独起 command contract 规约 PR。
- [ ] 补齐对应契约测试与状态迁移测试。

## 关联事项

- [x] Open FR anchor: `#231`
- [x] Historical suite setup: `#217`
- [x] Formal closeout writeback: `#365`
- [x] Spec review closure: 已由 `#365` formal closeout truth sync 收口，不再保留“待本 PR review 收口”的陈旧表述
- [x] Governance: `#216`
- [x] Upstream: `#213` / `FR-0009`
- [x] Strong sequencing dependency: `#363`
- [x] Hard prerequisite: `#362`
- [x] Downstream: `#208` / `#209`
