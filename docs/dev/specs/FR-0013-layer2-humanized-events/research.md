# FR-0013 研究记录（Layer 2 事件级拟人模拟增强）

## 研究问题

- Q1：Layer 2 应在 Phase 2 被定义成什么，才不会与 `FR-0011` 或未来 Layer 3/4 重叠。
- Q2：事件级增强是否已经形成稳定机器边界，足以创建 `contracts/`。
- Q3：是否需要独立 `data-model.md`，以及哪些对象应继承 `FR-0011` 而不是重定义。

## 当前基线

- `docs/dev/roadmap.md`
  - 已明确 Phase 2 会继续承接最小前置之外的反风控延续建设，且显式包含 Layer 2 事件级拟人模拟增强。
- `docs/dev/architecture/anti-detection.md`
  - 已给出 Layer 2 的核心能力面：真实/合成交互差异、鼠标/键盘/滚动的人类特征、悬停、误点与回头翻看。
- `docs/dev/architecture/system-design/read-write.md`
  - 已冻结真实 focus、合成输入链、状态收敛等待、输入/上传等具体交互语义。
- `docs/dev/architecture/system-design/execution.md`
  - 已冻结 CDP Input 与 JS 合成路径在 `isTrusted` 上的本质差异。
- `FR-0011`
  - 已冻结最小门禁、写路径动作分级、最小 session 节律和共享状态机，是 FR-0013 的前置而不是并列替代品。

## 证据矩阵

| ID | Claim | Evidence Artifact | Method | Maturity | Confidence | Notes |
|----|-------|-------------------|--------|----------|------------|-------|
| C1 | Layer 2 属于 Phase 2 的延续反风控主线 | `docs/dev/roadmap.md`、`#233` | 路线图与 issue 对齐 | M2 | 95% | 不是 Sprint 3 的回写，也不是后层扩展 |
| C2 | `FR-0011` 只冻结最小写路径分级与阻断边界 | `FR-0011/spec.md` | 套件边界审查 | M2 | 95% | 其重点是门禁与状态机，不是完整事件模拟 |
| C3 | Layer 2 已形成稳定对象，值得创建 `contracts/` | `anti-detection.md`、`read-write.md`、`execution.md` | 架构边界审查 | M2 | 88% | 事件策略、事件链、节奏配置会被多个模块共享 |
| C4 | FR-0013 需要独立 `data-model.md` 说明共享实体语义 | `spec_review.md`、`FR-0011/data-model.md` | 套件深度对齐 | M2 | 82% | 虽非持久化 schema，但属于跨模块共享对象 |
| C5 | Layer 2 的主要风险是越界到 Layer 3 或绕过 FR-0011 门禁 | `anti-detection.md`、`FR-0011/spec.md`、`#236` | 架构与治理交叉审查 | M2 | 93% | 是 reviewer 最可能阻断的方向 |

## 结论

- `contracts/`：需要。
  - 原因：事件策略、事件链与策略选择结果会被读路径、写路径、平台覆盖和后续测试共同依赖，已形成稳定机器边界。
- `data-model.md`：需要。
  - 原因：虽不新增持久化 schema，但需要明确共享实体的字段语义、继承关系和生命周期，避免实现阶段再次平行造型。
- 继承原则：
  - `FR-0013` 不并行重定义 `FR-0011` 的门禁与状态机对象。
  - `FR-0013` 只新增 Layer 2 的事件策略对象，并在字段级显式引用 `FR-0011` 的结果对象。

## 未决项

| ID | Item | Why Unresolved | Impact If Wrong | Next Action |
|----|------|----------------|-----------------|-------------|
| U1 | 平台覆盖值的粒度是否按 action 还是按 component 定义 | 当前只冻结通用边界，未进入实现 | 覆盖模型过粗或过细都会增加实现返工 | 在实现 PR 中基于本 FR 的默认对象再细化 |
| U2 | 滚动与页面预热的默认参数范围 | 当前规约只冻结能力边界，不冻结最终参数 | 参数过激可能被平台探针放大 | 在实现 PR 中通过测试与受控验证收敛 |
| U3 | 混合路径的最小 trace 字段是否还需扩展 | 当前先冻结最小必需字段 | 诊断不足会影响回归定位 | 实现评审时依据测试样本决定是否加字段 |

## 决策

- Outcome：Proceed as implementation-ready spec input
- Rationale：
  - 范围、依赖、继承边界与稳定对象已经足够清楚，适合先以独立 spec review PR 冻结。
  - 真正的未知点主要在参数调优，而不在边界定义本身，不阻塞建立正式 FR 套件。
- Effective date：2026-03-24
