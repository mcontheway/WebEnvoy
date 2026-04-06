# FR-0007 TODO

> 本文件记录 FR-0007 的 formal verdict 回写状态。外部 issue / PR / review / guardian 事实仅在可核实时回写，不在此伪造。

## Formal Review Preparation Snapshot

- [x] `spec.md` 的 GWT 验收场景与异常 / 边界场景已补齐并冻结
- [x] 冻结能力壳最小输入结构（`ability` / `input` / `options`）
- [x] 冻结能力壳最小输出结构（`summary.capability_result`）
- [x] 冻结能力错误细节结构（`error.details`）
- [x] `plan.md`、`contracts/ability-shell.md`、`data-model.md`、`risks.md` 已完成 formal 文档收口
- [x] 当前 formal 承接 issue 已冻结为 `#360`
- [x] 历史 issue `#159` 仅保留来源引用，不再作为当前 formal closeout 承接 issue
- [x] FR-0007 不把 FR-0006 作为持久化真相源；能力结果 / 错误落库映射只在实现承接时继续复核
- [x] 确认 FR-0007 的实现链路必须保持 spec / impl 分离
- [x] issue `#360` 当前只校验 FR-0007 本套件的 formal review 输入是否自洽，不新增 FR-0004 / FR-0006 completion gate

## Formal Review 当前状态

- [x] external formal spec review 已完成并收敛 findings / blockers
- [x] formal 结论：`APPROVE`
- [x] formal 结论：`ready_for_implementation = true`
- [x] PR `#374` 的 latest guardian review 在 commit `15440dc07dbab3a6f1e3d1426255f53988f2ee79` 上于 `2026-04-06T08:11:40Z` 明确给出 `APPROVE`

当前状态说明：

- FR-0007 的 final formal verdict 已回写为完成；相邻 FR 边界的实现承接复核不再构成本次 closeout 的门禁。
- PR `#374` 已合入主干，merge commit 为 `cb6262d1e39eef3048030074267ca62a221fc24c`，mergedAt 为 `2026-04-06T08:11:48Z`，可作为本次最终 formal verdict 的可核实依据。
- 该 verdict 的可核实链路为：`#374` latest guardian review 在 `15440dc07dbab3a6f1e3d1426255f53988f2ee79` 上于 `2026-04-06T08:11:40Z` 明确给出 `APPROVE`，随后该 PR 于 `2026-04-06T08:11:48Z` 合入主干。

## 进入实现前条件（门禁定义）

- 已获得 `APPROVE`
- 已获得 `ready_for_implementation = true`
- 确认 FR-0007 的实现链路保持 spec / impl 分离
- 确认 FR-0007 的实现不会重定义 FR-0001 / FR-0004 / FR-0006 的职责边界

## Formal 收口说明

- `#354` 已完成 FR-0001 的 formal 收口回写，因此 FR-0007 依赖的 CLI 外层契约基座已不再构成本地文档阻塞。
- `#355` 已完成 FR-0002 的 formal 收口回写，因此 FR-0007 依赖的最小通信闭环 formal 基座已不再构成本地文档阻塞。
- `#374` 已完成 FR-0007 的 formal verdict 回写，因此本次 `#360` 已完成 closeout，不再把结论伪装成新的外部审批事实。
- 当前可确认的是“本套件 formal verdict 已回写、上游 formal 基座不再构成本地文档阻塞”；`APPROVE` 与 `ready_for_implementation` 结论已在本文件中落为完成态。

## Implementation Backlog

- [ ] 建立能力输入壳解析与校验模块
- [ ] 建立能力输出壳映射模块
- [ ] 建立能力错误细节映射模块
- [ ] 为首个 L3 样本接入能力壳输出
- [ ] 补齐能力壳契约测试与回归用例
- [ ] 在实现承接阶段复核相邻诊断套件边界
- [ ] 对齐 FR-0004 的最小诊断与 `run_id` 关联
