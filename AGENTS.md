# AGENTS.md

## Quick Load

- 先读 `vision.md`，再读 `docs/dev/AGENTS.md`
- 当前仓库以文档、架构、脚本、CI 为主，业务代码骨架尚未完整建立
- WebEnvoy 是 Web 执行工具，不是 Agent 大脑
- 技术主线：TypeScript/Node CLI + Chrome Extension + Native Messaging + Playwright + SQLite
- 当前主线优先级：执行内核与快速适配器化 > CLI-first 的可集成执行契约 > 能力交付与分享
- 执行层优先级：L3 专用适配器 > L2 通用层 > L1 视觉/物理兜底
- 未知网站不是只做一次性漫游；L2 成功路径应尽快沉淀为可复用适配器
- 当前集成策略：默认以 CLI 作为第一集成面；暂不把 SDK / API 作为当前主线交付
- 架构红线：浏览器内执行是唯一 HTTP 出口；不缝合外部异构爬虫为核心运行时
- 禁止直推主分支；提交必须用中文 Conventional Commits；主干只用 Squash Merge
- 日常合并禁止直接使用 `gh pr merge`；统一通过 `bash scripts/merge-pr.sh <pr-number>`
- fresh clone 或新 worktree 首次进入仓库后，先执行 `bash scripts/setup-git-hooks.sh` 启用本地提交钩子
- 单测放同级 `__tests__/`，E2E/集成放根目录 `tests/`
- 本地不保留 backlog / sprint 进度文件，GitHub Issues / Projects 是唯一进度真理
- 高风险改动包括 `.github/workflows/`、`scripts/`、执行引擎、账号、安全、数据读写
- 证据不足默认不放行；先审查后合并
- 正式契约看 `docs/dev/specs/`；研究目录只作参考
- FR / 架构规约审查基线看 `spec_review.md`
- 参考研究不是正式规范；如与架构或 spec 冲突，以正式文档为准

## 按任务加载顺序

所有 AI Agent 在操作此仓库前，按以下顺序恢复上下文：

1. `vision.md`
2. `docs/dev/roadmap.md`
3. `docs/dev/architecture/system-design.md`
4. 与当前任务直接相关的架构子文档
5. 对应 `docs/dev/specs/FR-XXXX-*/`
6. 当前分支的 `TODO.md`（如果有）
7. 用户当前提供的 Issue / PR / 任务描述

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
- 当前阶段先证明“Agent 好用的 Web 执行内核”和“快速适配器化”成立
- 当前仓库不承担独立上层运行系统职责，应优先把网页执行、CLI-first 的可集成契约与能力沉淀做好
- CLI 必须按可集成契约设计：语义稳定、输入输出机器可读、错误结构化、运行标识清晰
- 只保留执行所必需的最小身份 / 会话能力：身份指定、登录恢复、执行隔离、并发保护、状态回传
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

事项分流与默认通道：

- 轻量事项
  - 范围：纯文案、低风险微修复、非契约性说明补充、局部且无行为变化的整理
  - 默认通道：GitHub Issue（如有）+ PR
- 中等事项
  - 范围：会影响多个文件或模块，但不改变上位架构边界、共享契约、共享数据模型，也不属于高风险链路
  - 默认通道：GitHub Issue + 简化版设计说明 + PR
  - 设计说明默认优先放在 PR 描述中；若需要跨会话复用或 review 前冻结输入，可按 `docs/dev/templates/design-note.md` 模板落成 Markdown
- 核心 / 高风险事项
  - 范围：核心特性、跨模块设计项、架构边界调整、共享契约/数据模型变化、高风险链路
  - 默认通道：完整 FR 套件 + spec review；是否拆分 spec / impl PR 由风险决定，而不是一刀切

执行要求：

1. 先基于 `docs/dev/roadmap.md` 梳理当前阶段的需求池，并在 GitHub Issues / Projects 中维护 backlog。
2. 轻量事项不强制建立设计说明或 FR，但一旦范围扩张或触发边界/行为变化，必须升级到中等事项或核心 / 高风险事项通道。
3. 中等事项在进入实现前，必须先冻结简化版设计说明，写清目标、范围、影响面、验证方式与回滚方式；如 review 发现其已触发架构边界、共享契约或高风险条件，立即升级为正式 FR。
4. 只有在当前阶段候选项已经明确后，才进入 FR 规约漏斗；不要在范围未确认前，提前向 `docs/dev/specs/` 写入正式 FR 目录。
5. 核心特性、高风险改动、跨模块设计项，必须先建立正式 FR 规约，再进入开发。
6. 正式 FR 按复杂度分级：
   - Spike FR：聚焦证据、边界、准入条件与 handoff，不把研究事项伪装成完整实施规格
   - 标准 FR：最小套件为 `spec.md`、`plan.md`、`TODO.md`
   - 高风险 FR：在标准 FR 基础上，按触发条件补齐 `contracts/`、`data-model.md`、`research.md`、`risks.md`
