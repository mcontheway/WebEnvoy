# FR-0010 TODO

## 评审阻断项

- [x] `spec.md` 补齐目标、非目标、GWT、异常边界、验收标准与依赖前置
- [x] `plan.md` 补齐七节最小结构（实施目标、阶段拆分、实现约束、验证策略、TDD、并行串行、进入实现前条件）
- [x] 新增 `contracts/` 并冻结门禁稳定对象
- [x] 新增 `research.md` 并收敛证据矩阵与差距项
- [x] 新增 `risks.md` 并定义 stop-ship / 回滚
- [x] 新增 `data-model.md` 并定义共享实体字段

## 进入实现前必须完成

- [ ] FR-0010 spec review 通过并形成明确结论
- [ ] `#208` 与 `#209` issue 明确引用 FR-0010 作为进入 live 的前置
- [ ] Sprint 治理重排（`#216`）中对应 sprint 编排与里程碑调整完成

## spec 通过后的实施清单（非本 PR）

- [ ] 实现插件层门禁主落点（background/content-script/main world）
- [ ] 实现读路径执行模式收敛（默认 dry_run/recon + 受控 live）
- [ ] 实现写路径交互分级判定与默认阻断
- [ ] 实现最小 risk 状态机（paused/limited/allowed）
- [ ] 实现 session 节律/冷却/恢复最小约束
- [ ] 补齐对应契约测试与状态迁移测试

## 关联

- Issue: `#217`
- Governance: `#216`
- Upstream: `#213` / `FR-0009`
- Downstream: `#208` / `#209`
