# FR-0003 TODO

## Spec Review 阶段

- [x] 明确浏览器启动、Named Profile、基础状态流转、代理绑定、并发保护与最小持久化边界
- [x] 冻结 `runtime.start`、`runtime.login`、`runtime.status`、`runtime.stop` 的最小语义
- [x] 补齐 GWT 验收场景与异常 / 边界场景
- [x] 补齐 `plan.md` 的 7 个必答章节
- [x] 补齐 `contracts/`、`data-model.md`、`risks.md`
- [ ] 完成 spec review，并收敛所有 findings / blockers
- [ ] 确认 `#143` 与 `#141`、`#142`、`#144` 的边界分工

## 进入实现前条件

- [ ] 获得 `APPROVE`
- [ ] 获得 `ready_for_implementation = true`
- [ ] 确认 FR-0003 的实现 PR 与 spec PR 分离
- [ ] 确认 `__webenvoy_meta.json` 最小字段与错误码口径已冻结

在以上条件完成前，不启动 FR-0003 的实现代码。

## Spec Review 通过后进入实现

- [ ] 初始化浏览器启动与 Profile 管理相关实现骨架
- [ ] 建立 Profile 独占锁
- [ ] 建立 Profile 元数据读写
- [ ] 建立 `runtime.start` / `runtime.login` / `runtime.status` / `runtime.stop` 的承载
- [ ] 建立代理粘性绑定与冲突拒绝
- [ ] 建立状态机转移与断连回读
- [ ] 补齐生命周期测试、锁测试、元数据测试与代理绑定测试
- [ ] 补齐最小启动 smoke test
