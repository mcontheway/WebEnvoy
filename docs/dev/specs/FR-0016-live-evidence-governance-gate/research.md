# FR-0016 研究记录（真实 Live Evidence 治理门禁）

## Spike Charter

- Decision question：`#310` 是否已经具备进入治理落库的正式输入，还是仍缺 formal spec review？
- Timebox：在 `#311` 合并前完成 formal 边界判断与套件冻结。
- Primary unknowns：
  - U1：当前专项门禁到底覆盖哪一类 PR，是否包含“以 live evidence 请求 merge 放行”的场景
  - U2：reviewer / guardian 最低必填字段中，哪些字段必须作为不可删减的完整字段集冻结，才能支撑 latest head、真实执行面、最小复现路径与 artifact 复核
  - U3：`#310` 这类高风险治理基线变更是否允许绕过 formal spec review 直接落库
  - U4：formal spec review PR 与治理落库 PR 是否必须拆开
- Candidate options：
  - O1：继续在 `#311` 里补文案，尝试一次性放行
  - O2：先为 `#310` 建立正式 FR 套件并完成 spec review，再单独推进治理落库
  - O3：把 `#310` 降格为轻量文档事项处理

## 当前输入

- Issue `#310`
  - 目标是冻结 live evidence 专项门禁，不承接 runtime 实现。
- Issue `#455`
  - 目标是修复 FR-0016 在 docs-only governance maintenance / live-evidence closeout 场景下的自指阻断。
- PR `#311`
  - 已回写四处治理文档，但尚未同步 `docs/dev/review/guardian-review-addendum.md`，且最新 review 仍阻断。
- PR `#454`
  - 作为 FR-0005 docs-only live-evidence closeout 现场，已稳定暴露“仓库 formal 文档被错误要求逐提交追写当前 PR head SHA”的治理阻断。
- review 轨迹
  - 第一轮指出触发条件不一致
  - 第二轮指出最低字段缺少 `latest_head_sha` 与 `execution_surface`
  - #322 第一轮 guardian 又指出 contract 兼容规则不能只保护这两个核心字段，必须把已冻结最低字段全集都设为不可删减
  - #322 最新 guardian 又指出：仅靠 `latest_head_sha` + 自由文本 `artifact_log_ref` 仍无法区分“当前 head fresh rerun”和“同一 head 的历史 artifact”
  - #322 最新 guardian 还指出：`spec_review_not_completed` 需要 contract 内部可机器判定的治理落库 lane，不能靠 PR 标题或路径猜测
  - #322 最新 guardian 继续指出：若 PR 侧元数据没有显式承载 `gate_applicability`，治理落库 PR 仍会被迫回退到标题/路径 heuristics
  - #322 最新 guardian 还指出：若把 `gate_applicability` 变成所有 reviewed PR 的硬要求，就会把专项门禁扩成 repo-wide 元数据；同时 `editor_locator` 过于 write-path-specific
  - #322 最新 guardian 继续指出：仅靠作者自报 `review_lane` 仍可让治理落库 PR 伪装成 `general_pr`，需要冻结可校验的 `governance_scope_targets`
  - #322 最新 guardian 继续指出：formal spec review PR 与治理落库目标文件重新混线时缺少结构化 blocker，且 formal spec lane 仍需禁止 `Fixes`
  - #322 最新 guardian 继续指出：lane 判定仍需独立于作者自报元数据存在；formal spec lane 也必须强制 `Refs`，不能退成 `n_a`
  - #322 最新 guardian 继续指出：若只按五个治理文件路径命中就判成 `governance_landing_pr`，会把未来无关治理修订误吸进 FR-0016 专项门禁
  - #322 最新 guardian 继续指出：mixed-scope blocker 不能直接覆盖整个 spec 套件目录；FR-0016 `TODO.md` 需要与正式契约文件分开建模
  - #322 最新 guardian 继续指出：formal spec lane 也需要排除纯 `TODO.md` 命中；governance landing lane 还必须要求完整五文件集合，不能被部分落库 PR 提前占用
  - #322 最新 guardian 继续指出：仍需把 `gate_applicability` 缺失显式建模为 blocker；治理落库线还要要求精确五文件范围，不能夹带其他实质性改动
  - #322 最新 guardian 继续指出：精确命中五个治理落库目标文件时，必须有结构化 issue 引用与 blocker，不能退回普通 PR
  - #322 最新 guardian 继续指出：`governance_landing_pr` 即使是 `not_applicable` 也不能允许 `n_a` closing semantics，必须保留 `Refs/Fixes #310`
  - #322 最新 guardian 继续指出：若带 `#310` 上下文的治理落库 PR 只命中目标文件子集，或在五文件之外扩 scope，也必须显式 blocked，不能退回 `general_pr`
  - #322 最新 guardian 继续指出：formal spec PR 只要触碰任一治理落库目标文件，也必须立刻 mixed-scope blocked，不能等到完整 landing 形态才阻断
  - #322 最新 guardian 继续指出：formal spec lane 即使 `status=ready` 也必须保持 `Refs`；FR-0016 `TODO.md` 若继续作为治理落库同行例外，会回到不可机判的启发式争议
  - 最新一轮明确指出：高风险治理基线变更缺 formal spec review
  - `#454` 最新 guardian 继续要求 formal 文档把 latest-head 证据 SHA 与当前 PR head 对齐，形成“每补一次 SHA，PR head 又前移”的自指阻断

