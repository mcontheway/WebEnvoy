# FR-0001 TODO

## Spec Review 阶段

- [x] 补齐 `spec.md` 的 GWT 验收场景
- [x] 补齐 `spec.md` 的异常 / 边界场景
- [x] 冻结最小 CLI argv 调用约定
- [x] 补齐 `ERR_EXECUTION_FAILED` 的 GWT 与验证口径
- [x] 升级 `plan.md` 到最新 7 节结构
- [x] 补齐最小 CLI 契约文档 `contracts/cli-entry.md`
- [x] 补齐共享契约基座风险文档 `risks.md`
- [x] 本地运行文档相关最小校验
- [x] 在 GitHub Issue `#141` 中绑定 `FR-0001`
- [x] 创建仅包含规约文档的 Draft PR
- [x] 完成 spec review，并收敛所有 findings / blockers
- [x] `data-model.md` 的 formal review coverage 已由 `#353` 补齐

## 进入实现前条件（门禁定义）

- 获得 `APPROVE`
- 获得 `ready_for_implementation = true`
- 确认 FR-0001 的实现 PR 与 spec PR 分离

本节保留为进入实现前的门禁定义，不在 close-out 回写中倒写为历史上已先行满足；当前 formal 收口记录见下节。

## Formal 收口记录

- [x] `#160` 已给出 FR-0001 的 `APPROVE`
- [x] `#160` 已给出 FR-0001 的 `ready_for_implementation = true`
- [x] `#162` 已作为独立实现 PR 合入，说明 FR-0001 的 spec PR 与实现 PR 分离已实际成立
- [x] `#353` 已补齐 `data-model.md` 的 formal review coverage，因此当前套件缺失项已收口完毕

## Spec Review 通过后进入实现

- [ ] 初始化 Node / TypeScript CLI 最小工程骨架
- [ ] 建立 `webenvoy` 入口与可执行方式
- [ ] 建立命令上下文标准化层
- [ ] 建立统一成功 / 错误响应格式化器
- [ ] 建立稳定退出码与错误码常量
- [ ] 建立命令注册表与路由层
- [ ] 落地最小已实现运行时命令
- [ ] 为已注册但未实现命令提供占位处理器
- [ ] 为后续 `#142`、`#143`、`#145` 预留命名空间承载
- [ ] 补齐 CLI 契约测试、退出码断言与 `stdout` 污染断言
