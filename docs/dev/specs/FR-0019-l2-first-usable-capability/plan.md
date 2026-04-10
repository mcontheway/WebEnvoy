# FR-0019 实施计划

## 实施目标

为 FR-0019 owning Work Item 冻结未知网站 L2 首次可用能力的正式输入，使后续实现 PR 可以围绕统一的最小读取、最小基础交互、结构化成功产物与 L1 fallback 边界落地。

## 分阶段拆分

### 阶段 A：定位与边界冻结

- 产出：
  - `spec.md` 中的 Phase 2 定位
  - 与 `FR-0017`、现有运行主链和风控边界的关系
- 重点：
  - 明确本 FR 不是完整通用平台，也不是 L1 兜底

### 阶段 B：稳定对象与数据模型冻结

- 产出：
  - `contracts/l2-first-usable-capability.md`
  - `data-model.md`
- 重点：
  - 冻结最小成功产物与 handoff 输出
  - 冻结最小失败大类

### 阶段 C：下游 handoff 与 fallback 边界冻结

- 产出：
  - `TODO.md` 中进入实现前条件
  - 与 `FR-0018`、L1 fallback 的衔接说明
- 重点：
  - 明确什么时候算“先做成一次”
  - 明确什么时候必须停在 L2，不伪装成成功

## 实现约束

1. 本 FR 只提交规约文档，不提交运行时代码。
2. 不把 L2 首次可用扩张成完整 L2 平台或完整 L1 兜底。
3. 不把一次成功路径直接等同于“已验证”或“已正式可复用”。
4. 不重定义现有 CLI 主链、运行记录、诊断或风控对象。
5. 不恢复高风险 live 写路径或混入平台专用适配器实现。

## 测试与验证策略

- 规约阶段门禁：
  - `bash scripts/docs-guard.sh`
  - `bash scripts/spec-guard.sh`
  - `git diff --check`
- 审查重点：
  - L2 首次可用与 L3/L1 的边界是否清楚
  - 成功判定与失败分类是否足够稳定
  - handoff 输出是否足以进入 `FR-0017`
- 实现前验证要求：
  - 首次成功路径产物能直接映射到候选能力输入
  - L1 fallback 建议条件可直接映射为实现断言

## TDD 范围

- 本 FR 处于规约阶段，不直接新增实现测试。
- 后续实现 PR 默认纳入 TDD 的模块：
  - L2 首次可用任务编排
  - 结构化成功产物生成
  - 失败大类映射
  - handoff 输出构造
- 不强制 TDD 的部分：
  - 与真实未知网站相关的手工探索证据

## 并行 / 串行关系

### 串行前置

- `FR-0017` spec review 未通过前，不进入本 FR 的实现 PR。
- 本 FR spec review 未通过前，不进入 L2 首次可用实现 PR。
- Phase 2 Spike D 未完成前，不把 AX Tree 压缩、RefMap 与短引用链路写成 implementation-ready。
- Phase 2 Spike E 未完成前，不把请求拦截加速策略写成 implementation-ready。

### 可并行

- `FR-0018` 的验证/重放规约可以并行进行，但最终必须通过 `FR-0017` 的统一 descriptor 层同时消费既有 L3 样本与本 FR 产出的 L2 handoff 输出。
- `FR-0021` 的下载能力方向可并行讨论，但不应抢占首次可用主闭环。

### 串行后置

- 任一 L2 首次成功路径若要进入 `FR-0017` 的候选能力描述，并继续被 `FR-0018` 验证链路消费，必须先通过本 FR 冻结的结构化输出。
- 后续若需要进一步引入 L1 兜底，必须在独立 Work Item / FR 中承接，而不是回写本 FR。

## 进入实现前条件

1. FR-0019 规约 PR 完成 spec review 且无阻断项。
2. `contracts/l2-first-usable-capability.md` 中的成功产物与失败分类语义无歧义。
3. `data-model.md` 已明确哪些对象属于 handoff 输入，哪些只是实现细节。
4. reviewer 明确认可本 FR 没有把“一次成功”误写成“已验证/已正式复用”。
5. 后续实现 issue / PR 已明确：
  - FR-0019 owning Work Item
  - `FR-0017` 作为上游候选能力描述前置
6. Phase 2 Spike D 已完成并形成可复核输入：
  - AX Tree 压缩算法实现细节
  - RefMap 短引用数据结构与序列化格式
  - 压缩后 Token 消耗对比测试
7. Phase 2 Spike E 已完成并形成可复核输入：
  - `declarativeNetRequest` 拦截规则可行性
  - 误拦截页面功能的影响边界
  - 拦截前后加载时间对比
