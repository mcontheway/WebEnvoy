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
- PR `#311`
  - 已回写四处治理文档，但尚未同步 `docs/dev/review/guardian-review-addendum.md`，且最新 review 仍阻断。
- review 轨迹
  - 第一轮指出触发条件不一致
  - 第二轮指出最低字段缺少 `latest_head_sha` 与 `execution_surface`
  - #322 第一轮 guardian 又指出 contract 兼容规则不能只保护这两个核心字段，必须把已冻结最低字段全集都设为不可删减
  - 最新一轮明确指出：高风险治理基线变更缺 formal spec review

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

## 证据矩阵

| ID | Claim/Unknown | Evidence Artifact | Method | Maturity | Confidence | Notes |
|---|---|---|---|---|---|---|
| U1 | 专项门禁必须覆盖“以 live evidence 请求 merge 放行”的场景 | `#311` 前两轮 review + 现有文档回写 | review diff 对照 | M3 | 95% | 已有 reviewer 明确阻断过一次 |
| U2 | `live_evidence_record` 已冻结字段全集都必须保持必填且不可删减，`latest_head_sha` 与 `execution_surface` 是其中两个关键复核字段 | `#311` 第三轮 review + `#322` guardian review | review blocker 对照 | M3 | 98% | 只保护两个字段会把 `profile/run_id/page_url/minimum_replay/artifact_log_ref` 等字段降成可删项 |
| U3 | `#310` 需要 formal spec review | `#311` 最新 review + `spec_review.md` | 流程基线对照 | M3 | 99% | 已是当前唯一 blocker |
| U4 | formal spec review PR 与治理落库 PR 必须拆开 | `docs/dev/AGENTS.md` + `spec_review.md` + `#311` 最新 guardian/review blocker | 高风险事项规则对照 | M3 | 99% | 对 `#310 / FR-0016` 已冻结为必须拆分，不再保留 reviewer 例外口径 |

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