7. 起草正式 FR 时，应把“spec”理解为整套正式 FR 套件，而不是只写 `spec.md`。
8. 如事项引入稳定接口、共享数据模型、关键外部未知项或高风险链路，对应的 `contracts/`、`data-model.md`、`research.md`、`risks.md` 即转为必需，而不是可选装饰。
9. spec review 的目标是确认需求、边界、架构一致性、验收标准和风险，不得把 spec 当作开发后的补文档。
10. 只有在 spec review 通过后，相关事项才能被纳入 Sprint 实施承诺。
11. 小修复、低风险微特性、纯文案调整，可以只建 GitHub Issue，不强制要求建立 FR。

spec review 的执行约束：

- FR / 架构规约分支默认先开 Draft PR
- 高风险 FR、边界未稳定事项、跨模块契约变更默认强制分离 spec review 与实现 PR
- 标准 FR 在边界清楚、风险可控、实现范围有限时，可以把规约与实现放在同一条链路，但必须分提交或分阶段 review，且先收口规约结论，再继续实现
- 正式 spec 变更的审查标准统一看 `spec_review.md`
- 如 PR 同时改动 `docs/dev/specs/**` 与实现代码：
  - 高风险 FR 或边界未稳定事项，默认视为流程违规
  - 标准 FR 仅在满足“风险可控 + 先规约后实现 + review 结论可分段收口”时允许
  - 纯 `TODO.md` 进度回写且不改变正式契约语义，仍可与实现同 PR
- `spec.md` 的验收场景默认使用 `Given / When / Then`
- 起草标准 FR / 高风险 FR 时，必须补齐异常与边界场景，以及 `plan.md` 的最低 7 节：`实施目标`、`分阶段拆分`、`实现约束`、`测试与验证策略`、`TDD 范围`、`并行 / 串行关系`、`进入实现前条件`
- Spike FR 的 `plan.md` 应聚焦证据目标、准入条件、风险边界和 handoff 输入，不强行伪装成完整实施拆分
- `contracts/` 只在存在稳定机器接口、跨进程协议、共享 payload 边界时创建；创建后不得为空壳目录
- `data-model.md` 只在引入或修改持久化 / 共享实体时创建；必须写清核心实体、关键字段、约束与生命周期
- `research.md` 只在正式契约依赖关键未知项、第三方验证或方案取舍时创建；不能替代正式契约
- `risks.md` 只在涉及账号、安全、写入、迁移、并发、公共基座或不可逆动作时创建；必须写清缓解与回滚

对 `plan.md` 的最低判断标准：

- `实施目标`：写清这次实现具体交付什么
- `分阶段拆分`：写清每阶段产出与先后依赖
- `实现约束`：写清当前实现不能碰的边界
- `测试与验证策略`：写清怎么证明完成
- `TDD 范围`：写清哪些模块先写测试，哪些暂不强制
- `并行 / 串行关系`：写清哪些 issue / 工作项可并行，哪些是前绪阻塞
- `进入实现前条件`：写清 spec review 通过后才能开始的动作

额外约束：

- `docs/dev/specs/` 是正式契约区，不是 backlog 草稿区，也不是需求讨论草稿区。
- backlog、Sprint 范围、状态流转一律以 GitHub 为准，本地 Markdown 不承担项目管理真相源职责。
- 如果当前仍处于需求池讨论阶段，允许先修改 `roadmap.md`、架构文档或研究文档，但不应提前创建正式 FR 目录。

载体职责收敛：

- Issue：事项本体、目标、边界、关闭条件
- Project：当前管理状态与优先级
- PR：本次改动范围、关闭语义、验证证据
- `TODO.md` / handoff：实现停点、恢复入口、阻断项；不表达项目真相源状态

## 轻量改动通道

以下改动可以走“轻量改动通道”，但**仍必须走分支 + PR + review + squash merge**：

