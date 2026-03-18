# WebEnvoy 开发区规范

本文档只定义 `docs/dev/` 的研发工作流、文档语义与 FR 规约约束。
全局纪律、review 底线和项目快照请回到仓库根级 `AGENTS.md`。

## 目录职责

```text
docs/dev/
 ├── roadmap.md
 ├── architecture/
 └── specs/
```

- `roadmap.md`：Phase 级路线图与 FR 排布
- `architecture/`：系统设计、架构原则、NFR、关键子系统说明
- `specs/`：单个 FR 的正式规约套件

## 研发漏斗

WebEnvoy 采用单向漏斗，不做本地 Markdown 与 GitHub Issue 的双向同步。

1. 需求池与进度状态在 GitHub Issues / Projects 中维护。
2. 核心特性一旦立项，在 `docs/dev/specs/FR-XXXX-*` 下建立规约目录。
3. `spec.md` 合入主干后成为该特性的正式契约；修订必须通过独立 PR。
4. Spec 合入后，由 CI 将规约单向同步到 GitHub Issue。
5. 编码阶段围绕对应 spec / plan / TODO 推进，并在 PR 中关联 `Fixes #...`。

本地不保留 `backlog.md`、`sprints/` 或其他进度追踪文件。

## FR 规约结构

每个核心特性目录建议结构如下：

```text
docs/dev/specs/FR-XXXX-feature-name/
 ├── spec.md
 ├── plan.md
 ├── TODO.md
 ├── research.md
 ├── data-model.md
 └── contracts/
```

- `spec.md`：必须有，定义做什么与验收标准
- `plan.md`：必须有，定义如何实现
- `TODO.md`：必须有，用于跨会话恢复细粒度进度
- 其余文件按复杂度按需补充

日常小修复或微小特性可以只在 GitHub Issue 中描述，不强制创建 spec 套件。

## 开工前加载顺序

在 `docs/dev/` 范围内工作时，按以下顺序恢复上下文：

1. 仓库根级 `vision.md`
2. `docs/dev/roadmap.md`
3. `docs/dev/architecture/`
4. 对应 `docs/dev/specs/FR-XXXX-*/`
5. 当前分支对应 `TODO.md`
6. 用户当前提供的 Issue / PR / 任务描述

## 与其他目录的关系

- `docs/dev/` 是研发执行区和正式规约区
- `docs/research/ref/` 只提供参考研究，不直接构成实现契约
- 如果研究结论与架构文档或 spec 冲突，以架构文档和 spec 为准
