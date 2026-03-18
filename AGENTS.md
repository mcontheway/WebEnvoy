# AGENTS.md

## Quick Load

- 先读 `vision.md`，再读 `docs/dev/AGENTS.md`
- 当前仓库以文档、架构、脚本、CI 为主，业务代码骨架尚未完整建立
- WebEnvoy 是 Web 执行工具，不是 Agent 大脑
- 技术主线：TypeScript/Node CLI + Chrome Extension + Native Messaging + Playwright + SQLite
- 优先级：L3 专用适配器 > L2 通用层 > L1 视觉/物理兜底
- 架构红线：浏览器内执行是唯一 HTTP 出口；不缝合外部异构爬虫为核心运行时
- 禁止直推主分支；提交必须用中文 Conventional Commits；主干只用 Squash Merge
- 单测放同级 `__tests__/`，E2E/集成放根目录 `tests/`
- 本地不保留 backlog / sprint 进度文件，GitHub Issues / Projects 是唯一进度真理
- 高风险改动包括 `.github/workflows/`、`scripts/`、执行引擎、账号、安全、数据读写
- 证据不足默认不放行；先审查后合并
- 正式契约看 `docs/dev/specs/`；研究目录只作参考
- 参考研究不是正式规范；如与架构或 spec 冲突，以正式文档为准

## 按任务加载顺序

所有 AI Agent 在操作此仓库前，按以下顺序恢复上下文：

1. `docs/dev/roadmap.md`
2. `docs/dev/architecture/system-design.md`
3. 与当前任务直接相关的架构子文档
4. 对应 `docs/dev/specs/FR-XXXX-*/`
5. 当前分支的 `TODO.md`（如果有）
6. 用户当前提供的 Issue / PR / 任务描述

不要默认每次都需要完整读取 `docs/dev/architecture/` 全目录。应先看总览，再按任务进入相关子文档，例如：

- 执行链路：`docs/dev/architecture/system-design/execution.md`
- 读写与页面交互：`docs/dev/architecture/system-design/read-write.md`
- 通信协议：`docs/dev/architecture/system-design/communication.md`
- 账号与配置空间：`docs/dev/architecture/system-design/account.md`
- 适配器与规则：`docs/dev/architecture/system-design/adapter.md`
- 反检测与账号安全：`docs/dev/architecture/anti-detection.md`
- 非功能指标：`docs/dev/architecture/system_nfr.md`

## 项目快照

当前仓库处于“规范、架构、流程先行”的阶段。

- 顶层内容以文档、脚本、CI 工作流为主
- 业务代码骨架尚未完整建立
- `docs/dev/specs/` 是未来特性契约的落点
- `.github/workflows/` 与 `scripts/` 已承担流程门禁职责

不要默认仓库已经具备完整的 `src/`、依赖管理、测试框架或可运行应用入口；开始实现前应先确认对应 FR 规约与最小工程骨架是否已存在。

## 全局技术边界

WebEnvoy 的定位是“供上层 AI 调用的 Web 执行工具”，不是 Agent 大脑。

- 只负责执行、侦察、调度与结构化回传
- 不负责长链路任务规划、聊天 UI 或内容生成
- 对高价值平台优先采用 L3 专用适配器
- L2 通用层用于未知站点
- L1 视觉 / 物理输入仅作兜底

架构红线：

- 浏览器内执行是唯一 HTTP 出口
- 不引入外部异构爬虫作为核心执行基石
- 核心实现必须保持自主代码资产

技术细节以 `vision.md` 和 `docs/dev/architecture/` 为准。

## 全局协作纪律

1. 禁止直推主分支。所有开发和文档修改必须在独立分支完成，并通过 PR 合入。
2. Commit Message 必须使用中文，并符合 Conventional Commits 规范。
3. 合入主干必须使用 Squash Merge。
4. 单元测试放在被测文件同级 `__tests__/`；端到端/集成测试统一放在仓库根目录 `tests/`。
5. 本地代码库中不保留 backlog、sprint 等进度追踪文件；GitHub Issues / Projects 是唯一进度真理。

