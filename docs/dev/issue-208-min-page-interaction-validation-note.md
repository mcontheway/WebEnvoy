# #208 最小页面交互动作收口说明

> 状态：已弃用，不再作为正式口径

本文件保留原路径，仅用于承接历史引用。

`#208` 的现行正式验证口径已在 PR `#298` 合入后收口到 `FR-0011` 与 GitHub Issue `#208`，后续评审、实现与关闭语义应只以以下来源为准：

- `docs/dev/specs/FR-0011-xhs-min-anti-detection-execution/spec.md`
- `docs/dev/specs/FR-0011-xhs-min-anti-detection-execution/plan.md`
- `docs/dev/specs/FR-0011-xhs-min-anti-detection-execution/data-model.md`
- `docs/dev/specs/FR-0011-xhs-min-anti-detection-execution/contracts/anti-detection-execution.md`
- GitHub Issue `#208`

当前冻结结论：

- `#208` 的唯一正式验证对象是 `editor_input`
- 正式验证范围仅限 `creator.xiaohongshu.com/publish` 上的单动作、可逆真实交互
- 本事项仍未关闭；后续只有真实验证实现 PR 才可 `Fixes #208`
- 上传、提交、发布确认、完整写链路、稳定命令接口冻结均不属于本文件或本事项当前范围

如果后续需要继续修订 `#208` 的正式边界，不要更新本文件；请直接修订 `FR-0011` 或 GitHub Issue `#208`。
