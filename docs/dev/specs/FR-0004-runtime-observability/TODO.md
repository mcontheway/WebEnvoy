# FR-0004 TODO

> 本文件记录 FR-0004 formal closeout 结论，不追溯外部 Draft PR 载体事实。

## Formal Closeout Snapshot

- [x] 确认 `spec.md` 只覆盖 Phase 1 所需的最小观察与诊断面
- [x] 确认 `spec.md` 没有把完整 pause / resume 系统混进来
- [x] 确认 `contracts/runtime-observability.md` 与 FR-0001 外层壳兼容
- [x] 确认 `risks.md` 覆盖敏感信息泄露、误分类和载荷膨胀
- [x] 冻结页面状态、关键请求和失败位置的最小字段
- [x] 冻结诊断分类与证据格式
- [x] 确认 FR-0001 与 FR-0004 的职责边界没有交叉冲突
- [x] 确认 `#355` 的通信链路能够承载诊断字段
- [x] 确认与 `#359` 的诊断落库边界、与 `#360` 的 `run_id` / 能力错误关联边界已冻结
- [x] 收敛 formal spec review findings 与 blockers
- [x] formal 结论：`APPROVE`
- [x] formal 结论：`ready_for_implementation = true`

## Implementation Backlog

- [ ] 接入成功 / 错误响应的结构化输出
- [ ] 接入脱敏与截断规则
- [ ] 补齐诊断分类、契约和边界测试
