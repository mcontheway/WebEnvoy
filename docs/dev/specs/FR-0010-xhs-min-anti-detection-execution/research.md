# FR-0010 研究记录（最小反风控执行能力）

## Spike Charter

- Decision question：在 `FR-0009` 门禁规约之后，哪些最小执行能力必须在 Sprint 3 落地，才能安全恢复后续有限 live。
- Timebox：FR-0010 spec review 前完成规约收口，不做实现代码。
- Primary unknowns：
  - U1：插件层门禁主落点如何定义为可实施对象，而非口号
  - U2：读路径模式收敛的最小规则边界是什么
  - U3：写路径交互分级如何避免误放行
  - U4：最小 session 节律/冷却/恢复是否能形成稳定状态机

## 当前基线

- 已完成：`FR-0009`（`#214`）合并，风险门禁规约已冻结。
- 未完成：门禁执行能力尚未进入正式实现 FR。
- 风险前置：`#208` 仍待完成，`#209` 后续 live 扩展需受同一门禁。

## 证据矩阵

| ID | Claim/Unknown | Evidence Artifact | Method | Maturity | Confidence | Notes |
|---|---|---|---|---|---|---|
| U1 | 插件层应为门禁主落点 | `FR-0009` research/spec + extension 执行链现状 | 架构对齐审查 | M2 | 90% | CLI 只做壳更符合当前实现现实 |
| U2 | 读路径需要默认 dry_run/recon | `FR-0009` gate 契约、风险预警上下文 | 风险约束审查 | M2 | 85% | 防止继续扩张 live 面 |
| U3 | 写路径需动作分级和默认阻断 | `FR-0008` write spike 风险结论 | 规约交叉审查 | M2 | 88% | 合成事件与上传注入不可默认 live |
| U4 | 最小状态机可先做三态 | `FR-0009` states 基线 + anti-detection 分层 | 可实施性评估 | M1 | 75% | 高阶行为模型后续阶段补齐 |

## Gap 清单（从 FR-0009 到 FR-0010）

| 维度 | FR-0009 已冻结 | FR-0010 需补齐 |
|---|---|---|
| 门禁目标 | 风险对象与门禁前置 | 插件层可实施责任划分 |
| 执行模式 | 默认停高风险 live | 读/写模式规则与动作分级对象 |
| 风险状态 | `paused/limited/allowed` 原则 | 状态机迁移条件与硬阻断对象 |
| 恢复策略 | “需审查后恢复”原则 | 冷却窗口与恢复探测模式最小定义 |

## Gate Status

- Fallback viability：PASS
  - 可在规约层完成门禁能力最小定义，不依赖新增 live 实验。
- Implementation readiness：BLOCKED
  - 仅完成规约，尚未进入实现与测试阶段。

## 决策

- Outcome：Continue at spec layer, then implementation FR
- Rationale：
  - 当前最优先是把门禁能力定义到可实现、可测试、可审查，再进入实现。
  - 避免 `#208/#209` 在无执行能力前置下恢复 live。
- Effective date：2026-03-22
