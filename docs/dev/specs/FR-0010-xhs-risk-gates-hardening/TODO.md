# FR-0010 TODO

## Formal Review Repair Snapshot（#363）

- [x] `spec.md` 补齐目标、非目标、功能需求、GWT、异常场景、验收标准与依赖。
- [x] `plan.md` 补齐七节必答项并明确进入实现前条件。
- [x] `contracts/risk-gate-execution.md` 定义稳定门禁输出对象。
- [x] `research.md` 记录关键未知项、证据矩阵与 gate status。
- [x] `risks.md` 写清 stop-ship、缓解与回滚。
- [x] `data-model.md` 定义门禁实体、约束与生命周期。
- [x] `#218/#219/#221` 的职责映射已在 FR-0010 套件内显式冻结。
- [x] `consumer_gate_result` 的稳定字段集合已在 formal 套件内固定为 `target_domain`、`target_tab_id`、`target_page`、`action_type`、`requested_execution_mode`、`effective_execution_mode`、`gate_decision`、`gate_reasons`。
- [x] `risk_state` 的正式归属已在 formal 套件内固定到 `gate_input.risk_state` 与 `audit_record.risk_state`。

## 当前 review 待完成项

- [ ] FR-0010 spec review 通过。
- [x] `#218` 的门禁边界已在 FR-0010 套件内冻结：读写域分离 + 目标域/目标页显式确认。
- [x] `#219` 的门禁边界已在 FR-0010 套件内冻结：默认 `dry_run/recon` + live 显式放行。
- [x] `#221` 的门禁边界已在 FR-0010 套件内冻结：人工确认与审计记录最小闭环。
- [x] `#208` 恢复 live 正式验证的门禁前置已回写到 FR-0010 formal 套件。
- [x] `#209` 后续 live 扩展纳入同一门禁的执行约束已在 FR-0010 formal 套件内固定。
- [x] `FR-0011` formal 收口前，`live_read_limited` 对读动作同样默认阻断，且 staged rollout 条件载体 `limited_read_rollout_ready_true` 已回写到实现/测试准入口径。
- [x] 门禁默认模式（`dry_run/recon`）与 live 升级审批流程已在 formal 套件内达成统一评审口径。
- [x] 统一消费对象字段已在 formal 套件内冻结：`target_domain`、`target_tab_id`、`target_page`、`action_type`、`requested_execution_mode`、`effective_execution_mode`、`gate_decision`、`gate_reasons`。
- [x] 在 `#208` issue 线程同步“FR-0010 已冻结其后续 live 恢复需要消费的统一门禁对象与 review 边界”。permalink=`https://github.com/mcontheway/WebEnvoy/issues/208#issuecomment-4199076361`
- [x] 在 `#209` issue 线程同步“FR-0010 已冻结其后续 live 扩展需要引用的统一门禁对象与 review 边界”。permalink=`https://github.com/mcontheway/WebEnvoy/issues/209#issuecomment-4199076389`

## 实施清单（spec 通过后）

- [ ] 实现读域/写域分离的执行前检查。
- [ ] 实现目标域/目标页显式确认门禁。
- [ ] 实现默认 `dry_run/recon` 与高风险 live 默认阻断。
- [ ] 实现人工确认与审计记录最小闭环。
- [ ] 为门禁判定和审计映射补齐自动化测试。
- [ ] 验证 `#208/#209` 至少消费统一门禁对象的冻结字段，且新增扩展只通过正式 FR/contract 引入，不出现私有绕行字段。

## 关联事项

- [x] Refs #220
- [x] Refs #213
- [x] Refs #208
- [x] Refs #209
- [x] Refs #216
- [x] Refs #218
- [x] Refs #219
- [x] Refs #221
- [x] Refs #363
