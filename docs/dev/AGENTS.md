# WebEnvoy 开发区规范

本文档只定义 `docs/dev/` 的研发工作流、文档语义与 FR 规约约束。
全局纪律、review 底线和项目快照请回到仓库根级 `AGENTS.md`。

## 目录职责

```text
docs/dev/
 ├── roadmap.md
 ├── architecture/
 ├── templates/
 ├── retrospectives/
 └── specs/
```

- `roadmap.md`：Phase 级路线图与 FR 排布
- `architecture/`：系统设计、架构原则、NFR、关键子系统说明
- `templates/`：中等事项设计说明等轻量治理模板
- `retrospectives/`：阶段复盘、流程经验与机制沉淀；用于改进研发方法，不构成正式契约
- `specs/`：单个 FR 的正式规约套件

## 事项分流与载体职责

研发事项默认先做分流，再决定进入哪条治理链路：

- 轻量事项
  - 适用：纯文案、格式整理、失效链接修复、低风险微修复、非契约性说明补充
  - 默认输入：Issue（如有）+ PR
  - 升级条件：一旦影响行为、流程门禁、正式契约或上位边界，立即升级
- 中等事项
  - 适用：影响多个文件或模块，但不改变上位架构边界、共享契约、共享数据模型，也不属于高风险链路
  - 默认输入：Issue + 简化版设计说明 + PR
  - 设计说明默认优先放在 PR 描述中；若需要跨会话冻结输入或承载 review 讨论，可按 `docs/dev/templates/design-note.md` 模板落成 Markdown
- 核心 / 高风险事项
  - 适用：核心特性、跨模块设计、架构边界调整、共享契约/共享数据模型变化、高风险链路
  - 默认输入：完整 FR 套件 + spec review

载体职责固定如下：

- Issue：事项本体、目标、边界、关闭条件
- Project：当前管理状态、优先级、阶段位置
- PR：本次改动范围、关闭语义、验证证据
- `TODO.md`：实现停点、跨会话恢复入口、review blockers；不表达项目状态真相源
- handoff：暂停原因、当前阻断、下一步动作；不替代 Issue / Project 状态

## 研发漏斗

WebEnvoy 采用单向漏斗，不做本地 Markdown 与 GitHub Issue 的双向同步。

1. 需求池与进度状态在 GitHub Issues / Projects 中维护。
2. 轻量事项直接进入实现 PR；中等事项先冻结简化版设计说明，再进入实现 PR。
3. 核心特性一旦立项，在 `docs/dev/specs/FR-XXXX-*` 下建立规约目录。
4. `spec.md` 合入主干后成为该特性的正式契约；修订必须通过独立 PR。
5. Spec 合入后，由 CI 将规约单向同步到 GitHub Issue。
6. 编码阶段围绕对应 design note 或 spec / plan / TODO 推进，并在 PR 中使用正确的关闭语义关联对应 issue：
   - 实现闭环使用 `Fixes #...`
   - Spike、规约、研究或部分完成场景使用 `Refs #...`
   - 若 PR 以真实 live evidence 作为“已完成”依据，则只有 latest head 的新鲜有效 live evidence 齐备后，才允许使用 `Fixes #...`

补充约束：

- 正式 spec / 架构改动默认先开 Draft PR，先完成 spec review，再进入实现
- spec review 的审查标准统一以仓库根级 `spec_review.md` 为准
- 高风险 FR、边界未稳定事项、跨模块契约变更默认强制拆分 spec review 与实现 PR
- 标准 FR 在边界清楚、风险可控、实现范围有限时，可在同一条链路中分提交或分阶段 review；先收口规约结论，再继续实现
- `docs/dev/specs/**` 与实现代码同 PR 时：
  - 高风险 FR 默认不允许
  - 标准 FR 仅在“风险可控 + 先规约后实现 + 结论可分段收口”时允许
  - 纯 `TODO.md` 进度回写且不改变正式契约语义时允许
- 起草标准 FR / 高风险 FR 时，默认补齐 `spec.md` 中的 `GWT` 验收场景与异常/边界场景，以及 `plan.md` 的最低 7 节：`实施目标`、`分阶段拆分`、`实现约束`、`测试与验证策略`、`TDD 范围`、`并行 / 串行关系`、`进入实现前条件`
- Spike FR 的 `plan.md` 聚焦证据目标、准入条件、风险边界与 handoff 输入，不强行写成完整实施拆分

本地不保留 `backlog.md`、`sprints/` 或其他进度追踪文件。

## 工作区与分支纯度规则

为避免多会话并行写入导致分支污染，涉及正式链路（治理基线、架构、spec、实现、高风险脚本）时，默认执行以下规则：

- 正式链路默认使用独立 worktree 或隔离 clone，不在根工作区直接推进
  - 根工作区只用于临时浏览、信息收集或非正式操作；正式提交前必须切到独立执行现场
- 一个 worktree 只服务一个 issue/PR
  - 同一 worktree 不得并行承载两条链路；如出现第二个目标，必须新建 worktree/隔离 clone
- 分支创建时冻结职责，PR 创建后禁止扩 scope
  - 创建分支时先声明“本分支承载范围”和“明确不承载范围”
  - PR 创建后，仅允许修复 review 阻断项、补充同类验证或文案澄清
  - 一旦出现跨类别改动（例如治理 + 工具修复、retrospective + 脚本改动），立即停止在当前 PR 扩写，改为新开分支和新 PR
- 发现分支职责漂移时，优先执行拆分而不是继续叠加
  - 保留当前 PR 的原职责
  - 将超出范围的改动转移到新分支并单独关联 issue
