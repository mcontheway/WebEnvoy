# FR-0015 TODO

## 评审阻断项

- [ ] 明确写清 `#281` 当前只收口 implementation-prep，不承诺完整实现闭环
- [ ] 明确 `#279/PR #283` 是唯一上位冻结输入，`FR-0015` 只能承接不能重定义
- [ ] 明确 `runtime_bootstrap_envelope` 不回流为 staged extension 文件或 profile 永久元数据
- [ ] 明确 `stable extension_id + allowed_origins + profile` 是持久 identity 边界，不等于单次 run 的 bootstrap ready
- [ ] 明确 candidate 安装/分发路径、最终安装器、CWS 合规与 `#239` 验证体系均不属于本 FR
- [ ] 明确 `risks.md` 已覆盖 identity mismatch、stale bootstrap ack、多信号冲突、陈旧 ready marker 与幂等恢复边界

## 进入实现前必须完成的动作

- [ ] FR-0015 spec review 通过并形成明确结论
- [ ] 后续实现 PR 明确使用 `Refs #281`、`Refs #233`，不提前关闭 `#281`
- [ ] 后续实现 PR 预先声明第一刀只覆盖 identity preflight、bootstrap contract、runtime readiness 状态收口
- [ ] 后续实现 PR 的测试计划覆盖 identity preflight、bootstrap ack、断连恢复、stale ack 与 status 回读
- [ ] 若后续实现需要新增持久化字段或 schema，先补充 formal data model / spec review，而不是直接写入运行时代码

## 后续实施清单

- [ ] 为 persistent extension 主路径建立 identity preflight 入口
- [ ] 建立 `runtime_bootstrap_envelope` 的正式下发、确认与错误分类链路
- [ ] 为 `runtime.status` 增加 identity / bootstrap readiness 读模型
- [ ] 明确 bootstrap 失败后的 stop / retry / recover 边界
- [ ] 为 bootstrap 幂等、stale ready marker、多信号冲突补充失败注入测试
- [ ] 将安装器产品化、candidate 分发路径产品化与 `#239` 验证体系保留到各自后续事项
