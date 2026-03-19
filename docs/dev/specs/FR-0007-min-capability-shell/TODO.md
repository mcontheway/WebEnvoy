# FR-0007 TODO

## Spec Review 阶段

- [ ] 补齐 `spec.md` 的 GWT 验收场景
- [ ] 补齐 `spec.md` 的异常 / 边界场景
- [ ] 冻结能力壳最小输入结构（`ability` / `input` / `options`）
- [ ] 冻结能力壳最小输出结构（`summary.capability_result`）
- [ ] 冻结能力错误细节结构（`error.details`）
- [ ] 升级 `plan.md` 到最新 7 节结构
- [ ] 补齐契约文档 `contracts/ability-shell.md`
- [ ] 补齐共享契约风险文档 `risks.md`
- [ ] 本地运行文档相关最小校验
- [ ] 在 GitHub Issue `#159` 中绑定 `FR-0007`
- [ ] 创建仅包含规约文档的 Draft PR
- [ ] 完成 spec review 并收敛 findings / blockers

## 进入实现前条件

- [ ] 获得 `APPROVE`
- [ ] 获得 `ready_for_implementation = true`
- [ ] 确认 FR-0007 的实现 PR 与 spec PR 分离

在以上三项完成前，不启动 FR-0007 的实现代码。

## Spec Review 通过后进入实现

- [ ] 建立能力输入壳解析与校验模块
- [ ] 建立能力输出壳映射模块
- [ ] 建立能力错误细节映射模块
- [ ] 为首个 L3 样本接入能力壳输出
- [ ] 补齐能力壳契约测试与回归用例
- [ ] 对齐 `#154` 的最小诊断与 `run_id` 关联