## 证据梳理

### E1：事项本体已经超出轻量文档修改

- 来源：
  - `#310` issue 描述
  - `AGENTS.md`
  - `docs/dev/AGENTS.md`
- 观察：
  - 变更会直接新增关闭语义限制、review 阻断条件与 merge 放行条件。
  - 根级规范与开发区规范都把这类事项归入高风险治理基线。
- 结论：
  - O3 不成立，`#310` 不能按轻量文档事项处理。

### E2：当前 blocker 不是“文案没对齐”，而是“formal 输入缺失”

- 来源：
  - PR `#311` 最新 review on commit `0227c64a11d58660cff87d153c79648b87664bff`
- 观察：
  - review 明确要求“先完成 #310 的正式规约与 spec review，再落库新的 live evidence 门禁”。
  - 此时前两轮提出的文档一致性与字段缺失问题已经修正。
- 结论：
  - O1 已不再是主路径，继续只修文案不能消除 blocker。

### E3：shared contract 已经客观存在

- 来源：
  - `AGENTS.md`
  - `docs/dev/AGENTS.md`
  - `code_review.md`
  - `docs/dev/review/guardian-review-addendum.md`
  - `.github/PULL_REQUEST_TEMPLATE.md`
- 观察：
  - 这五处文档/提示共同定义了同一组输入与判定对象：
    - 适用范围
    - 最低 live evidence 字段
    - reviewer / guardian 阻断规则
    - `Fixes` / `Refs` / `merge-ready`
  - `scripts/pr-guardian.sh` 会把 `docs/dev/review/guardian-review-addendum.md` 注入 review prompt，因此后续治理落库 PR 若漏改该文件，guardian 会继续使用旧摘要口径。
- 结论：
  - `#310` 不只是文案说明，而是跨载体共享契约，FR 套件中应补 `contracts/`。

### E4：formal spec review PR 与治理落库 PR 混写会继续触发流程争议

- 来源：
  - `AGENTS.md`
  - `docs/dev/AGENTS.md`
  - `spec_review.md`
- 观察：
  - 高风险 FR 默认要求独立 spec review PR 与实现 PR。
  - formal spec review 的职责是冻结边界，不是直接落治理变更。
- 结论：
  - O2 是当前唯一与仓库流程一致的路径。

### E5：docs-only closeout PR 的 latest-head 门禁与仓库固定样本缺少职责分层

- 来源：
  - PR `#454`
  - PR comment `https://github.com/MC-and-his-Agents/WebEnvoy/pull/454#issuecomment-4228338350`
