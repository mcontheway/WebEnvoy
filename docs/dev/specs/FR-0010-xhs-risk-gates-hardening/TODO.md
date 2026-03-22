# FR-0010 TODO

## 评审阻断项

- [x] `spec.md` 补齐目标、非目标、功能需求、GWT、异常场景、验收标准与依赖。
- [x] `plan.md` 补齐七节必答项并明确进入实现前条件。
- [x] `contracts/risk-gate-execution.md` 定义稳定门禁输出对象。
- [x] `research.md` 记录关键未知项、证据矩阵与 gate status。
- [x] `risks.md` 写清 stop-ship、缓解与回滚。
- [x] `data-model.md` 定义门禁实体、约束与生命周期。

## 进入实现前必须完成

- [ ] FR-0010 spec review 通过。
- [ ] 明确 `#208` 恢复 live 正式验证的门禁前置。
- [ ] 明确 `#209` 后续 live 扩展纳入同一门禁的执行约束。
- [ ] 门禁默认模式（`dry_run/recon`）与 live 升级审批流程达成评审共识。

## 实施清单（spec 通过后）

- [ ] 实现读域/写域分离的执行前检查。
- [ ] 实现目标域/目标页显式确认门禁。
- [ ] 实现默认 `dry_run/recon` 与高风险 live 默认阻断。
- [ ] 实现人工确认与审计记录最小闭环。
- [ ] 为门禁判定和审计映射补齐自动化测试。

## 关联事项

- [x] Refs #220
- [x] Refs #213
- [x] Refs #208
- [x] Refs #209
- [x] Refs #216
- [x] Refs #218
