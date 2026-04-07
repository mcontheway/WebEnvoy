# FR-0009 TODO（读写路径风险审查与保护门禁）

> 本文件记录 FR-0009 在 `#362` 语境下的 formal closeout 实际状态。`PR #388` 已作为 canonical formal-review PR 合入主干；本次 final writeback 只回写已发生事实，不再改动正式契约语义。

## Formal Review Repair Snapshot

- [x] `spec.md` 明确覆盖读路径（`#209`）与写路径（`#208`），无单侧遗漏。
- [x] `spec.md` 明确读域/写域分离：`www.xiaohongshu.com` vs `creator.xiaohongshu.com`。
- [x] `spec.md` 明确“目标不是更隐蔽或绕过风控”，而是风险收敛与账号安全。
- [x] `plan.md` 七个必答章节完整，且进入实现前条件可判定。
- [x] `contracts/risk-gates.md` 四对象完整且语义稳定。
- [x] `research.md` 与 `risks.md` 明确高风险 live 默认停用与恢复条件边界。
- [x] `research.md` 已沉淀代码级风险发现，并附可复核文件路径与风险解释。
- [x] `research.md` 已明确“插件事实中枢 vs CLI-first 叙事”定位张力及其治理影响。
- [x] `research.md` 已提供“文档已设计 / Phase 1 已落地 / 仍未落地”gap 清单，并说明与预警关系。
- [x] `spec.md` / `plan.md` / `contracts/` 已明确人工确认流程中的责任人，以及 formal closeout 留痕与后续执行层审批 / 审计载体的边界。
- [x] 当前 formal 套件已对齐 `#201/#208/#209` 的引用语境：`#201` 作为历史消费者，`#208/#209` 作为 issue 线程与后续 formal 套件的治理基线引用方，本轮不重定义后续验证事项的关闭语义。

## 当前 review 状态

- [x] `#362` 的 canonical formal-review PR（`#388`）已在 guardian `APPROVE` 后受控合入主干，approved_head=`e39aa45b6ae665f376a9cbce74b644c0eee5da11`，guardian_review=`https://github.com/mcontheway/WebEnvoy/pull/388#pullrequestreview-4065179465`，approved_at=`2026-04-07T00:30:22Z`，merge_commit=`d728024f0f3df7060f70ff83dd68101c4991f9c6`。
- [x] FR-0009 已记录为 `APPROVE`；审查证据锚定到 `https://github.com/mcontheway/WebEnvoy/pull/388#pullrequestreview-4065179465`。
- [x] FR-0009 已记录为 `formal_closeout = complete`；closeout 翻转依据是 guardian review artifact、`PR #388` merge 结果与已落地的 sync comments。

## 已完成的实现前收口项

- [x] 完成 FR-0009 spec review 并清零阻断意见。
- [x] 在 `#208` 的 issue 线程中写入“FR-0009 已冻结其后续 live / replay / 恢复讨论需要引用的条件与禁止动作边界”的 sync comment。permalink=`https://github.com/mcontheway/WebEnvoy/issues/208#issuecomment-4195752521`，recorded_at=`2026-04-07T00:31:45Z`。
- [x] 在 `#209` 的历史 issue 中写入“后续高风险 live 扩展需引用 FR-0009 治理基线”的 sync comment。permalink=`https://github.com/mcontheway/WebEnvoy/issues/209#issuecomment-4195752595`，recorded_at=`2026-04-07T00:31:46Z`。
- [x] 在 `#201` 的历史 issue 中补充“风险门禁前置已冻结，可作为历史 exit review 的补充输入”的 sync comment。permalink=`https://github.com/mcontheway/WebEnvoy/issues/201#issuecomment-4195752448`，recorded_at=`2026-04-07T00:31:43Z`。
- [x] 明确人工确认流程中的责任人、审批记录载体与审计留痕方式。
- [x] 明确 dry-run/侦察模式的默认启用策略和切换条件。
- [x] 将 FR-0009 gap 清单同步给 `#201/#208/#209` 作为统一治理口径输入。

## Formal Review 现状依据

- `#215` 继续作为 FR-0009 的 open FR 锚点，承接正式规约入口；`#362` 只承接本轮 formal 收口。
- `#213` 仍保留为当前 formal 套件与下游 Sprint 2/3 套件继续引用的 upstream issue；若后续要统一迁移到 `#215`，需在 dedicated follow-up 中先同步下游套件再切换 canonical anchor。
- `#201` 在本轮作为历史消费者引用；`#208/#209` 在本轮作为 issue 线程与后续 formal 套件的治理基线引用方；sync comment 只补统一口径，不借此改写其他 FR 已冻结的关闭语义。
- `FR-0009` 本轮只收 formal spec，不进入实现代码，也不以 live evidence 作为关闭依据。
- final writeback 已在 `PR #388` 合入、latest guardian `APPROVE`、GitHub checks 全绿、以及 `#201/#208/#209/#215` sync comment 落地后完成回写；所有 closeout 勾选项都保留了可复核 artifact / permalink。

## Spec 通过后的实施清单（后续事项）

- [ ] 起草实现 FR：将 `risk_gate_contract` 映射到运行时门禁决策逻辑。
- [ ] 补充契约测试：覆盖域名边界判定、模式门禁判定、恢复条件判定。
- [ ] 补充观测与审计输出：记录读写动作的门禁判定结果和人工确认轨迹。
- [ ] 回写 `#201` exit review：同步 Phase 1 治理前置状态。
