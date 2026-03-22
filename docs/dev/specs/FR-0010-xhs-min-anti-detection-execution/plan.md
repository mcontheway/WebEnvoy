# FR-0010 实施计划

## 实施目标

交付 Sprint 3 的最小反风控执行能力规约，形成可直接进入实现评审的契约输入，覆盖：
- 插件层门禁主落点
- 读路径执行模式收敛
- 写路径交互分级
- 最小 session 节律/冷却/恢复
- 最小风险状态机

## 分阶段拆分

### 阶段 A：门禁责任与对象冻结

- 输出：`spec.md` 门禁边界、`contracts/anti-detection-execution.md` 稳定对象。
- 重点：插件层责任划分、状态机字段冻结、读写动作等级框架。

### 阶段 B：证据与差距收敛

- 输出：`research.md` 证据矩阵与已知差距、`data-model.md` 共享对象。
- 重点：将 `FR-0009` 风险门禁与本 FR 执行能力前置串联。

### 阶段 C：风险与实施前置确认

- 输出：`risks.md`、`TODO.md`、spec review 阻断清单。
- 重点：明确 stop-ship、回滚路径、进入实现前条件。

## 实现约束

1. 本 FR 仅定义正式规约，不提交运行时代码实现。
2. 不改变 `FR-0001` CLI 外层壳与 `FR-0002/0003` 通信/会话基础壳。
3. 不把高阶 Layer 4 行为模型扩张到本 Sprint 的最小实现范围。
4. 不把完整写闭环纳入本 FR。

## 测试与验证策略

- 规约阶段验证：
  - `bash scripts/docs-guard.sh`
  - `bash scripts/spec-guard.sh`
  - `git diff --check`
- 审查验证：
  - `spec_review.md` 口径对齐
  - GWT 场景可被 reviewer 直接判定
  - `#208/#209` 是否可直接消费门禁前置

## TDD 范围

- 本 FR 处于规约阶段，不直接要求实现侧 TDD。
- 进入实现 FR 后，以下模块默认纳入 TDD：
  - 状态机迁移判定
  - 门禁策略解析
  - 执行模式与动作分级判定
  - 风险恢复条件判定

## 并行 / 串行关系

- 串行前置：
  - `FR-0009` 已合并（完成）
  - `FR-0010` spec review 通过（本 FR 目标）
- 可并行：
  - Sprint 治理重排（`#216`）中的 roadmap/milestone 调整可并行推进
- 串行后置：
  - `FR-0010` spec review 未通过前，不进入“最小反风控执行能力”实现 PR
  - `#208` 恢复 live 正式验证前，必须先消费本 FR 输出

## 进入实现前条件

1. FR-0010 规约 PR 完成 spec review 且无阻断项。
2. `contracts/anti-detection-execution.md` 五对象语义稳定无歧义。
3. `research.md` 中证据矩阵和差距项已明确标注成熟度。
4. `risks.md` 中 stop-ship 与回滚路径可执行。
5. `#208/#209` 的前置关系已在 issue/PR 描述中明确引用本 FR。
