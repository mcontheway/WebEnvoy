# FR-0014 TODO

## 评审阻断项

- [ ] 明确写清 `#226/FR-0011` 是最小可执行前置，`#237/FR-0014` 只能追加不能重定义
- [ ] 明确 `runtime.audit` 是读模型，不是新的真相源或写入口
- [ ] 明确 `approval_record` / `audit_record` 继续是唯一正式审批/审计载体
- [ ] 明确 `warmup` / `afterglow_hook` 仅是阶段挂点，不是完整 persona/内容编排承诺
- [ ] 明确 `risks.md` 已覆盖并发、状态漂移、误放行、错误恢复、审计失真、回滚

## 进入实现前必须完成的动作

- [ ] FR-0014 spec review 通过并形成明确结论
- [ ] 后续实现 PR 明确引用 `Refs #237`，且不混入 `#208` 实现或 Layer 1/2/4 范围
- [ ] 实现 PR 的测试计划覆盖窗口推进、恢复探测、稳定窗口、审计聚合一致性
- [ ] 若需要扩展持久化 schema，先对照 `data-model.md` 冻结命名、生命周期与回滚方式

## 后续实施清单

- [ ] 建立 `session_rhythm_window_state` 的正式持久化落点
- [ ] 建立 `session_rhythm_event` 与 `session_rhythm_decision` 的写入与查询链路
- [ ] 让 `runtime.audit` 输出 `session_rhythm_status_view`
- [ ] 把 `approval_record` / `audit_record` 与窗口推进逻辑接线
- [ ] 增加并发 profile 争抢、stale window、重复恢复探测、审计晚到的失败注入测试
- [ ] 为 `warmup` / `afterglow_hook` 提供 Phase 2 最小挂点实现，不把它们伪装成完整 persona 系统
