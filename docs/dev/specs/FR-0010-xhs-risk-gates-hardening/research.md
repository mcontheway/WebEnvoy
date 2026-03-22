# FR-0010 研究记录（风险门禁与执行硬化）

## Spike Charter

- Decision question：在不交付新平台业务能力的前提下，Sprint 2 应先落哪一批执行硬门禁，才能让后续 `#208/#209` live 扩展进入可控状态。
- Timebox：FR-0010 spec review 前完成规约收口；实现细节在 Sprint 2 实施阶段落地。
- Primary unknowns：
  - U1：目标域/目标页确认应在 CLI 层、插件层还是两层同时生效。
  - U2：默认 `dry_run/recon` 与 live 升级之间的最小可执行状态机是什么。
  - U3：`#208` 与 `#209` 如何共享一套门禁而不互相污染边界。
  - U4：审计记录最小字段集怎样定义才足够复盘与回滚。

## 当前基线

- `FR-0009` 已冻结门禁规约方向，但尚未进入实现。
- `#208` 仍未完成，`#209` 已落地但后续 live 扩展未受硬门禁约束。
- 仓库架构已明确读写域分离与行为层风险，但当前主线尚未将其变成执行前硬检查。

## 证据矩阵

| ID | Claim/Unknown | Evidence Artifact | Method | Maturity | Confidence | Notes |
|---|---|---|---|---|---|---|
| U1 | 门禁必须覆盖插件执行层而非仅 CLI 参数层 | `extension/background.ts` + `FR-0009 research` | 代码路径审查 | M2 | 85% | 自动选页行为在插件层发生 |
| U2 | 默认非 live 才能避免继续放大风险面 | `FR-0009 spec/contracts` | 规约一致性审查 | M2 | 90% | 作为 Sprint 2 实施前置 |
| U3 | `#208/#209` 应共享同一门禁模型 | `#208/#209/#213/#220` issue 关系 | 依赖关系审查 | M2 | 88% | 防止单事项绕过 |
| U4 | 审计字段需能支撑追溯与回滚 | `FR-0004 observability` + `FR-0009 contracts` | 契约对齐审查 | M1 | 75% | 需在实现阶段验证 |

## Gate Status

- Fallback viability：PASS
  - 已可冻结门禁对象、前置条件与回退策略，支撑 Sprint 2 实施。
- Implementation readiness：BLOCKED
  - 尚无实现与自动化测试；当前仅完成规约层收口。

## 决策

- Outcome：Proceed to spec review
- Rationale：
  - Sprint 2 目标是“先装护栏再扩 live”，当前规约内容已达到可审门槛。
  - 关键边界（域分离、模式门禁、审批审计、事项联动）均已可表达为稳定契约。
