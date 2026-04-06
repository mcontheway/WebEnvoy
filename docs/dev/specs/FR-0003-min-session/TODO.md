# FR-0003 TODO

## Formal Closeout Snapshot

- [x] 明确浏览器启动、Named Profile、基础状态流转、代理绑定、并发保护与最小持久化边界
- [x] 冻结 `runtime.start`、`runtime.login`、`runtime.status`、`runtime.stop` 的最小语义
- [x] 补齐 GWT 验收场景与异常 / 边界场景
- [x] 补齐 `plan.md` 的 7 个必答章节
- [x] 补齐 `contracts/`、`data-model.md`、`risks.md`
- [x] 明确 `localStorageSnapshots` 在 FR-0003 中仅作为最小会话摘要 / 恢复输入，不要求自动回写浏览器会话
- [x] 完成 formal spec review 收口，并清空当前套件 blocker
- [x] 确认 FR-0003 与 `#354`、`#355`、`#359`、`#361` 的边界分工
- [x] 冻结 `__webenvoy_meta.json` 最小字段白名单与错误码口径
- [x] formal 结论：`APPROVE`
- [x] formal 结论：`ready_for_implementation = true`
- [x] 确认 FR-0003 的实现链路必须保持 spec / impl 分离

## Implementation Backlog

- [ ] 初始化浏览器启动与 Profile 管理相关实现骨架
- [ ] 建立 Profile 独占锁
- [ ] 建立 Profile 元数据读写
- [ ] 建立 `runtime.start` / `runtime.login` / `runtime.status` / `runtime.stop` 的承载
- [ ] 建立代理粘性绑定与冲突拒绝
- [ ] 建立状态机转移与断连回读
- [ ] 建立 `localStorageSnapshots` 最小写入与摘要回读（不实现自动回写浏览器会话）
- [ ] 补齐生命周期测试、锁测试、元数据测试与代理绑定测试
- [ ] 补齐最小启动 smoke test
