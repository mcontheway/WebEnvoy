# FR-0006 TODO

## Spec Review 阶段

- [ ] 确认 `spec.md` 只覆盖 Phase 1 最小运行记录基座，不扩张到完整业务仓库
- [ ] 确认 SQLite 角色边界明确：证据层，不是实时会话真相源
- [ ] 确认 `data-model.md` 字段与约束可直接支撑实现与测试
- [ ] 确认 `contracts/runtime-store.md` 输入输出、错误码与兼容策略完整
- [ ] 确认 `risks.md` 覆盖并发写入、敏感字段泄露与迁移失败风险
- [ ] 绑定 Governing issue `#144` 并准备 spec-only Draft PR
- [ ] 收敛 spec review findings 与 blockers

## 进入实现前条件

- [ ] 获得 `APPROVE`
- [ ] 获得 `ready_for_implementation = true`
- [ ] 确认 `#143` 的运行标识字段可稳定复用
- [ ] 确认与 `#154` 的诊断字段映射边界已冻结
- [ ] 确认与 `#159` 的能力壳字段映射边界已冻结

## Spec 通过后实施清单

- [ ] 实现 SQLite 初始化、WAL 启用与 schema 版本校验
- [ ] 实现运行主记录幂等写入
- [ ] 实现运行事件追加写入与主记录关联约束
- [ ] 实现按 `run_id` 的最小查询接口
- [ ] 实现诊断字段落库的脱敏与截断
- [ ] 补齐单元、契约、集成测试并收集验证证据
