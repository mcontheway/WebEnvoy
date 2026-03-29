# FR-0015 TODO

> GitHub Issue / PR / Project 是进度真相源。
> 本文件只保留 FR-0015 formal blocker、实现前条件和实现停点，不承载 `#281` 的本地 closeout 状态账本。

## Formal 边界

- `#281` 在 FR-0015 范围内只承接 implementation-prep 输入，不承诺完整实现闭环。
- `#279/PR #283` 是唯一上位冻结输入，FR-0015 只能承接，不能重定义。
- `runtime_bootstrap_envelope` 不回流为 staged extension 文件或 profile 永久元数据。
- `stable extension_id + allowed_origins + profile` 是持久 identity 边界，不等于单次 run 的 bootstrap ready。
- `runtime.status` 的 `identityBindingState / transportState / bootstrapState / runtimeReadiness` 共享语义，以 formal contract 为准，并与 FR-0003 `profileState / browserState` 兼容。
- candidate 安装/分发路径、最终安装器、CWS 合规与 `#239` 验证体系不属于本 FR。
- identity mismatch、stale bootstrap ack、多信号冲突、陈旧 ready marker 与幂等恢复边界，以 `risks.md` 为准。

## 恢复入口

- implementation-prep 阶段的 formal 输入、健康矩阵、恢复路径与 stop-ship 规则，分别以 `spec.md`、`plan.md`、`implementation-prep.md`、`contracts/`、`risks.md` 为准。
- `#281` 的实现、验证和关闭状态，以 GitHub issue、PR、review 与 checks 为准；本文件不回写完成进度。
