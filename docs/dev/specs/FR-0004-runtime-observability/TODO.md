# FR-0004 TODO

## Spec Review 阶段

- [ ] 确认 `spec.md` 只覆盖 Phase 1 所需的最小观察与诊断面
- [ ] 确认 `spec.md` 没有把完整 pause / resume 系统混进来
- [ ] 确认 `contracts/runtime-observability.md` 与 FR-0001 外层壳兼容
- [ ] 确认 `risks.md` 覆盖敏感信息泄露、误分类和载荷膨胀
- [ ] 创建仅包含规约文档的 Draft PR
- [ ] 收敛 spec review findings 与 blockers

## 进入实现前条件

- [ ] 获得 `APPROVE`
- [ ] 获得 `ready_for_implementation = true`
- [ ] 确认 FR-0001 与 FR-0004 的职责边界没有交叉冲突
- [ ] 确认 `#142` 的通信链路能够承载诊断字段

## Spec 通过后实施清单

- [ ] 冻结页面状态、关键请求和失败位置的最小字段
- [ ] 冻结诊断分类与证据格式
- [ ] 接入成功 / 错误响应的结构化输出
- [ ] 接入脱敏与截断规则
- [ ] 补齐诊断分类、契约和边界测试
