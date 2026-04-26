# FR-0029 实施计划

## 实施目标

冻结 XHS closeout recovery admission：把 `#445` 从 account-safety / anti-detection 恢复链重新进入 latest-main closeout rerun 的正式准入口径，收口为唯一 XHS-specific contract owner，并把 `FR-0012/0013/0014/0020` 的通用能力绑定回这一条 closeout 场景。

## 分阶段拆分

### 阶段 1：formal truth 与前置边界收口

- 产出：`research.md`
- 重点：
  - 收口 `#445`、`#540/#543/#544` 与 `#265/#267/#266/#239` 之间的 current truth
  - 确认当前 repo 已有 surface：`runtime.status.account_safety`、`runtime.status.xhs_closeout_rhythm`、`runtime.audit.anti_detection_validation_view`
  - 确认 `#238` 当前只保留条件升级 hook

### 阶段 2：recovery admission contract 冻结

- 产出：`spec.md`、`contracts/xhs-closeout-recovery-admission.md`、`data-model.md`
- 重点：
  - 冻结三段恢复阶段
  - 冻结 recon probe 与 live admission probe 的正式分工
  - 冻结 XHS closeout recovery scope 与 probe bundle 隔离

### 阶段 3：实施拆分与风险收口

- 产出：`plan.md`、`TODO.md`、`risks.md`
- 重点：
  - 把后续实现顺序固定为 `#265 -> #267 -> #266 -> #239 -> #552 integrated verify`
  - 防止 `#445` 被重新拿来当 probe harness
  - 防止 Layer 4、low-risk site、stub/fake host、历史 artifact 被误用为恢复证据

## 实现约束

- 不修改 runtime、extension、CLI、测试实现或任何非文档文件。
- 不改写 `#445` 已冻结的 close condition。
- 不新增 public CLI command 或新的 writable gate object family。
- 不把具体 profile 名（例如 `xhs_001`）冻结为 formal contract 常量。
- 不把 `#238 / FR-0022` 直接升级为最小恢复门。
- 不执行 `#445` full closeout bundle 或其他 fresh live rerun。
- `data-model.md` 只允许冻结“复用哪些既有 formal object family”与“哪些字段组成恢复作用域 / admission predicate”，不得借机发明新的持久化真相源。

## 测试与验证策略

- 规约对照：
  - 对照 `docs/dev/specs/FR-0011-xhs-min-anti-detection-execution/spec.md`，确认当前恢复探针与 session rhythm 仍以 `FR-0011` 为最小执行前置
  - 对照 `docs/dev/specs/FR-0015-official-chrome-runtime-migration/contracts/runtime-readiness-status.md`，确认 `runtime.status` 继续承载 runtime readiness / account safety / rhythm 读模型，而非新建第二套状态对象
  - 对照 `docs/dev/specs/FR-0020-anti-detection-validation-baseline/contracts/anti-detection-validation.md`，确认 validation scope、baseline view 与 probe bundle 语义完全复用既有 formal owner
  - 对照 `src/commands/xhs-runtime.ts`，确认 current implementation 里 `xhs_recovery_probe` 仍是 recon-only 语义，本 FR 因此必须使用两阶段恢复而不是静默改义
  - 对照 `docs/dev/specs/FR-0005-xhs-read-spike/TODO.md` 与 `research.md`，确认 `#445` 当前仍以 XHS closeout 证据链为唯一目标
- 文档门禁：
  - `bash scripts/docs-guard.sh`
  - `bash scripts/spec-guard.sh`
  - `git diff --check`

## TDD 范围

- 当前 formal suite 不进入实现代码 TDD。
- 后续实现 PR 至少应补齐以下回归矩阵：
  - recon recovery probe 成功后仍不得直接进入 `#445` full bundle
  - live admission probe 只有在 account safety、rhythm gate、三条 validation view 都满足时才允许
  - `xhs.detail` / `xhs.user_home` 在 live admission probe 成功前保持阻断
  - `probe-bundle/xhs-recovery-recon-v1` 与 `probe-bundle/xhs-closeout-min-v1` 不得共用 baseline scope
  - 错误 profile / bundle / execution mode / non-real-browser evidence 不得放行 `#445`

## 并行 / 串行关系

- 可并行：
  - `FR-0029` 规约冻结 与 `#265` 设计细化
  - `#239` 的对象 / 视图约束细化 与 `#265/#267/#266` 的实现准备
- 串行 / 依赖：
  - `#267` 完成前，不关闭 `#266`
  - `#265/#267/#266` 没有 merged-main verify 前，不关闭 `#239` 的 XHS closeout scope
  - `#552` 必须最后做 integrated admission verify，不能先于四个前置关闭

## 进入实现前条件

- `FR-0029` spec review 通过。
- reviewer 确认 `#445` close condition 与 rerun admission 已被明确拆开。
- reviewer 确认 recon probe 与 live admission probe 的分工已冻结。
- reviewer 确认 `FR-0012/0013/0014/0020` 的 binding 没有被写成第二套私有 anti-detection 体系。
- reviewer 确认 `#238` 当前只保留条件升级 hook，没有被静默提升为最小硬前置。
