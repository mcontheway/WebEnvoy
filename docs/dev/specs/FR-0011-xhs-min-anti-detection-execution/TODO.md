# FR-0011 TODO

## 评审阻断项

- [x] `spec.md` 补齐目标、非目标、GWT、异常边界、验收标准与依赖前置
- [x] `plan.md` 补齐七节最小结构（实施目标、阶段拆分、实现约束、验证策略、TDD、并行串行、进入实现前条件）
- [x] 新增 `contracts/` 并冻结门禁稳定对象
- [x] 新增 `research.md` 并收敛证据矩阵与差距项
- [x] 新增 `risks.md` 并定义 stop-ship / 回滚
- [x] 新增 `data-model.md` 并定义共享实体字段
- [x] 明确 `#208/#209` 三态差异化阻断矩阵
- [x] 明确状态变更审计字段与“审计缺失即回退 `paused`”规则
- [x] 明确 `live_read_limited` 的正式公开模式语义、审批前置与审计要求
- [x] 明确 `gate_decision=blocked` 时 `effective_execution_mode` 只表示真实未继续 live 的降级模式，不对外暴露未实际执行的 `live_*`
- [x] 明确 `#208` 的 gate-only `page_state` / `key_requests=[]` / `failure_site` 最小语义
- [x] 明确 `editor_input` 只是 `#208` 验证候选动作，不等于已冻结的正式命令接口

## 进入实现前必须完成

- [ ] FR-0011 spec review 通过并形成明确结论
- [ ] `#208` 与 `#209` issue 明确引用 FR-0011 作为进入 live 的前置
- [ ] `#208` issue / PR 关闭语义回写为“验证前置已冻结，不等于正式验证已完成”，并与 `docs/dev/issue-208-min-page-interaction-validation-note.md` 保持一致
- [ ] Sprint 治理重排（`#216`）中对应 sprint 编排与里程碑调整完成

## spec 通过后的实施清单（非本 PR）

- [ ] 实现插件层门禁主落点（background/content-script/main world）
- [ ] 实现读路径执行模式收敛（默认 dry_run/recon + 受控 live）
- [ ] 实现写路径交互分级判定与默认阻断
- [ ] 实现最小 risk 状态机（paused/limited/allowed）
- [ ] 实现 `#208/#209` 三态差异化阻断矩阵（统一判定入口）
- [ ] 实现 session 节律/冷却/恢复最小约束
- [ ] 实现状态变更审计落盘与缺失审计回退 `paused` 逻辑
- [ ] 为 `#208` gate-only success / blocked 场景补齐 `page_state` 契约测试
- [ ] 以 `docs/dev/issue-208-min-page-interaction-validation-note.md` 为准，为 `#208` 的 `editor_input` 单动作真实验证补齐最小 replay 与证据回传
- [ ] 如需正式引入 `xhs.editor_input` 或 `xhs.interact`，先单独起 command contract 规约 PR
- [ ] 补齐对应契约测试与状态迁移测试

## 关联

- Issue: `#217`
- Spec review closure: 待本 PR review 收口
- Governance: `#216`
- Upstream: `#213` / `FR-0009`
- Downstream: `#208` / `#209`
