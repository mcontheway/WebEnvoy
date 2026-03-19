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

补充约束：

- 正式 spec / 架构改动默认先开 Draft PR，先完成 spec review，再进入实现
- spec review 的审查标准统一以仓库根级 `spec_review.md` 为准
- 除纯 `TODO.md` 进度回写外，不要把 `docs/dev/specs/**` 正式契约变更和实现代码混在同一 PR
- 起草正式套件时，默认补齐 `spec.md` 中的 `GWT` 验收场景与异常/边界场景，以及 `plan.md` 的最低 7 节：`实施目标`、`分阶段拆分`、`实现约束`、`测试与验证策略`、`TDD 范围`、`并行 / 串行关系`、`进入实现前条件`

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
 ├── risks.md
 └── contracts/
```

- `spec.md`：必须有，定义做什么与验收标准
- `plan.md`：必须有，定义如何实现、如何验证，以及进入实现前门槛
- `TODO.md`：必须有，用于跨会话恢复细粒度进度
- 其余文件按复杂度按需补充

按需文档触发条件：

- `contracts/`
  - 必须出现：新增或修改 CLI 契约、Native Messaging、扩展通信、结构化返回、适配器接口或其他稳定机器边界
  - 不应出现：仅限局部内部实现细节，没有稳定消费者的临时结构
- `data-model.md`
  - 必须出现：新增或修改 SQLite schema、持久化记录、身份 / 会话 / 任务 / 配置等共享实体
  - 不应出现：不涉及共享状态、持久化或跨模块语义的临时对象
- `research.md`
  - 必须出现：依赖第三方行为验证、签名/反检测研究、关键未知项澄清、重大方案取舍
  - 不应出现：把背景材料搬运进仓库，或试图用研究笔记代替正式契约
- `risks.md`
  - 必须出现：涉及账号、安全、写入、迁移、并发、公共基座、不可逆动作或必须明确回滚的事项
  - 不应出现：低风险、局部、可完全由 `plan.md` 覆盖的简单事项

推荐起草要求：

- `spec.md` 的验收场景优先使用 `Given / When / Then`
- `spec.md` 至少覆盖主路径、关键异常和边界场景
- `plan.md` 最低应按以下标题组织，而不是自由散文：
  - `## 实施目标`
  - `## 分阶段拆分`
  - `## 实现约束`
  - `## 测试与验证策略`
  - `## TDD 范围`
  - `## 并行 / 串行关系`
  - `## 进入实现前条件`
- `plan.md` 的 `分阶段拆分` 要写每阶段产出与依赖，不写泛泛路线
- `plan.md` 的 `并行 / 串行关系` 要点明前绪阻塞项与可并行项
- `plan.md` 的 `进入实现前条件` 必须明确 spec review 通过后才能启动哪些动作
- `TODO.md` 先写 review 阶段待办，再写实现待办
- `contracts/` 中每份文档都应只对应一个边界，并写清输入、输出、错误 / 状态和兼容策略
- `data-model.md` 至少写清核心实体、关键字段、约束、状态流转或保留策略
- `research.md` 至少写清研究问题、证据、结论和未决项
- `risks.md` 至少写清关键风险、触发条件、缓解手段和回滚 / 降级方式

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
