# FR-0003 TODO

## Formal Review Gate

- [x] 明确 FR-0003 只覆盖浏览器启动、Named Profile、基础状态流转、代理绑定、并发保护与最小持久化边界
- [x] 明确 FR-0003 承接 FR-0001 的 CLI 外层契约与命令级 `run_id`，但不重写 CLI 错误壳、退出码和 argv 语法
- [x] 明确 FR-0003 不承接 FR-0002 的握手、心跳、转发与 `ERR_TRANSPORT_*` 通信层错误
- [x] 明确 FR-0003 不承接 FR-0006 的 SQLite 历史证据 / 诊断真相源角色
- [x] 明确 FR-0003 只为后续 formal FR 预留受控加项入口，不提前吸收 bootstrap / readiness / persistent extension identity 等后续语义

## Formal Review Snapshot

- [x] 明确浏览器启动、Named Profile、基础状态流转、代理绑定、并发保护与最小持久化边界
- [x] 冻结 `runtime.start`、`runtime.login`、`runtime.status`、`runtime.stop` 的最小语义
- [x] 补齐 GWT 验收场景与异常 / 边界场景
- [x] 补齐 `plan.md` 的 7 个必答章节
- [x] 补齐 `contracts/`、`data-model.md`、`risks.md`
- [x] 明确 FR-0003 与 FR-0001 / FR-0002 / FR-0006 / FR-0015 的边界分工，并与 `#354` / `#355` 收口语境对齐
- [x] 冻结命令级 `run_id` 口径：复用 FR-0001 单次调用 `run_id`，不引入 Profile 级或持久化第二套运行标识
- [x] 冻结 `__webenvoy_meta.json` 最小字段白名单（含嵌套字段最小白名单）
- [x] 冻结 FR-0003 会话层错误码白名单，并与 FR-0001 / FR-0002 的错误分层解耦
- [x] 明确 `localStorageSnapshots` 在 FR-0003 中仅作为最小会话摘要 / 恢复输入，不要求自动回写浏览器会话
- [x] 完成 `#356` 要求的 formal review 文档回写，并清空当前套件内的文档 blocker
- [x] formal 结论：`APPROVE`
- [x] formal 结论：`ready_for_implementation = true`
- [x] 确认 FR-0003 的实现链路必须保持 spec / impl 分离

## 进入实现前条件（未来门禁定义）

- 等待 `APPROVE`
- 等待 `ready_for_implementation = true`
- 确认 FR-0003 的实现链路保持 spec / impl 分离
- 确认 FR-0003 与 FR-0001 / FR-0002 / FR-0006 / FR-0015 的正式边界已冻结

## Formal Review 参考依据

- `#168` 作为 FR-0003 的正式契约同步 issue 持续保留，且已有“FR-0003 已完成并进入主干；对应规约与实现已合并”的历史记录，可作为本次 review 参考存量之一。
- `#167` 作为 FR-0003 的独立规约评审 PR 存在，说明 FR-0003 的 formal spec review 链路已经实际存在。
- `#171/#181` 作为独立实现 PR 的历史记录存在，说明 FR-0003 的 spec / impl 分离策略已经实际成立。
- `#182` 进一步收紧 `localStorageSnapshots` 的最小边界，说明 `__webenvoy_meta.json` 中该字段的“最小会话摘要 / 恢复输入”口径已经在正式链路中得到补强。
- `#372` 的 latest guardian review 已在 commit `fd34a4abe3f09f795f51bec76dae1bba9aca1fa2` 上于 `2026-04-06T07:32:35Z` 明确给出 `APPROVE`，随后该 PR 于 `2026-04-06T07:32:44Z` 合入主干，merge commit 为 `fda39a211ff3fa50acdfe6fa27d8e0e8b7f6ec8f`。
- `#354/#355` 已完成 formal 收口，FR-0003 承接的 CLI 外层契约与最小通信基座已不再构成当前 review 阻塞。
- `#379` 已安全合并，但它只承担 final writeback-only，不重开 spec；`#372` 才是 actual formal-review record。
- 本次 `#356` finalization 只负责把 FR-0003 的最终完成态正确落回主干，并以“formal review 链路已存在 + 独立实现已成立 + 上游基座已完成收口 + `#372` latest guardian 已 `APPROVE` 且随后合入主干”为依据记录最终 formal verdict。

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
