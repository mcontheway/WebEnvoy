# FR-0010 TODO
> 现状说明：本地已落地门禁执行逻辑与审计/合同测试，以下未勾选项主要是 formal review / GitHub 状态同步，不代表能力未落地。

## 评审阻断项

- [x] `spec.md` 补齐目标、非目标、功能需求、GWT、异常场景、验收标准与依赖。
- [x] `plan.md` 补齐七节必答项并明确进入实现前条件。
- [x] `contracts/risk-gate-execution.md` 定义稳定门禁输出对象。
- [x] `research.md` 记录关键未知项、证据矩阵与 gate status。
- [x] `risks.md` 写清 stop-ship、缓解与回滚。
- [x] `data-model.md` 定义门禁实体、约束与生命周期。
- [x] `#218/#219/#221` 的职责映射已在 FR-0010 套件内显式冻结。

## 进入实现前必须完成

- [ ] FR-0010 spec review 通过。
- [ ] `#218` 的门禁边界通过评审：读写域分离 + 目标域/目标页显式确认。
- [ ] `#219` 的门禁边界通过评审：默认 `dry_run/recon` + live 显式放行。
- [ ] `#221` 的门禁边界通过评审：人工确认与审计记录最小闭环。
- [ ] 明确 `#208` 恢复 live 正式验证的门禁前置。
- [ ] 明确 `#209` 后续 live 扩展纳入同一门禁的执行约束。
- [ ] 门禁默认模式（`dry_run/recon`）与 live 升级审批流程达成评审共识。
- [ ] 统一消费对象字段冻结并达成评审共识：`target_domain`、`target_tab_id`、`target_page`、`action_type`、`requested_execution_mode`、`effective_execution_mode`、`gate_decision`、`gate_reasons`。

## 实施清单（spec 通过后）

- [x] 实现读域/写域分离的执行前检查。
- [x] 实现目标域/目标页显式确认门禁。
- [x] 实现默认 `dry_run/recon` 与高风险 live 默认阻断。
- [x] 实现人工确认与审计记录最小闭环。
- [x] 为门禁判定和审计映射补齐自动化测试。
- [x] 验证 `#208/#209` 只消费统一门禁对象，不引入私有绕行字段。

## 关联事项

- [x] Refs #220
- [x] Refs #213
- [x] Refs #208
- [x] Refs #209
- [x] Refs #216
- [x] Refs #218
- [x] Refs #219
- [x] Refs #221
