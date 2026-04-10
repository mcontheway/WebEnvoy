# FR-0014 研究记录（Layer 3 完整 session 行为节律引擎）

## 研究目标

为 `#237` 产出 implementation-ready 的正式规约输入，重点验证以下结论是否足够稳定：

1. `#226/FR-0011` 已冻结的最小节律能力可以作为唯一基础口径继续扩展。
2. Layer 3 完整引擎需要新增窗口、阶段、事件、决策和状态视图对象，而不是重写既有状态机。
3. `runtime.audit` 适合作为读取投影，而不适合作为新的状态写入口。

## 证据来源

- `vision.md`
- `docs/dev/roadmap.md`
- `docs/dev/architecture/anti-detection.md`
- `docs/dev/architecture/system-design/account.md`
- `docs/dev/architecture/system-design/execution.md`
- `docs/dev/specs/FR-0010-xhs-risk-gates-hardening/`
- `docs/dev/specs/FR-0011-xhs-min-anti-detection-execution/`
- 当前 `main` 已合入的 `#226` 相关共享对象与 `runtime.audit` 返回结构
- GitHub 结构页面：Phase 2 parent issue、FR-0014 canonical issue、Layer 3 owning Work Item

## 关键结论

### C1：`#237` 已属于 Phase 2 正式 backlog，不是研究草案

- 依据：
  - `roadmap.md` 已将 Layer 3 完整 session 行为节律引擎列为 Phase 2 延续能力。
  - `anti-detection.md` 第 11 章已把 Layer 3 scope 映射为当前 owning Work Item。
- 结论：
  - 可直接进入正式 FR 套件，而不是再走 spike-only 路径。

### C2：`#226` 已冻结最小真相源，但能力边界仍偏窄

- 依据：
  - `FR-0011` 只冻结了三态风险状态机、最小 `session_rhythm_policy`、最小 `session_rhythm` 输出。
  - 当前 `main` 中 `shared/risk-state.js` / `runtime.audit` 仅能表达 `normal`、`cooldown`、`recovery` 三类摘要状态。
- 结论：
  - `#237` 不能重写该基础对象，但必须补齐完整窗口/阶段/事件语义。

### C3：Layer 3 的正式真相源必须从 `approval_record` / `audit_record` 继续延伸

- 依据：
  - `FR-0010` 已明确 `approval_record` / `audit_record` 是正式审批与审计边界。
  - 当前 `runtime.audit` 已通过存储层聚合 `approval_record` 与 `audit_records`。
- 结论：
  - `#237` 应新增节律窗口状态与节律事件真相源，但不能绕过审批与审计对象。

### C4：`runtime.audit` 更适合继续做读模型，而非真相源

- 依据：
  - 现有命令路径是查询型接口，已基于运行时存储聚合出 `risk_state_output`。
  - 若把其升级为写入口，会与 `approval_record`、`audit_record`、窗口状态形成竞争写口。
- 结论：
  - `runtime.audit` 应继续做派生投影，只允许读取和汇总。

## 从 `#226` 到 `#237` 的主要差距

| 维度 | `#226 / FR-0011` 已冻结 | `#237 / FR-0014` 需补齐 |
| --- | --- | --- |
| 风险状态 | `paused/limited/allowed` | 状态之外的窗口与阶段语义 |
| 节律输出 | `normal/cooldown/recovery` 摘要 | 可审计的阶段/窗口/事件/决策对象 |
| 恢复 | `recon_only` + 指数退避 | 恢复探测窗口、稳定窗口、失败再冷却规则 |
| session 生命周期 | 最小规则 | `warmup/steady/cooldown/recovery_probe/afterglow_hook` |
| profile 关系 | 无正式节律绑定对象 | 最小 profile 级节律绑定参数 |
| 查询面 | `runtime.audit.risk_state_output` | session 节律状态视图投影 |

## 未采纳路径

1. 直接把 Layer 4 persona/长期行为模型写入本 FR
   - 原因：超出当前任务边界，且与 `account.md` 的最小身份能力边界冲突。
2. 新建 `risk_state_v2`、`approval_record_v2`、`audit_record_v2`
   - 原因：会与 `FR-0010/0011/#226` 形成双口径。
3. 只写 prose，不冻结机器对象
   - 原因：无法支撑 implementation-ready 的后续实现 PR。

## 实施准入判断

- `evidence_readiness`：足够。上位架构、roadmap、既有 FR 与当前实现痕迹已能支撑正式规约。
- `primary_candidate`：明确。采用“继承最小真相源 + 追加窗口/阶段/事件/决策/状态视图对象”的路径。
- `fallback`：若 reviewer 认为 `warmup` / `afterglow_hook` 过宽，可保留其阶段壳与禁用标记，不影响 Phase 2 主体实现。
- `admission_ready`：满足。当前套件可作为后续实现 PR 的正式输入。
