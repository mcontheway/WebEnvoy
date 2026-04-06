# FR-0007 TODO

> 本文件记录 FR-0007 formal closeout 结论，不追溯外部 Draft PR 载体事实。

## Formal Closeout Snapshot

- [x] `spec.md` 的 GWT 验收场景与异常 / 边界场景已补齐并冻结
- [x] 冻结能力壳最小输入结构（`ability` / `input` / `options`）
- [x] 冻结能力壳最小输出结构（`summary.capability_result`）
- [x] 冻结能力错误细节结构（`error.details`）
- [x] `plan.md`、`contracts/ability-shell.md`、`data-model.md`、`risks.md` 已完成 formal 收口
- [x] 当前 formal 承接 issue 已冻结为 `#360`
- [x] 与 `#357` 的最小诊断 / `run_id` 关联边界已冻结
- [x] 与 `#359` 的能力证据映射边界已冻结
- [x] 完成 formal spec review 并收敛 findings / blockers
- [x] formal 结论：`APPROVE`
- [x] formal 结论：`ready_for_implementation = true`
- [x] 确认 FR-0007 的实现链路必须保持 spec / impl 分离

## Implementation Backlog

- [ ] 建立能力输入壳解析与校验模块
- [ ] 建立能力输出壳映射模块
- [ ] 建立能力错误细节映射模块
- [ ] 为首个 L3 样本接入能力壳输出
- [ ] 补齐能力壳契约测试与回归用例
- [ ] 对齐 `#357` 的最小诊断与 `run_id` 关联
