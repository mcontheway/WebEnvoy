# WebEnvoy 开发区规范

本文档只定义 `docs/dev/` 的研发工作流、文档语义与 FR 规约约束。
全局纪律、review 底线和项目快照请回到仓库根级 `AGENTS.md`。

## 目录职责

```text
docs/dev/
 ├── roadmap.md
 ├── architecture/
 ├── retrospectives/
 └── specs/
```

- `roadmap.md`：Phase 级路线图与 FR 排布
- `architecture/`：系统设计、架构原则、NFR、关键子系统说明
- `retrospectives/`：阶段复盘、流程经验与机制沉淀；用于改进研发方法，不构成正式契约
- `specs/`：单个 FR 的正式规约套件

## 研发漏斗

WebEnvoy 采用单向漏斗，不做本地 Markdown 与 GitHub Issue 的双向同步。

1. 需求池与进度状态在 GitHub Issues / Projects 中维护。
2. 核心特性一旦立项，在 `docs/dev/specs/FR-XXXX-*` 下建立规约目录。
3. `spec.md` 合入主干后成为该特性的正式契约；修订必须通过独立 PR。
4. Spec 合入后，由 CI 将规约单向同步到 GitHub Issue。
5. 编码阶段围绕对应 spec / plan / TODO 推进，并在 PR 中使用正确的关闭语义关联对应 issue：
   - 实现闭环使用 `Fixes #...`
   - Spike、规约、研究或部分完成场景使用 `Refs #...`

补充约束：

- 正式 spec / 架构改动默认先开 Draft PR，先完成 spec review，再进入实现
- spec review 的审查标准统一以仓库根级 `spec_review.md` 为准
- 除纯 `TODO.md` 进度回写外，不要把 `docs/dev/specs/**` 正式契约变更和实现代码混在同一 PR
- 起草正式套件时，默认补齐 `spec.md` 中的 `GWT` 验收场景与异常/边界场景，以及 `plan.md` 的最低 7 节：`实施目标`、`分阶段拆分`、`实现约束`、`测试与验证策略`、`TDD 范围`、`并行 / 串行关系`、`进入实现前条件`

本地不保留 `backlog.md`、`sprints/` 或其他进度追踪文件。

## 事项成熟度与关闭语义

为避免 Issue、Spec、实现 PR 的状态跑在正式边界前面，核心事项默认区分以下成熟度：

- `spike`
  - 含义：关键未知项仍在收集证据，尚未形成可进入实现的正式输入
  - 允许输出：证据、样本、候选路径、风险、Go/No-Go 判断
  - 禁止事项：把 Spike 结论写成实现承诺，或据此直接关闭实现 issue
- `spec-ready`
  - 含义：范围、阶段、依赖与证据边界已足够支撑正式 spec review
  - 允许动作：建立或修订 `docs/dev/specs/FR-XXXX-*` 正式套件
  - 禁止事项：在 spec review 通过前把该事项纳入 Sprint 实施承诺
- `implementation-ready`
  - 含义：spec review 已通过，进入实现前条件已满足
  - 允许动作：进入 Sprint 实施、提交实现 PR、补实现级验证
- `merge-ready`
  - 含义：实现 PR 的 review、验证与合并元数据均已达标
  - 允许动作：按仓库合并策略执行 squash merge

关闭语义默认遵循以下规则：

- `spike` 与 `spec-ready` 阶段的 PR / 提交默认使用 `refs #...`，不使用 `Fixes #...`
- 只有真正完成实现闭环、且已达到 `merge-ready` 的实现 PR，才使用 `Fixes #...`
- 若某事项仍存在“证据已冻结但实现未完成”的情况，应继续保持 issue 打开，而不是提前关闭

## 边界冲突处理顺序

当同一事项连续两轮以上被 review 打回，或出现“文档越改越散但仍不放行”的情况时，先判冲突层级，再决定改哪一层：

1. `vision.md` / `docs/dev/roadmap.md`
   - 先判断是否已经越过当前阶段目标，或把后续 Phase 内容提前混入
2. `docs/dev/architecture/**` / `spec_review.md`
   - 再判断是否与上位架构边界、实现准入口径或审查标准冲突
3. `docs/dev/specs/FR-XXXX-*`
   - 只有前两层一致后，才进入 FR 套件内部的措辞、结构或证据修补

执行规则：

- 未通过第 1/2 层判断前，不继续在第 3 层高频修文案
- 若冲突发生在上位基线，优先改上位文档，而不是反复下修 FR 表达

## Skill 分类与触发入口

本节仅定义 `docs/dev/` 研发语境下的 skill 入口，不扩展到仓库全局协作纪律。

### A. 通用方法论 skill（跨仓库可复用）

- `evidence-driven-spike`
  - 触发：进入方案前存在关键未知项（第三方行为、反检测可行性、性能上限、技术选型不确定）
  - 阶段：`roadmap/候选项澄清 -> FR 起草前`
  - 产出要求：证据、置信度、Go/No-Go 结论，明确是否进入正式 FR 套件
- `contract-first-review`
  - 触发：评审改动可能影响契约、边界、流程门禁、跨模块行为
  - 阶段：`spec review` 与 `实现 PR review`
  - 审查重点：先判阻断项（契约破坏、范围漂移、验证证据不足），再看风格问题
