# FR-0002 TODO

## Spec Review 阶段

- [x] 明确 FR-0002 只覆盖 Native Messaging 最小通信闭环
- [x] 明确承接 FR-0001 的 CLI 外层契约，不重写命令壳
- [x] 补齐 `spec.md` 的 GWT 验收场景
- [x] 补齐 `spec.md` 的异常 / 边界场景
- [x] 补齐 `plan.md` 的 7 节结构
- [x] 补齐 `contracts/native-messaging-bridge.md`
- [x] 补齐 `risks.md`
- [ ] 完成 spec review，并清空所有 findings / blockers

## 进入实现前条件

- [ ] 获得 `APPROVE`
- [ ] 获得 `ready_for_implementation = true`
- [ ] 确认 FR-0002 的实现 PR 与 spec PR 分离
- [ ] 确认 `#141` / FR-0001 已经可以作为承接基座

在以上条件完成前，不启动 FR-0002 的实现代码。

## Spec 通过后进入实现

- [ ] 建立 Native Messaging 最小握手路径
- [ ] 建立 Background 到 Content Script 的最小转发路径
- [ ] 建立 `runtime.ping` 页面侧往返 smoke path
- [ ] 建立心跳发送与应答
- [ ] 建立断连判定与恢复流程
- [ ] 建立握手失败、转发失败、超时、断连的错误分类
- [ ] 补齐协议 envelope 的单测
- [ ] 补齐状态机与超时判定的单测
- [ ] 补齐 CLI -> 页面侧 round-trip 集成测试
- [ ] 补齐断连与超时的契约测试