- 纯文案修正、错别字修复、失效链接修复、格式整理
- 不改变正式契约、架构边界和流程语义的说明性文档补充
- 不引入行为变化的注释、示例或非契约性说明更新

以下改动**不得**按轻量改动处理，一律回到普通或高风险路径：

- `vision.md`
- `AGENTS.md`
- `code_review.md`
- `docs/dev/architecture/**`
- `docs/dev/specs/**`
- `.github/workflows/**`
- `scripts/**`
- `.githooks/**`
- 任何会改变执行行为、合并门禁、正式契约、架构边界或审查标准的修改

轻量改动的执行要求：

- 不强制建立 FR 套件
- PR 描述可以使用精简模板，但至少要写清摘要、关联 Issue（如有）、验证方式、回滚方式
- 创建 PR 时优先使用 `bash scripts/open-pr.sh`
- 验证证据以链接检查、渲染检查、`bash scripts/docs-guard.sh` 或等价静态校验为主
- 一旦变更范围扩张或混入行为改动，立即切回普通路径，不继续按轻量改动申报

推荐分支命名：

- 设计 / 规约：`docs/FR-XXXX-*`
- 功能开发：`feat/FR-XXXX-*`
- 缺陷修复：`fix/<scope>-*`

提交 PR 时，若对应 GitHub Issue 已存在，应显式写明关闭语义：

- 实现闭环并在本 PR 合入后应关闭 issue：使用 `Fixes #<issue-number>`
- Spike、规约、研究或仅部分完成闭环：使用 `Refs #<issue-number>`，不要提前关闭

## Review 与合并底线

任何合并前必须先 review，不能因为测试通过就跳过判断。
在进行代码审查时，请始终遵循 [code_review.md](./code_review.md) 中的标准。
高风险改动、审查结论判定、合并门禁与本机 review / merge 流程，统一以 [code_review.md](./code_review.md) 为准。

合并流程硬约束（适用于本仓库当前 private free 背景）：

1. 禁止直接执行 `gh pr merge` 作为日常合并路径。
2. 合并必须通过 `bash scripts/merge-pr.sh <pr-number>` 触发。
3. merge 前必须同时满足：
   - latest guardian verdict 为 `APPROVE`
   - GitHub checks 全绿（不是只看 required checks）
4. 在 private free repo 下，不得把 GitHub Required Checks 视为唯一硬门禁；必须同时执行本地脚本门禁。

## Review guidelines

- 优先识别阻止合并的问题，而不是给泛泛建议。
- 审查时必须对照 `vision.md`、根级 `AGENTS.md`、`docs/dev/AGENTS.md`、相关架构文档、对应 spec / TODO 与当前 PR / Issue 描述。
- 如果实现与产品边界、架构原则或正式 spec 冲突，应直接指出，而不是只看局部代码是否可运行。
- 将以下目录或主题视为高风险：`.github/workflows/`、`scripts/`、执行引擎、账号体系、适配器协议、数据读写、schema、迁移、安全与风控链路。
- 对高风险改动，重点检查副作用、回滚路径、验证证据与滥用面扩张风险。
- 如果关键测试、验证证据或合并元数据不足，默认给出阻断性结论。
- 如果对应 GitHub Issue 已存在，PR 描述应显式包含正确的关闭语义：
  - 完整实现闭环使用 `Fixes #<issue-number>`
  - Spike、规约、研究或部分完成场景使用 `Refs #<issue-number>`
- `docs/dev/specs/` 是正式契约区，不应把 backlog 草稿、未确认需求或本地进度真相源写入其中。

## AI 执行职责

本项目采用“人类决策，AI 全托管执行”的协作方式。

- 人类负责下达自然语言目标与审批关键节点
- AI 负责使用 `git` 和 `gh` 完成分支、提交、推送、PR、review、merge 等底层操作
- 涉及核心特性时，优先围绕对应 FR 的 `spec.md`、`plan.md`、`TODO.md` 推进

## 目录可信度

- `docs/dev/specs/`：特性契约与实现准入基线
- `docs/dev/architecture/`：架构约束与设计依据
- `docs/research/ref/`：参考研究，不是最终规范

起草正式 FR 套件时，可优先使用 `$spec-suite-drafting` 技能对齐结构与审查口径。

如果研究结论与正式架构 / spec 冲突，以 `vision.md`、`docs/dev/architecture/` 和对应 spec 为准。
