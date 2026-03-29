# FR-0015 TODO

> 2026-03-29 closeout 回写：
> `#281` implementation-prep 对应的 formal 输入已由 PR `#284` 冻结，后续 runtime migration 第一刀与恢复语义已由 PR `#287`、`#289`、`#290`、`#291` 合入主干。
> 本文件保留为 formal 套件内的 closeout 证据，不再表示“待开始实现”。

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
- [x] 若后续实现需要把 persistent identity 事实写入持久层，先补充实现级字段与回滚 spec review，而不是直接写入运行时代码

## 后续实施清单

- [x] 为 persistent extension 主路径建立 identity preflight 入口
- [x] 建立 `runtime_bootstrap_envelope` 的正式下发、确认与错误分类链路
- [x] 为 `runtime.status` 增加 identity / bootstrap readiness 读模型
- [x] 明确 bootstrap 失败后的 stop / retry / recover 边界
- [x] 为 bootstrap 幂等、stale ready marker、多信号冲突补充失败注入测试
- [x] 将安装器产品化、candidate 分发路径产品化与 `#239` 验证体系保留到各自后续事项

## 主线落地记录

- [x] `#279` / PR `#283` 冻结 official Chrome persistent extension 架构边界
- [x] PR `#284` 补齐 FR-0015 implementation-prep 套件
- [x] PR `#287` 落地 identity preflight、bootstrap contract、runtime readiness 第一刀
- [x] PR `#289` 收口 orphan runtime explicit `runtime.stop` 恢复路径
- [x] PR `#290` 把 bootstrap retry/recover 收口为共享 CLI-first runtime 契约
- [x] PR `#291` 收紧 loopback bootstrap attestation，使测试与共享契约一致

## 收口剩余动作

- [ ] 使用独立 closing PR 回写 formal TODO / issue 口径，并显式 `Fixes #281`
- [ ] closing PR 完成 guardian、GitHub checks、review 与 squash merge
