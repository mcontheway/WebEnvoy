## 摘要

- 变更目的：
- 主要改动：

## 关联事项

- Issue: {{ISSUE}}
- Closing: {{CLOSING}}

## 风险级别

- `{{RISK_LEVEL}}`
- 判断依据：{{RISK_REASON}}

## 验证

- 已执行：
- 未执行：

## Live Evidence（仅对声称完成真实 runtime / 真实页面交互 / 真实 live 闭环的 PR 必填；不适用请写 `N/A`）

- latest_head_sha:
- profile:
- browser/channel:
- execution_surface（真实浏览器执行面 / stub / fake host / other）:
- page URL:
- target_tab_id:
- run_id:
- relay_path:
- editor_locator（或等价交互定位）:
- success_signals:
- minimum_replay:
- artifact/log 引用:
- failure_reason（成功填 `N/A`）:
- blocker_level（成功填 `N/A`）:

## 作者执行现场自述（供 review 参考）

- 本次执行现场：
- worktree / clone 路径：
- 是否保持单 worktree 单 issue/PR：
- PR 创建后是否扩 scope（如有，拆分到哪一个 PR）：
- 纯度预检门禁执行记录（命令与结果）：

## 回滚

- 回滚方式：{{ROLLBACK}}

## 检查清单

- [ ] 已确认本 PR 不直接推送主分支
- [ ] 已确认标题和提交信息符合中文 Conventional Commits 约束
- [ ] 已补充与风险相匹配的验证证据
- [ ] 如有对应 Issue，已在 PR 描述中显式写出正确的关闭语义（`Fixes #...` 或 `Refs #...`）
- [ ] 若本 PR 声称完成真实 live 闭环，已补齐 latest head 的有效 live evidence，且未把 stub/fake host、`runtime.ping` 或 `runtime.bootstrap` 误写为真实闭环证据
- [ ] 如涉及 FR / 架构 / 高风险目录，已补充必要上下文与影响说明
- [ ] 如涉及正式 spec / 架构规约，已先完成 spec review，且未与实现代码混在同一 PR
- [ ] 如本 PR 是正式套件起草 / 修订，已补齐 GWT、异常场景、测试策略与 TDD 范围
- [ ] 作者已填写“执行现场自述”，并提供可复核的纯度预检记录