## 需求到交付的标准机制

本项目的默认推进顺序固定如下：

`Roadmap / 阶段目标 -> GitHub backlog -> 选定当前阶段候选项 -> 为核心项建立 FR spec -> spec review -> 进入 Sprint 实施 -> PR review -> merge`

执行要求：

1. 先基于 `docs/dev/roadmap.md` 梳理当前阶段的需求池，并在 GitHub Issues / Projects 中维护 backlog。
2. 只有在当前阶段候选项已经明确后，才进入 FR 规约漏斗；不要在范围未确认前，提前向 `docs/dev/specs/` 写入正式 FR 目录。
3. 核心特性、高风险改动、跨模块设计项，必须先建立正式 FR 规约，再进入开发。
4. 正式 FR 套件必须至少包含 `spec.md`、`plan.md`、`TODO.md`；其余补充文档按复杂度按需添加。
5. spec review 的目标是确认需求、边界、架构一致性、验收标准和风险，不得把 spec 当作开发后的补文档。
6. 只有在 spec review 通过后，相关事项才能被纳入 Sprint 实施承诺。
7. 小修复、低风险微特性、纯文案调整，可以只建 GitHub Issue，不强制要求建立 FR。

额外约束：

- `docs/dev/specs/` 是正式契约区，不是 backlog 草稿区，也不是需求讨论草稿区。
- backlog、Sprint 范围、状态流转一律以 GitHub 为准，本地 Markdown 不承担项目管理真相源职责。
- 如果当前仍处于需求池讨论阶段，允许先修改 `roadmap.md`、架构文档或研究文档，但不应提前创建正式 FR 目录。

推荐分支命名：

- 设计 / 规约：`docs/FR-XXXX-*`
- 功能开发：`feat/FR-XXXX-*`
- 缺陷修复：`fix/<scope>-*`

提交 PR 时，若对应 GitHub Issue 已存在，应显式带上 `Fixes #<issue-number>`。

## Review 与合并底线

任何合并前必须先 review，不能因为测试通过就跳过判断。
在进行代码审查时，请始终遵循 [code_review.md](./code_review.md) 中的标准。

Review 至少覆盖以下方面：

- 需求是否正确
- 设计与边界是否合理
- 是否存在行为回归或兼容性风险
- 是否有足够测试与验证证据
- 是否引入安全或滥用面问题
- 流程与元数据是否合规

以下目录默认视为高风险改动：

- `.github/workflows/`
- `scripts/`
- 执行引擎、账号、适配器协议、数据读写、安全与风控相关代码

高风险改动必须升级审查强度，并明确检查副作用、回滚路径与验证证据。

只要存在高概率错误、关键验证缺失、证据不足或流程违背，默认结论应为 `REQUEST_CHANGES`。

合并前必须同时满足以下条件：

- PR 非 Draft
- review 已完成
- 审查结论为 `APPROVE`
- `safe_to_merge = true`
- GitHub Required Checks 全绿
- 目标分支允许按仓库策略合入

FR 分支的推荐做法：

- FR / 规约分支默认先开 Draft PR
- 先在 Draft PR 中完成 spec review
- spec review 通过后，再进入实现或解除 Draft
- 不要把“等待定时 review”作为进入下一步的前提

本机按需 review / merge 入口：

- `scripts/pr-guardian.sh`
- 详细说明见 [code_review.md](./code_review.md)

## AI 执行职责

本项目采用“人类决策，AI 全托管执行”的协作方式。

- 人类负责下达自然语言目标与审批关键节点
- AI 负责使用 `git` 和 `gh` 完成分支、提交、推送、PR、review、merge 等底层操作
- 涉及核心特性时，优先围绕对应 FR 的 `spec.md`、`plan.md`、`TODO.md` 推进

## 目录可信度

- `docs/dev/specs/`：特性契约与实现准入基线
- `docs/dev/architecture/`：架构约束与设计依据
- `docs/research/ref/`：参考研究，不是最终规范

如果研究结论与正式架构 / spec 冲突，以 `vision.md`、`docs/dev/architecture/` 和对应 spec 为准。
