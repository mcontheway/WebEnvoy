# FR-0008 研究记录（正式输入）

## Spike Charter

- Decision question: 小红书最小写链路目前能冻结到什么程度，哪些结论只应作为 `#208` 的候选输入而非正式验证结论。
- Timebox: FR-0008 spec review 前完成规约收口；live 证据采样留待后续独立复核。
- Primary unknowns:
  - U1：富文本编辑器的真实焦点/输入链路是否必须依赖合成 `CompositionEvent`
  - U2：图片上传主路径是页面文件注入、拖拽，还是独立上传 API
  - U3：哪一种最小页面交互动作最适合作为 `#208` 的正式验证候选
  - U4：页面主路径失败时，能否保留安全的 fallback 或 candidate 输入而不误导实现准入
- Candidate options:
  - O1：以富文本“聚焦并输入少量文本”作为 `#208` 候选输入
  - O2：以“选择一张图片并触发上传预览”作为 `#208` 候选输入
  - O3：继续仅保持研究状态，等待更充分 live 证据后再交给 `#208`
- Non-goals:
  - 不证明完整发布闭环
  - 不在本文件内直接冻结 Phase 1 出站结论
  - 不给出实现代码
- Exit trigger: 能清楚说明写链路侦察输入的结构、双门禁和给 `#208` 的 handoff 对象。

## 当前已知基线

### 仓库内正式与参考基线

- `docs/dev/architecture/system-design/read-write.md`
  - 已冻结富文本输入优先使用真实物理点击/键入，必要时回退到 `CompositionEvent` / `InputEvent` 链。
  - 已冻结文件上传的 `DataTransfer` 注入方案，以及“独立上传 API”作为降级方向。
- `docs/dev/architecture/system-design/reference.md`
  - 已把“Spike A-Write：小红书最小写链路与上传路径确认”列为正式待办。
- `docs/archive/tech-selection-preresearch.md`
  - 提供富文本编辑器与媒体上传的历史候选路径，但它只是研究背景，不是正式结论。
- `docs/research/ref/MultiPost-Extension_analysis.md`
  - 提供 DataTransfer 与高频 `change/input` 事件的参考经验，可作为候选假设来源。

## 证据矩阵

> 当前轮次仅冻结仓库内可复核基线与待验证假设；live 浏览器第一手证据尚未并入本文件。

| ID | Claim/Unknown | Evidence Artifact | Method | Repeatability | Scope Limits | Impact If Wrong | Maturity | Confidence | Notes |
|----|---------------|-------------------|--------|---------------|--------------|-----------------|----------|------------|-------|
| U1 | 富文本输入可能需要“真实 focus + 合成输入链”混合路径 | `docs/dev/architecture/system-design/read-write.md §5.1` | 架构基线对齐 | repo-stable | 仍缺小红书发布页第一手样本 | 若错误，`#208` 会选错最小交互动作 | M0 | 45% | 当前只能作为候选输入，不是正式验证 |
| U2 | 图片上传可能优先走 `DataTransfer` 注入，失败时再考虑 API fallback | `docs/dev/architecture/system-design/read-write.md §5.2` | 架构基线对齐 | repo-stable | 缺小红书页面入口类型确认 | 若错误，后续实现会走错主路径 | M0 | 40% | 需区分标准 input、拖拽区和独立上传 API |
| U3 | `#146` 应输出一组供 `#208` 选择的候选动作，而不是自己完成正式验证 | `#146` / `#208` issue 描述、`docs/dev/roadmap.md` | issue 与 roadmap 对齐 | repo-stable | 需要后续评审确认候选动作是否足够收敛 | 若错误，会再次混淆 Spike 与阶段出口 | M2 | 85% | 这是当前轮次最清晰的正式边界 |
| U4 | fallback viability 与 implementation readiness 必须分开记录 | `docs/dev/AGENTS.md`、skill: `evidence-driven-spike` | 治理与方法约束对齐 | repo-stable | 仍需 live 证据填充具体状态 | 若错误，会把降级样本误写成可实现结论 | M2 | 90% | 已体现在本 FR 套件结构中 |

## Gate Status

- Fallback viability: BLOCKED
  - Trigger defined: 是。页面主路径失败、账号风险放大、上传入口不稳定时，允许保留 `api fallback` 或 `candidate` 证据作为连续性输入。
  - Safe degraded behavior validated: 否。当前只在规约层面明确了降级表达，还未完成 live 页面验证。
  - Rollback/recovery validated: 部分。已明确“停止 live 侦察并冻结证据”是优先回滚动作。
  - Blocking reason: 缺少浏览器内第一手证据，当前只能证明“fallback 应如何表达”，不能证明“fallback 已经可安全使用”。
- Implementation readiness: BLOCKED
  - Critical unknowns at required maturity: 否。富文本输入、上传入口类型、最小交互动作都缺第一手多轮复核。
  - Scope/interfaces stable: 是。FR 边界、handoff 对象与双门禁结构已稳定。
  - Risks owned and mitigated: 部分。风险已识别，但尚需 live 证据降低不确定性。

## 决策

- Outcome: Continue spike
- Rationale:
  - `#146` 已可以进入正式 spec review，作为侦察输入 FR 成立。
  - 但当前只能证明“该 Spike 应该如何被约束和消费”，还不能证明“最小写链路已达到实现或阶段验证准入”。
- Effective date: 2026-03-21
- Decision owner: 当前规约 PR

## 未决项

| ID | Item | Why Unresolved | Impact If Wrong | Deadline | Owner | Next Evidence Action | Guardrail |
|----|------|----------------|-----------------|----------|-------|----------------------|----------|
| Q1 | 富文本事件链最小可行路径 | 缺浏览器内第一手样本 | `#208` 可能选错最小动作 | 进入 `#208` spec review 前 | 后续侦察链路 | 在真实页面复核 focus/input/change/blur 链 | 未复核前仅标 candidate |
| Q2 | 图片上传入口类型 | 缺页面 DOM 与上传反馈样本 | 后续实现主路径会漂移 | 写能力实现 FR 起草前 | 后续侦察链路 | 识别标准 input、拖拽区或上传 API | 失败样本必须保留 |
| Q3 | `#208` 最小交互动作最终选择 | `#146` 只提供候选，不做正式判定 | Phase 1 blocker 继续悬空 | `#208` 正式立项时 | `#208` 链路 | 从 FR-0008 handoff 中选择单一动作 | 不得把完整发布混入 |

## 风险摘要

- 当前最常见误判不是“没找到路径”，而是把研究性候选路径提前包装成 Phase 1 正式验证结论。
- 本 FR 的价值在于先冻结边界、对象和门禁，降低后续 `#208` 和写能力实现 FR 的范围漂移风险。
