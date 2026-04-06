# FR-0007 TODO

> 本文件记录 FR-0007 当前 formal review 准备状态。外部 issue / PR / review / guardian 事实仅在可核实时回写，不在此伪造。

## Formal Review Preparation Snapshot

- [x] `spec.md` 的 GWT 验收场景与异常 / 边界场景已补齐并冻结
- [x] 冻结能力壳最小输入结构（`ability` / `input` / `options`）
- [x] 冻结能力壳最小输出结构（`summary.capability_result`）
- [x] 冻结能力错误细节结构（`error.details`）
- [x] `plan.md`、`contracts/ability-shell.md`、`data-model.md`、`risks.md` 已完成 formal 文档收口
- [x] 当前 formal 承接 issue 已冻结为 `#360`
- [x] 历史 issue `#159` 仅保留来源引用，不再作为当前 formal closeout 承接 issue
- [ ] 相邻诊断套件边界仅保留为实现承接时的复核事项，不作为当前 formal review 输入中的已冻结依赖
- [x] FR-0007 不把 FR-0006 作为持久化真相源；能力结果 / 错误落库映射只在实现承接时继续复核
- [x] 确认 FR-0007 的实现链路必须保持 spec / impl 分离
- [x] issue `#360` 当前只校验 FR-0007 本套件的 formal review 输入是否自洽，不新增 FR-0004 / FR-0006 completion gate

## Formal Review 当前状态

- [ ] external formal spec review 已完成并收敛 findings / blockers
- [ ] formal 结论：`APPROVE`
- [ ] formal 结论：`ready_for_implementation = true`

当前状态说明：

- FR-0007 的本地正式套件主体已收口，可进入 formal review；相邻 FR 边界在实现承接时继续复核，不作为当前 closeout 的完成门禁。
- 在 external formal review 明确给出结论前，FR-0007 仍保持 review open，不宣称 `APPROVE` 已成立，也不宣称 `ready_for_implementation = true` 已成立。

## 进入实现前条件（门禁定义）

- 获得 `APPROVE`
- 获得 `ready_for_implementation = true`
- 确认 FR-0007 的实现链路保持 spec / impl 分离
- 确认 FR-0007 的实现不会重定义 FR-0001 / FR-0004 / FR-0006 的职责边界

## Formal 收口说明

- `#354` 已完成 FR-0001 的 formal 收口回写，因此 FR-0007 依赖的 CLI 外层契约基座已不再构成本地文档阻塞。
- `#355` 已完成 FR-0002 的 formal 收口回写，因此 FR-0007 依赖的最小通信闭环 formal 基座已不再构成本地文档阻塞。
- 本次 `#360` 仅回写 FR-0007 formal 文档收口状态，不重开能力壳输入 / 输出 / 错误边界，也不把 closeout 结论伪装成新的外部审批事实。
- 当前可确认的是“本套件 formal review 输入已收口、上游 formal 基座不再构成本地文档阻塞”；外部 formal review 通过与 `ready_for_implementation` 结论仍需在后续 review 链路中明确给出。

## Implementation Backlog

- [ ] 建立能力输入壳解析与校验模块
- [ ] 建立能力输出壳映射模块
- [ ] 建立能力错误细节映射模块
- [ ] 为首个 L3 样本接入能力壳输出
- [ ] 补齐能力壳契约测试与回归用例
- [ ] 对齐 FR-0004 的最小诊断与 `run_id` 关联
