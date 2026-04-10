# FR-0012 研究记录（Layer 1 JS 指纹补全与 profile 一致性）

## Spike Charter

- Decision question：在 `FR-0010/0011` 已冻结最小门禁与状态机前置后，`#235` 需要把哪些 Layer 1 能力冻结为 Phase 2 的正式实现输入。
- Timebox：FR-0012 spec review 前完成规约收口，不写实现代码。
- Primary unknowns：
  - U1：Layer 1 中哪些补丁属于应尽早落地的 Phase 2 范围
  - U2：哪些 profile 元数据字段必须升级为稳定机器边界
  - U3：Layer 1 如何继承而不重定义 `FR-0010/0011`
  - U4：环境绑定失配应如何表述为正式约束
  - U5：哪些能力边界必须显式保留为“不承诺”

## 当前基线

- 已完成前置：
  - `FR-0010`：门禁、审批、审计对象已冻结
  - `FR-0011`：插件层门禁主落点、最小节律、三态状态机已冻结
- roadmap 现状：
  - Phase 2 明确承接 Layer 1/2/3 的反风控延续建设
- 当前 Layer 1 owning Work Item 已被明确映射到 FR-0012 主树下
- 架构现状：
  - `anti-detection.md` 已列出 Layer 1 已有/待实现矩阵
  - `account.md` 已确认 `__webenvoy_meta.json` 可承载指纹种子等最小元数据

## 证据矩阵

| ID | Claim/Unknown | Evidence Artifact | Method | Maturity | Confidence | Notes |
|---|---|---|---|---|---|---|
| U1 | Layer 1 owning Work Item 属于 Phase 2 -> FR-0012 主树，而非独立结构父级 | `roadmap.md`、GitHub parent/FR/Work Item 页面 | roadmap/issue 对齐审查 | M2 | 94% | 已在 roadmap 与 issue 中双重确认 |
| U2 | Layer 1 必须先冻结 profile 级指纹包 | `anti-detection.md` §2.3、`account.md` §7.1 | 架构约束审查 | M2 | 92% | 否则补丁字段会散落在实现细节里 |
| U3 | Layer 1 不能重定义 gate/status 对象 | `FR-0010`、`FR-0011` | 上游 FR 审查 | M2 | 95% | 门禁与状态机已在 Sprint 2/3 冻结 |
| U4 | profile 与运行环境强绑定必须进入正式规约 | `anti-detection.md` §2.3 | 风险边界审查 | M2 | 90% | 跨 OS/架构迁移会造成指纹突变 |
| U5 | Worker 线程盲区必须显式作为非目标保留 | `anti-detection.md` §2.1 | 架构硬边界审查 | M2 | 97% | JS 层无法彻底覆盖 Worker 采集 |

## 范围收敛结论

### 当前 FR 的正式承诺

- P0：
  - `AudioContext`
  - Battery API
  - `navigator.plugins`
  - `navigator.mimeTypes`
  - profile 指纹种子/一致性字段持久化与启动加载
- P1：
  - `hardwareConcurrency`
  - `deviceMemory`
  - `screen.colorDepth`
  - `screen.pixelDepth`
  - `performance.memory`
- P2：
  - `Permissions API`
  - `navigator.connection`

### 当前 FR 明确不承诺

- Worker 线程指纹覆盖
- Layer 2 鼠标/键盘/滚动拟人增强
- Layer 3 完整 session 节律引擎
- Layer 4 平台行为模型
- Camoufox/C++ 内核级补丁

## Gate Status

- Fallback viability：PASS
  - 即便 Layer 1 的部分补丁尚未实现，也可以先以规约冻结正式字段和优先级切片，避免继续散落在架构文档中。
- Implementation readiness：PASS
  - 对于后续实现 PR，P0 切片已具备足够明确的范围、字段与边界。
- Full-scope completion：BLOCKED
  - P1/P2 可在后续实现切片继续推进，FR-0012 当前不要求单个实现 PR 一次性交付全量补丁。

## 决策

- Outcome：Continue to implementation-ready spec
- Rationale：
  - `#235` 已达到 `spec-ready`，不再需要继续停留在“架构蓝图但无正式 FR”的状态。
  - Layer 1 的核心风险不在于“有没有补丁想法”，而在于 profile 字段和环境绑定没有冻结，导致实现容易口径漂移。
  - 把 Worker 盲区和非目标显式写清，可以降低实现阶段的过度承诺风险。
- Effective date：2026-03-24
