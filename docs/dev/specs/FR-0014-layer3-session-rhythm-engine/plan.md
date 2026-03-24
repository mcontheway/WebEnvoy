# FR-0014 实施计划

## 实施目标

本 FR 的实施目标是在不改写 `FR-0010`、`FR-0011` 与 `#226` 已冻结边界的前提下，为 `#237` 输出完整 Layer 3 session 行为节律引擎的 implementation-ready 输入。该输入应足以支撑后续实现 PR 直接围绕窗口、阶段、事件、状态视图和审计关系开展实现，而不再依赖口头补充。

## 分阶段拆分

### 阶段 1：冻结继承边界与正式对象

- 产出：
  - `spec.md`
  - `data-model.md`
  - `contracts/session-rhythm-engine.md`
- 目标：
  - 确认 `#237` 是对 `#226/FR-0011` 的追加延续，不是重定义。
  - 明确真相源与衍生输出边界。

### 阶段 2：冻结窗口、阶段与恢复路径

- 产出：
  - 冷却窗口、恢复探测窗口、稳定窗口的正式约束
  - `session_rhythm_window_state`
  - `session_rhythm_event`
  - `session_rhythm_decision`
- 目标：
  - 明确 `warmup`、`steady`、`cooldown`、`recovery_probe`、`afterglow_hook` 的阶段语义。
  - 明确升级/降级条件与失败回落路径。

### 阶段 3：冻结运行时集成边界

- 产出：
  - `runtime.audit` 的读模型边界
  - 与 `approval_record`、`audit_record`、`profile/session` 的关系说明
- 目标：
  - 避免实现阶段把 `runtime.audit` 误做成新的写入口。
  - 避免出现第二套审批/审计或状态口径。

### 阶段 4：准备实现准入条件

- 产出：
  - `TODO.md`
  - `risks.md`
  - 最小测试与回滚要求
- 目标：
  - 让实现 PR 有明确准入条件、风险边界和回滚入口。

## 实现约束

1. 不得回改 `FR-0010.gate_input`、`gate_outcome`、`approval_record`、`audit_record`、`consumer_gate_result` 的正式语义。
2. 不得回改 `FR-0011/#226` 已冻结的 `paused|limited|allowed`、`session_rhythm_policy`、`session_rhythm` 基线语义。
3. 不得在本 FR 中引入 Layer 1 指纹补全、Layer 2 事件拟人细节或 Layer 4 persona/长期运营实现承诺。
4. `warmup` 与 `afterglow_hook` 只能作为节律阶段挂点和策略约束，不得表述为完整内容编排或 persona 系统。
5. `runtime.audit` 必须继续作为读模型与追溯入口，不得演进为新的门禁判定真相源。

## 测试与验证策略

后续实现 PR 至少需要覆盖以下验证面：

1. 契约测试：
  - `session_rhythm_engine_input`
  - `session_rhythm_window_state`
  - `session_rhythm_event`
  - `session_rhythm_decision`
  - `session_rhythm_status_view`
2. 状态机与窗口测试：
  - `allowed -> limited`
  - `limited -> paused`
  - `paused -> limited`
  - `limited -> allowed`
  - 冷却窗口延长
  - 恢复探测失败继续冷却
  - 稳定窗口未满足时禁止升级
3. 读模型测试：
  - `runtime.audit` 投影与底层真相源一致
  - 多条审计记录与窗口状态聚合后无双口径
4. 失败注入测试：
  - 并发 session 争抢同一 profile
  - 浏览器断开但窗口未收敛
  - 审计写入晚到或缺失
  - stale window 与重复恢复探测

## TDD 范围

以下模块默认要求先写测试：

- 状态机纯逻辑
- 窗口推进与冷却计算
- `runtime.audit` 聚合与投影逻辑
- 审计记录与窗口状态关联逻辑
- 契约解析与序列化

以下内容在本 FR 中不强制 TDD：

- 真实站点自然浏览编排效果
- Layer 2 事件细节
- `#208` 的正式 live 验证

## 并行 / 串行关系

- 可并行：
  - 持久化 schema 设计与纯逻辑状态机测试
  - `runtime.audit` 查询投影与 CLI 返回契约测试
- 串行：
  - 必须先冻结 `contracts/` 与 `data-model.md`，再启动实现。
  - 必须先冻结 `runtime.audit` 与真相源的边界，再写读模型聚合。
  - 若实现需要扩展 `approval_record` / `audit_record` 字段，必须先经过补充 spec review。

## 进入实现前条件

1. FR-0014 spec review 通过，且无“重定义 `#226` 基线”类阻断项。
2. `contracts/session-rhythm-engine.md`、`data-model.md`、`risks.md` 被 reviewer 认可足以支撑实现。
3. 后续实现 PR 明确只围绕 Layer 3 节律引擎，不混入 Layer 1/2/4 或 `#208` 的正式验证实现。
4. 实现 PR 提前声明持久化落点、回滚入口与 `runtime.audit` 投影范围。
5. spec review 通过后才允许把该事项纳入 Sprint 实施承诺。
