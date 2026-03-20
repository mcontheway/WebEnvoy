# Sprint 收尾 Checklist

本文档用于 Sprint 或长链路事项收尾时的最小治理检查。它不是 backlog 真相源，也不替代 GitHub Issue / Project 状态。

## 1. 状态一致性

- 当前分支、PR、Issue、Project 状态一致
- 未完成事项仍保持打开，不用 `Fixes #...` 提前关闭
- 若已完成实现，PR 文案、Issue 状态与合并结论一致

## 2. 合并与验证

- 对应 PR 的 review 结论已收口
- GitHub checks 状态已确认
- 普通或高风险 PR 已基于最新 head 跑过本地 `scripts/pr-guardian.sh review <pr-number>`
- 已知阻断项要么修复，要么明确沉淀为下一事项输入

## 3. 文档与恢复入口

- `TODO.md` 已更新到当前真实停点
- 如事项跨会话或待外部动作，已生成本地 handoff
- handoff 中包含下一步第一动作、关键命令和当前阻断

## 4. 环境清理

- 临时 worktree、独立 clone、抓样目录已清理，或在 handoff 中说明保留原因
- `.webenvoy/`、临时日志、抓包文件、未使用输出目录等已确认不混入提交
- 无关噪音分支已整理，不让历史现场继续污染下一轮开发

## 5. 下一轮入口

- 已明确下一主线 issue / FR
- 已记录下一轮需要先看的 PR、文档或验证命令
- 若存在外部等待项，已写清等待条件与恢复触发点