- 观察：
  - PR 描述已经提供 current latest-head 的 `live_evidence_record`，但 guardian 仍持续要求把同一 SHA 追写进仓库 formal 文档。
  - 只要为追 head 再提交一次文档修正，PR head 就会继续前移，导致同一要求再次出现，无法在普通提交流程中稳定收敛。
  - 当前 formal contract 虽然冻结了 PR 级 `live_evidence_record`，但没有明确声明“latest-head gate evidence 只以 PR 元数据为准，仓库固定样本不需要逐提交追 head”。
- 结论：
  - FR-0016 需要补上 PR 级 gate evidence 与仓库固定样本的职责分层；否则 docs-only closeout PR 会继续落入自指阻断。

## 证据矩阵

| ID | Claim/Unknown | Evidence Artifact | Method | Maturity | Confidence | Notes |
|---|---|---|---|---|---|---|
| U1 | 专项门禁必须覆盖“以 live evidence 请求 merge 放行”的场景 | `#311` 前两轮 review + 现有文档回写 | review diff 对照 | M3 | 95% | 已有 reviewer 明确阻断过一次 |
| U2 | `live_evidence_record` 已冻结字段全集都必须保持必填且不可删减，并且必须包含足以区分同一 head 下 fresh rerun 与历史 artifact 的 freshness / artifact identity 字段 | `#311` 第三轮 review + `#322` guardian review | review blocker 对照 | M3 | 98% | 只保护两个字段会把 `profile/run_id/page_url/minimum_replay/artifact_log_ref` 等字段降成可删项；缺少 freshness / artifact identity 字段则无法挡住 same-head stale artifact |
| U3 | `#310` 需要 formal spec review | `#311` 最新 review + `spec_review.md` | 流程基线对照 | M3 | 99% | 已是当前唯一 blocker |
| U4 | formal spec review PR 与治理落库 PR 必须拆开 | `docs/dev/AGENTS.md` + `spec_review.md` + `#311` 最新 guardian/review blocker | 高风险事项规则对照 | M3 | 99% | 对 `#310 / FR-0016` 已冻结为必须拆分，不再保留 reviewer 例外口径 |
| U5 | `spec_review_not_completed` 只能通过 contract 内部结构化 lane 对治理落库 PR 触发，不能依赖外部 heuristics | `#322` guardian review | review blocker 对照 | M3 | 95% | 若不冻结 lane，未来 reviewer / guardian 会各自用标题、路径或人工上下文猜测治理落库身份 |
| U6 | `gate_applicability` 必须作为 PR 侧结构化元数据显式承载，即使 `live_evidence_record` 为 `N/A` 也不能省略 | `#322` guardian review | review blocker 对照 | M3 | 95% | 若只冻结 `live_evidence_record`，治理落库 PR 仍无法机器化表达 `review_lane/in_scope` |
| U7 | `gate_applicability` 的显式承载范围必须限制在专项门禁 PR、formal spec review PR、governance landing PR 与 governance maintenance PR，不能扩成 repo-wide PR 元数据 | `#322` guardian review | review blocker 对照 | M3 | 95% | 若要求所有 reviewed PR 都携带该对象，就违背“专项门禁而非全仓统一门禁”的非目标 |
| U8 | `governance_landing_pr` 必须通过 `governance_scope_targets` 与实际变更目标文件共同校验，不能只靠作者自报 `review_lane` | `#322` guardian review | review blocker 对照 | M3 | 95% | 若没有结构化目标文件集合，治理落库 lane 仍可被自报 `general_pr` 绕过 |
| U9 | formal spec review PR 与治理落库文件重新混线时必须有结构化 blocker，且 formal spec lane 即使 `ready` 也不得使用 `Fixes` | `#322` guardian review | review blocker 对照 | M3 | 95% | 若缺少 `mixed_spec_and_governance_scope` 与 lane-specific closing semantics，split 规则仍会被实现层绕过 |
| U10 | lane 判定必须先消费独立的 `classification_scope`，且 formal spec lane 必须强制 `Refs` 而不是 `n_a` | `#322` guardian review | review blocker 对照 | M3 | 95% | 若仍要先相信作者自报 `review_lane`，或允许 formal spec lane 走 `n_a`，就会继续和仓库 merge 元数据基线冲突 |
| U11 | `governance_landing_pr` 判定不能只靠五个治理目标文件路径命中；还必须同时命中 FR-0016 的 `#310` issue 上下文 | `#322` guardian review | review blocker 对照 | M3 | 95% | 若仅按路径命中分类，就会把未来其他治理文案修订误吸进 FR-0016 专项门禁，违背“非 repo-wide 门禁”的非目标 |
| U12 | `mixed_spec_and_governance_scope` 不能直接覆盖整个 spec 套件目录；FR-0016 `TODO.md` 必须作为独立 handoff 文件建模，而不是隐式治理例外 | `#322` guardian review | review blocker 对照 | M3 | 90% | 若把整个 spec 目录都算进 mixed-scope blocker，或继续让 `TODO.md` 以启发式方式同行，后续治理落库 PR 仍会在误伤与绕过之间摇摆 |
| U13 | `formal_spec_review_pr` 也必须只由 `spec_contract_targets` 触发，且 `governance_landing_pr` 必须要求完整五文件集合并排除 FR-0016 `TODO.md` | `#322` guardian review | review blocker 对照 | M3 | 95% | 若 formal spec lane 仍吃进纯 `TODO.md`，或治理落库 lane 继续容忍 `TODO.md` / 部分文件子集同行，后续合规 PR 仍会被误判或提前关闭 `#310` |
| U14 | 缺失必需 `gate_applicability` 元数据必须显式 blocked，且治理落库线必须是精确五文件范围 | `#322` guardian review | review blocker 对照 | M3 | 95% | 若缺少结构化 blocker 与精确范围约束，reviewer/guardian 仍可靠启发式放行缺失元数据或夹带改动的 PR |
| U15 | 精确命中五个治理落库目标文件时，必须提供结构化治理 issue 引用；缺失时必须有 blocker | `#322` guardian review | review blocker 对照 | M3 | 95% | 若缺少这一 blocker，治理落库或治理维护 PR 仍可能绕开 `spec_review_not_completed` 与 metadata 门禁 |
| U16 | `governance_landing_pr` 即使 `not_applicable`，closing semantics 也必须保留 `Refs/Fixes #310`，不得使用 `n_a` | `#322` guardian review | review blocker 对照 | M3 | 95% | 若允许 `n_a`，治理落库 PR 仍可绕开仓库要求的 issue closing metadata |
| U17 | 带 `#310` 上下文的治理落库尝试若只命中目标文件子集，或在五文件之外扩 scope，也必须显式 blocked | `#322` guardian review | review blocker 对照 | M3 | 95% | 若只对“精确五文件”建模，子集/超集治理改动仍可绕开 `spec_review_not_completed` 与 metadata 门禁 |
| U18 | formal spec PR 只要触碰任一治理落库目标文件，就必须立即触发 `mixed_spec_and_governance_scope` | `#322` guardian review | review blocker 对照 | M3 | 95% | 若 mixed-scope 只在完整 landing 形态才触发，spec PR 仍可顺手塞入单个治理文件改动而绕开 split 规则 |
| U19 | docs-only closeout PR 的 latest-head gate evidence 必须以 PR 描述中的 `live_evidence_record` 为准，仓库 formal 文档中的固定样本不得被要求逐提交追写当前 PR head | `#454` guardian review + `#454` 阻断说明 comment | blocked 现场对照 | M3 | 95% | 若不冻结这一分层，formal closeout PR 会因追 head 形成自指死锁 |

## Gate Status

- Fallback viability：PASS
  - 当前可以先补 formal FR 套件，而不必继续扩写治理落库文案。
- Implementation readiness：BLOCKED
  - `#310` 缺 formal spec review 前，`#311` 不应继续申报可合并。

## 决策

- Outcome：Adopt O2
- Rationale：
  - 现有 blocker 已从“文案不一致”升级为“formal 输入缺失”。
  - 继续在 `#311` 中补文案不会消除高风险治理基线的流程缺口。
  - 先冻结 FR-0016，后续治理落库 PR 才有可引用的正式输入。
- Effective date：2026-04-01
