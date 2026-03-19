# AGENTS.md

本文档只负责 `docs/` 目录导航，不重复根级规范。

```text
docs/
 ├── AGENTS.md
 ├── dev/                  # 研发规范、路线图、架构、FR 规约
 ├── research/
 │   └── ref/              # 外部项目调研与参考分析
 └── archive/              # 历史文档与归档材料
```

## 查阅规则

- 要做实现、设计、评审或任何工程决策：读 [`docs/dev/AGENTS.md`](./dev/AGENTS.md)
- 要做 FR / 架构规约审查：同时读 [`spec_review.md`](../spec_review.md)
- 要起草正式 FR 套件：把“spec”理解为整套 `spec.md + plan.md + TODO.md`，不要只补单个文件
- 要补背景调研或比较竞品：按需进入 `docs/research/ref/`
- 要看历史资料：进入 `docs/archive/`

`docs/` 不是独立规范源头。全局纪律以仓库根级 `AGENTS.md` 为准，研发流程以 [`docs/dev/AGENTS.md`](./dev/AGENTS.md) 为准。
