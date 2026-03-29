# FR-0015 TODO

## 评审阻断项

- [x] 明确写清 `#281` 当前只收口 implementation-prep，不承诺完整实现闭环
- [x] 明确 `#279/PR #283` 是唯一上位冻结输入，`FR-0015` 只能承接不能重定义
- [x] 明确 `runtime_bootstrap_envelope` 不回流为 staged extension 文件或 profile 永久元数据
- [x] 明确 `stable extension_id + allowed_origins + profile` 是持久 identity 边界，不等于单次 run 的 bootstrap ready
- [x] 明确 `runtime.status` 已通过 formal contract 冻结 `identityBindingState / transportState / bootstrapState / runtimeReadiness`，并写清与 FR-0003 `profileState / browserState` 的兼容关系
- [x] 明确 candidate 安装/分发路径、最终安装器、CWS 合规与 `#239` 验证体系均不属于本 FR
- [x] 明确 `risks.md` 已覆盖 identity mismatch、stale bootstrap ack、多信号冲突、陈旧 ready marker 与幂等恢复边界

## 进入实现前必须完成的动作

- [x] FR-0015 spec review 通过并形成明确结论
- [x] 后续实现 PR 明确使用 `Refs #281`、`Refs #233`，不提前关闭 `#281`
- [x] 后续实现 PR 预先声明第一刀只覆盖 identity preflight、bootstrap contract、runtime readiness 状态收口
- [x] 后续实现 PR 的测试计划覆盖 identity preflight、bootstrap ack、断连恢复、stale ack 与 status 回读
- [x] 后续实现未把新的 persistent identity 事实写入持久层；未触发额外字段级 spec review 前置

## 后续实施清单

- [x] 为 persistent extension 主路径建立 identity preflight 入口
- [x] 建立 `runtime_bootstrap_envelope` 的正式下发、确认与错误分类链路
- [x] 为 `runtime.status` 增加 identity / bootstrap readiness 读模型
- [x] 明确 bootstrap 失败后的 stop / retry / recover 边界
- [x] 为 bootstrap 幂等、stale ready marker、多信号冲突补充失败注入测试
- [x] 将安装器产品化、candidate 分发路径产品化与 `#239` 验证体系保留到各自后续事项

## 收口状态

- [x] PR `#284` 已补齐 implementation-prep 套件
- [x] PR `#287` 已把 identity preflight、bootstrap contract 与 readiness/status 主线合入 `main`
- [x] PR `#289` 已补齐 orphan runtime explicit stop recovery
- [x] PR `#290` 已把 bootstrap retry/recover 收口为共享 runtime 契约
- [x] PR `#291` 已收紧 loopback bootstrap attestation，保证共享契约与测试夹具一致
- [x] `#281` 当前剩余动作仅为 closeout 元数据对齐与最终 closing PR 合并门禁
