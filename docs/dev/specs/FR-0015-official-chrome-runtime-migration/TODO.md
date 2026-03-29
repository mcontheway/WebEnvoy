# FR-0015 TODO

> GitHub Issue / PR / Project 是进度真相源。
> 本文件只保留 FR-0015 formal blocker、实现前条件和实现停点，不承载 `#281` 的本地 closeout 状态账本。

## Review 阶段待办

- [ ] 若继续修订 FR-0015 formal 文档，先核对 `#281` 在本 FR 中只承接 implementation-prep 输入，不把文档 PR 扩写为完整实现闭环。
- [ ] 若继续修改 closeout 语义，先确认 PR 关闭口径与 GitHub issue 状态一致；纯文档/规约收口使用 `Refs #281`，不把自动关单写回 `TODO.md`。
- [ ] 若需要回写 formal 边界，先对齐 `#279/PR #283` 冻结输入、`contracts/` 与 `risks.md`，避免在 `TODO.md` 重定义 shared contract。

## 进入实现前条件

- [ ] 如后续实现需要新增 persistent identity 字段、bootstrap 持久事实或新的 profile 元数据，先补实现级 spec review、字段约束与回滚说明。
- [ ] 如后续实现继续改 `runtime.status` 或 `runtime_bootstrap_envelope`，先核对 `contracts/` 中已冻结的状态语义与错误分类，避免通过 TODO 临时改口径。
- [ ] 如需继续推进 `#281` 的真正 closing PR，先确保 guardian verdict、GitHub checks、review 与 merge 元数据都在 GitHub 上可复核，而不是在本文件中声明完成。

## 实现停点

- [ ] implementation-prep 阶段的 formal 输入、健康矩阵、恢复路径与 stop-ship 规则，恢复入口分别以 `spec.md`、`plan.md`、`implementation-prep.md`、`contracts/`、`risks.md` 为准。
- [ ] candidate 安装/分发路径、最终安装器、CWS 合规与 `#239` 验证体系仍属于后续事项，不在 FR-0015 当前收口范围内完成。
- [ ] identity mismatch、stale bootstrap ack、多信号冲突、陈旧 ready marker 与幂等恢复边界的 formal 定义继续以 `risks.md` 为准；本文件不维护完成态账本。