- `runtime-session-hardening`
  - 触发：涉及状态型运行时的锁、活性判断、重试恢复、异常回收、stop/start 幂等或健康矩阵设计
  - 阶段：`架构细化 -> 实现 -> 回归加固`
  - 产出要求：明确状态模型、恢复路径、异常收敛策略与最小测试矩阵
- `long-session-handoff`
  - 触发：任务链路长、多人接力、上下文即将中断、需要跨会话恢复
  - 阶段：`任意阶段收尾`
  - 产出要求：停点、当前状态、下一步、阻塞项、风险与验证快照，保证后续可直接续跑

### B. WebEnvoy 项目专用 skill（与执行内核/流程强绑定）

- `spec-suite-drafting`
  - 触发：核心特性已进入 FR 漏斗，需要按 WebEnvoy 的正式套件标准起草而非只写 `spec.md`
  - 阶段：`FR 立项 -> spec review 前`
  - 适用范围：`docs/dev/specs/FR-XXXX-*`、`spec_review.md` 口径、实现准入边界与套件补齐
- `pr-review-merge-ops`
  - 触发：本地完成实现后，需要按仓库门禁执行 PR 检查、结论判定与合并动作
  - 阶段：`实现完成 -> 合并前`
  - 适用范围：高风险目录（`scripts/`、`.github/workflows/`、执行链路）优先使用，确保门禁一致
- `gh-fr-sprint-ops`（按需）
  - 触发：需要把 FR 与 GitHub Issues/Projects 状态联动，或维护 Sprint/里程碑流转
  - 阶段：`roadmap -> backlog -> FR 立项 -> Sprint 跟踪`
  - 使用边界：仅在需要变更 GitHub 项目管理实体时启用；纯本地文档改写不强制

### C. 与研发漏斗对齐的最小触发矩阵

1. 需求澄清存在未知项：优先 `evidence-driven-spike`
2. 核心项进入正式规约：优先 `spec-suite-drafting`
3. 状态型运行时或会话稳定性改动：叠加 `runtime-session-hardening`
4. 契约或边界评审：优先 `contract-first-review`
5. GitHub FR/Sprint 流转：按需 `gh-fr-sprint-ops`
6. PR 审查与合并决策：使用 `pr-review-merge-ops`
7. 长链路中断或交接：收尾使用 `long-session-handoff`

## Spike 类事项补充规则

当事项本质是“先冻结证据边界，再决定是否进入正式实现”时，默认按 Spike 类事项处理，并至少区分以下证据层：

- `primary`
  - 首选路径；已有第一手、可复核、与正式运行边界一致的证据
- `candidate`
  - 路径或结论看起来成立，但仍缺少充分复现、关键字段冻结或正式边界对齐
- `fallback`
  - 退化保底路径；可作为风险收口或保留读能力的证据，但不自动等于实现准入
- `admission_ready`
  - 已达到后续实现 FR 可直接消费的输入质量；必须明确绑定 WebEnvoy 的正式 runtime / profile / contract 边界

额外约束：

- `fallback` 证据可以保留，但不得被描述为“实现已可开始”
- 仓库外的临时浏览器 clone、手工 profile 或不可复核环境，只能作为 `candidate` 或研究背景，不能直接升级为 `admission_ready`
- Spike 事项在进入 `implementation-ready` 前，必须先写清哪些证据只是保底，哪些证据才是正式输入

## 状态型 Runtime 事项补充要求

以下事项默认视为状态型 runtime 改动：

- 会话 / profile 锁
- controller / browser 活性判断
- `start` / `stop` / 重试恢复
- 并发隔离、断连、孤儿进程回收
- 依赖 runtime 状态的 CLI 或能力壳返回

这类事项在正式套件中至少补齐以下内容：

- `plan.md` 或 `risks.md` 写清健康矩阵：
  - 哪些信号决定 `healthy`、`disconnected`、`recoverable`、`blocked`
- `plan.md` 写清恢复路径：
  - 同 run 重试、幂等 `stop/start`、孤儿进程回收、失败后状态收敛
- 测试与验证策略中写清最小回归矩阵：
  - 至少覆盖“控制进程死 / 浏览器活”“ready marker 过期”“锁仍占用但会话断连”等状态组合

若以上内容缺失，不应把该事项视为 `implementation-ready`。

## 长链路任务 Handoff

当任务满足以下任一条件时，默认生成本地 handoff，而不是只依赖会话上下文：

- 链路较长，无法在单次会话内稳定收口
- 需要切换 worktree、分支或执行现场
- 等待外部 review、CI、第三方验证或人工决策
- 主线程与子 Agent 即将交接

handoff 默认放在本地恢复介质中，例如 `.codex/memories/`；它是恢复工具，不是 backlog 真相源。

handoff 至少应写清：

- 当前分支 / PR / Issue / 工作目录
- 最新已验证的命令与结果
- 当前阻断项与未决风险
- 下一步第一动作
- 不应混入提交的噪音文件或临时现场

## Sprint 收尾最小 DoD

Sprint 或长链路事项收尾时，除交付物本身外，还应补齐以下治理动作：

- 当前分支、PR、Issue 状态已一致，不存在“代码已合 / issue 未收”或“issue 已关 / 实现未完”的漂移
- 临时 worktree、独立 clone、抓样目录等执行现场已清理，或在 handoff 中明确保留原因
- `.webenvoy/`、临时日志、抓包产物等噪音文件已确认不混入提交
- 下一轮恢复入口已明确，例如下一步 issue、待看的 PR、待跑的验证命令

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
