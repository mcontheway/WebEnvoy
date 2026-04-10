# FR-0015 TODO

> GitHub Issue / PR / Project 是进度真相源。
> 本文件只保留 FR-0015 formal blocker、进入实现前条件和实现停点，不承载本地 closeout 状态账本。

## Review 阶段待办

- 若继续修订 FR-0015 formal 文档，先确认本 FR 只承接 implementation-prep 的冻结输入，不把 formal TODO 扩写为完整实现闭环。
- 若需要调整 scope 或 closeout 描述，先核对 `spec.md`、`plan.md`、`implementation-prep.md` 的角色边界，避免把流程性结论或收口语义写回 `TODO.md`。
- 若需要回写 formal 边界，先对齐 `contracts/` 与 `risks.md` 的冻结内容，避免在 `TODO.md` 重定义 shared contract、风险口径或恢复规则。

## GitHub backlog 承接

- 当前 formal 对应关系以 canonical FR issue `#435` 为准；新的实现或收口事项必须挂到 FR-0015 主树下，不再以 `#281` 或 `#361` 充当当前结构父级。
- `#281` 与 `#361` 只保留为历史实现链路参考；scope、stop-ship、验证入口与恢复边界仍只以 `spec.md`、`plan.md`、`implementation-prep.md`、`contracts/`、`risks.md` 为准，本文件不再重复维护一份缩写版 contract，也不把 issue 正文升格为 formal 来源。
- 后续任何仍承接 FR-0015 implementation-prep / backlog handoff 的 issue / PR，都应在不外扩 scope 的前提下至少显式挂接 `#435`。纯验证后续事项继续归属 `FR-0020`（`#239`），不在 FR-0015 主树下重复挂接。

## 进入实现前条件

- 第一刀切片必须限定在 FR-0015 已冻结的 implementation-prep 约束内：仅包含 identity preflight、`runtime_bootstrap_envelope` contract、`runtime.status` read model，以及 bootstrap 失败后的 stop/retry/recover 边界；不得外扩到安装器产品化、candidate 分发或 `FR-0020` 验证体系。
- 如后续实现继续改 `runtime.status` 或 `runtime_bootstrap_envelope`，先核对 `contracts/` 中已冻结的状态语义与错误分类，避免通过 `TODO.md` 临时改口径。
- 如进入实现阶段需要推进恢复链路、健康矩阵或 stop-ship 规则，先确认对应验证入口、失败回退与证据产物已在 formal 文档中冻结，而不是通过 `TODO.md` 临时补约束。
- 开始第一刀前，先明确 stop-ship 触发条件：identity mismatch、stale bootstrap ack、多信号冲突、陈旧 ready marker、bootstrap 非幂等恢复失败；触发后必须阻断 `runtime.start` 成功路径并产出可复核状态。
- 开始第一刀前，先冻结验证入口：`tests/cli.contract.test.ts` 并发/恢复契约、runtime status contract 回读、bootstrap ack/失败注入、断连恢复与幂等 stop/start 证据。

## 实现停点

- implementation-prep 阶段的 formal 输入、健康矩阵、恢复路径与 stop-ship 规则，恢复入口分别以 `spec.md`、`plan.md`、`implementation-prep.md`、`contracts/`、`risks.md` 为准。
- candidate 安装/分发路径、最终安装器、CWS 合规与 `FR-0020` 验证体系仍属于后续事项，不在 FR-0015 当前收口范围内完成。
- identity mismatch、stale bootstrap ack、多信号冲突、陈旧 ready marker 与幂等恢复边界的 formal 定义继续以 `risks.md` 为准；本文件只保留 formal 恢复入口，不维护 backlog 或完成态账本。
- 进入实现后若第一刀任一 stop-ship 条件被触发且无法在当前 PR 消解，停在 formal 停点，不以补文案替代恢复/验证证据，不推进 closing 语义。