- 本地创建 PR 前，默认通过纯度预检门禁做自查
  - 该门禁用于在打开 PR 前阻断常见的分支职责和文件类别混杂问题
- 正式链路的执行现场要有生命周期
  - 命名应能映射 issue/FR/PR，不保留“临时1/临时2”这类现场
  - PR 合并后应尽快清理 worktree/隔离 clone；若需保留，必须在 handoff 中说明原因
  - 事项暂停、worker 交接、等待外部动作时，应先做一次轻量收口，再离开现场

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

### 真实 Live Evidence 专项门禁

以下门禁只适用于声称完成真实 runtime、真实页面交互、真实 live read/write 闭环，或把 live evidence 作为关闭 issue、判定“已完成”或请求 merge 放行核心依据的 PR：

- 需要 latest head 的 fresh rerun；旧 head、旧 run、旧 artifact 或同一 head 下的历史 artifact 都不能直接沿用
- 证据必须来自真实浏览器执行面；repo-owned native host stub、本地 fake host 或其他替身路径不能充当 official Chrome live evidence
- 仅有 `runtime.ping` 成功或 `runtime.bootstrap` ack，不足以证明真实闭环完成

当 PR 落入专项门禁，或其职责属于 formal spec review PR / live evidence 治理落库或治理维护 PR 时，PR 描述必须先补齐结构化 `gate_applicability`，至少包含：

- `review_lane`
- `governance_context_issue_ref`
- `governance_scope_targets`
- `in_scope`
- `trigger_reasons`
- `n_a_allowed`

其中，`review_lane=governance_landing_pr` / `governance_maintenance_pr` 只有在 reviewer / guardian 同时确认“实际变更精确等于以下五处冻结治理目标文件”时才成立：

- `AGENTS.md`
- `docs/dev/AGENTS.md`
- `code_review.md`
- `docs/dev/review/guardian-review-addendum.md`
- `.github/PULL_REQUEST_TEMPLATE.md`

- `gate_applicability.governance_context_issue_ref=#310` 时，才允许进入 `governance_landing_pr`
- `gate_applicability.governance_context_issue_ref` 非空且不等于 `#310` 时，才允许进入 `governance_maintenance_pr`

若精确命中上述五处治理目标文件却缺少 `governance_context_issue_ref`，或只命中上述目标文件子集，或在五处目标文件之外扩 scope，必须直接保持 blocked，不得降格成 `general_pr`。

若同一 PR 同时命中 FR-0016 正式契约文件，或命中 `docs/dev/specs/FR-0016-live-evidence-governance-gate/TODO.md`，且又命中任一治理目标文件，必须按 `mixed_spec_and_governance_scope` 直接阻断。

只有 `gate_applicability.in_scope=true` 时，才必须继续补齐 `live_evidence_record`；若 `in_scope=false && n_a_allowed=true`，该对象才允许整块写 `N/A` 或 `null`。

进入 `merge-ready` 前，落入专项门禁的 PR 还必须在 PR 描述中补齐 `live_evidence_record`，至少包含：

- `latest_head_sha`
- `profile`
- `browser_channel`
- `execution_surface`
- `page_url`
- `target_tab_id`
- `run_id`
- `evidence_collected_at`
- `artifact_identity`
- `relay_path`
- `interaction_locator` 或等价交互定位
- `success_signals`
- `minimum_replay`
- `artifact_log_ref`
- `failure_reason`
- `blocker_level`

补充约束：

- `execution_surface=real_browser` 才可能成为有效 live evidence
- `run_id`、`evidence_collected_at`、`artifact_identity` 与 `artifact_log_ref` 必须能共同指向当前 latest head 的这次 fresh rerun，而不是同一 head 下的历史 artifact
- reviewer / guardian 必须以 PR 描述中的 `live_evidence_record` 作为 latest-head 门禁输入；仓库 formal 文档中的固定样本、历史失败事实或已固化 run 记录，只要未被误写成当前 latest-head gate evidence，就不得被要求逐提交追写当前 PR head SHA
- 成功态必须把 `failure_reason` 与 `blocker_level` 填为 `N/A`
- 失败或阻断态必须显式填写失败原因与阻断层级

若上述元数据缺失、失效或边界不符，该 PR 只能保持 `Refs #...` 与非 `merge-ready` 状态，不得按真实闭环完成申报。

补充说明：

- `governance_landing_pr` 在 formal spec review 通过前必须保持 blocked；不得因为 live evidence 对该 lane 不适用，就把 `spec_review_not_completed` 降格成 `not_applicable`
- formal spec review PR 与治理落库 PR 的 split 是强约束；一旦 FR-0016 正式契约或 `docs/dev/specs/FR-0016-live-evidence-governance-gate/TODO.md` 回写与治理落库文件同 PR 出现，必须先拆分再继续

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

### FR 类型与套件深度

- Spike FR
  - 目标：冻结证据边界、准入条件、handoff 对象与 Go/No-Go 判断
  - 最低要求：`spec.md`、`plan.md`、`TODO.md`
  - `plan.md` 应重点回答证据目标、收集路径、准入条件、风险边界与下一事项输入，不要求伪装成完整实施拆分
- 标准 FR
  - 目标：定义一个边界清楚、风险可控、可直接进入实现的正式事项
  - 最低要求：`spec.md`、`plan.md`、`TODO.md`
  - `plan.md` 默认按 7 节组织
- 高风险 FR
  - 目标：承载共享契约、共享数据模型、架构边界或高风险执行链路变更
  - 最低要求：标准 FR + 按触发条件补齐 `contracts/`、`data-model.md`、`research.md`、`risks.md`
  - 默认采用独立 spec review PR 与实现 PR

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
