# FR-0011 TODO（最小反风控执行能力 closeout note）

> 本文件只记录 FR-0011 formal closeout 后仍会影响正式契约解释和后续实现入口的要点，不作为 GitHub issue、Project、里程碑或关闭状态的本地真相源。

## Formal Closeout Note（#365）

- [x] `spec.md`、`plan.md`、`contracts/anti-detection-execution.md`、`research.md`、`risks.md`、`data-model.md` 已构成完整 formal review 输入，本轮 closeout 不再改动其正式契约语义。
- [x] FR-0011 已冻结 Sprint 3 的核心边界：插件层门禁主落点、读路径执行模式收敛、写路径交互分级、最小 session 节律/冷却/恢复、以及 `paused/limited/allowed` 风险状态机。
- [x] FR-0011 已冻结 `#208/#209` 共享的状态机、审批/审计边界、`live_read_limited` 正式公开模式语义、`limited_read_rollout_ready_true` 条件载体，以及 `gate_decision=blocked` 时 `effective_execution_mode` 的正式解释。
- [x] FR-0011 已冻结 `#208` 的 gate-only `page_state` / `key_requests=[]` / `failure_site` 语义，以及 `editor_input` 作为唯一正式验证对象时的验证范围、成功/失败信号、最小 replay 与关闭语义。
- [x] `#231` 是 FR-0011 当前唯一 active issue anchor；`#217` 仅保留历史起草语义，`#365` 只承接本轮 closeout backlog，不替代 open FR 锚点。
- [x] `PR #414` 是本轮 closeout writeback 的可审计 review artifact；`#365` 只负责驱动这次 truth sync，不单独承担 formal review 记录职责。
- [x] 本文件只回写 formal review 结论和解释边界，不把本地 `TODO.md` 扩张成 GitHub issue、Project、里程碑或关闭状态的真相源。

## 时间边界澄清

- [x] `2026-03-23`：`#216` 提供了 Sprint / milestone 的治理基线；FR-0011 closeout 只引用该治理结果，不在本文件中承担排期真相源职责。
- [x] `2026-03-30`：`PR #298` 合入后，FR-0011 冻结了 `#208` 的正式验证边界；“验证前置已冻结、不等于正式验证已完成”的表述只属于这一阶段的 contract freeze 语境。
- [x] 2026-03-30 之后，任何真实验证、回放证据或实现线程状态变化都应在对应 issue / PR 线程承载；本文件只保留对 formal contract 解释有影响的时间边界，不复写可变状态。
- [x] FR-0011 本轮 closeout 建立在上游 `FR-0009` / `FR-0010` formal closeout 已独立完成的前提上，但这些 closeout 的具体 GitHub 状态仍由各自 issue / PR / TODO 承载。

## 进入实现前必须满足

- [x] FR-0011 的 formal review 结论必须先形成，后续 Sprint 3 实现事项才能把它作为 implementation-ready 输入消费。
- [x] `#208` 与 `#209` 的后续事项必须继续把 FR-0011 作为统一前置消费者，而不是回退到未冻结的口头边界。
- [x] 涉及 `#208` 的后续文案若再次引用“验证前置已冻结”，必须同时区分该表述属于 2026-03-30 的 contract freeze 语境，而不是用它代替后续实现链路里的真实验证或关闭结论。
- [x] `#216` 提供的 Sprint 治理基线必须已对齐，FR-0011 的后续实现事项才可按当前 Sprint 2 / Sprint 3 / Sprint 4 语义消费 roadmap 与 milestone。

## 关闭后仍需保持的引用关系

- [x] 后续任何 `#209` 范围的 live 扩展或 follow-up 修复，仍应继续引用 FR-0011 已冻结的 Sprint 3 前置。
- [x] 后续任何 `#208` 邻近事项若再次引用 `editor_input`，都必须沿用 FR-0011 已冻结的唯一正式验证边界；后续实现线程若产生新的验证或关闭结论，也不得直接改写回 FR-0011 套件内部。
- [x] 后续任何 formal 文档回写若需要引用 FR-0011 的 active issue anchor，都应继续使用 `#231`；`#217` 与 `#365` 都不得重新写成当前 open anchor。

## 后续实现入口

- [ ] 实现插件层门禁主落点（background/content-script/main world）。
- [ ] 实现读路径执行模式收敛（默认 `dry_run/recon` + 受控 live）。
- [ ] 实现写路径交互分级判定与默认阻断。
- [ ] 实现最小 risk 状态机（`paused/limited/allowed`）。
- [ ] 实现 `#208/#209` 三态差异化阻断矩阵（统一判定入口）。
- [ ] 实现 session 节律/冷却/恢复最小约束。
- [ ] 实现状态变更审计落盘与缺失审计回退 `paused` 逻辑。
- [ ] 如需正式引入 `xhs.editor_input` 或 `xhs.interact`，先单独起 command contract 规约 PR。
- [ ] 补齐对应契约测试与状态迁移测试。
