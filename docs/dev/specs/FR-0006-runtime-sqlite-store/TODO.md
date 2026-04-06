# FR-0006 TODO

> 本文件记录 FR-0006 在 `#359` 语境下的 formal spec review 修正状态；当前 formal review 仍保持 open，直到 reviewer 明确给出 `APPROVE` 与 `ready_for_implementation = true`。

## Formal Review Repair Snapshot

- [x] 确认 `spec.md` 只覆盖 Phase 1 最小运行记录基座，不扩张到完整业务仓库
- [x] 确认 SQLite 角色边界明确：证据层，不是实时会话真相源，也不是能力真相源
- [x] 确认 `data-model.md` 字段与约束可直接支撑实现与测试
- [x] 确认 `contracts/runtime-store.md` 输入输出、错误码与兼容策略完整
- [x] 确认 `risks.md` 覆盖并发写入、敏感字段泄露、迁移失败与能力边界误用风险
- [x] 当前 formal 承接 issue 已冻结为 `#359`
- [x] 旧 `#144/#159` 残留已回收到“历史来源 / 当前共享边界”的 formal 语境
- [x] 与 `#356` 的共享边界已收紧为：`run_id` 关联键 + `profile_name` 引用字段；`session_id` 仅作为 optional pending field
- [x] 与 `#357` 的共享边界已收紧为：最小诊断 projection、脱敏与截断，不承诺持久层 1:1 还原完整诊断对象
- [x] 与 `#360` 的共享边界已收紧为：能力运行证据锚点，不宣称能力字段映射已完整冻结
- [x] 本地 formal review 修正所需文档项已收口，不再依赖额外 TODO 占位
- [ ] formal 结论：`APPROVE`
- [ ] formal 结论：`ready_for_implementation = true`

## 进入实现前条件（门禁定义）

- 获得 `APPROVE`
- 获得 `ready_for_implementation = true`
- 确认与 `#356` 的 `run_id/session_id/profile` 复用边界已冻结
- 确认与 `#357` 的诊断字段映射边界已冻结
- 确认与 `#360` 的能力证据字段映射边界已冻结

## Formal Review 现状依据

- 历史规约评审 PR `#174` 已完成并合入，FR-0006 的 formal spec review 结论已不再停留在本地 TODO 语境。
- `#354/#355` 已完成 formal 收口，FR-0006 承接的 CLI 外层契约与最小通信基座已不再构成当前 closeout 阻塞。
- FR-0006 当前套件已在本地回写并对齐与 `#356/#357/#360` 的共享边界，供 formal review 继续判断。
- 当前 issue `#359` 只负责修正 formal review 元数据与共享边界表述，不重开 FR-0006 的正式边界，也不扩写到实现代码或完整业务仓库。
- 历史 PR `#174` 与上游 `#354/#355` 收口可以作为当前 review 的背景输入，但不能替代 `#359` 语境下新的 review 结论。
- 因此，FR-0006 当前仍应保持 formal review open，直到 findings / blockers 清零并由 reviewer 明确给出 `APPROVE` 与 `ready_for_implementation = true`。

## Implementation Backlog

- [ ] 实现 SQLite 初始化、WAL 启用与 schema 版本校验
- [ ] 实现运行主记录幂等写入
- [ ] 实现运行事件追加写入与主记录关联约束
- [ ] 实现按 `run_id` 的最小查询接口
- [ ] 实现诊断字段落库的脱敏与截断
- [ ] 补齐单元、契约、集成测试并收集验证证据
