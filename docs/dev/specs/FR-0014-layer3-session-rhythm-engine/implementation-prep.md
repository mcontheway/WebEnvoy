# FR-0014 Implementation Prep

## 文档定位

本文档用于把 `FR-0014 / #237` 收口到 `implementation-ready` 输入，不修改正式 spec 语义，不混入实现代码。

本文档冻结的是：

- 后续实现 PR 应先落哪些真实代码路径
- 哪些对象继续沿用 `#226/#227/FR-0011` 的单一真相源
- `FR-0014` 应先收口哪些共享边界，再交给 `FR-0013` 或后续实现消费
- 最推荐的最小实现切片、测试入口、迁移风险与回滚边界

本文档**不是**功能实现承诺，也**不代表** `FR-0013` / `FR-0014` 已实现。

## 1. 现状收口

### 1.1 已冻结且不得重定义的基线

`#226` 与 `#227` 已闭环，并通过 `FR-0011` 收口为当前唯一正式基线：

- `approval_record` / `audit_record` / `consumer_gate_result` 继续沿用 `FR-0010/FR-0011`
- 风险状态集合仍只有 `paused | limited | allowed`
- 最小 `session_rhythm_policy` 已冻结：
  - `min_action_interval_ms`
  - `min_experiment_interval_ms`
  - `cooldown_strategy=exponential_backoff`
  - `resume_probe_mode=recon_only`
- 写路径交互分级已冻结：
  - `observe_only`
  - `reversible_interaction`
  - `irreversible_write`
- `issue_action_matrix` 已是 `#208/#209` 的正式阻断矩阵

`FR-0014` 只能在这条单口径上做追加，不能并行再造第二套门禁、审批、审计或状态机。

### 1.2 当前真实代码落点

后续实现不能空对空展开，当前真实落点已经存在于以下路径：

- 共享风险/节律基线：
  - `shared/risk-state.js`
  - `src/runtime/risk-state.ts`
- 运行时持久化真相源：
  - `src/runtime/store/sqlite-runtime-store.ts`
  - `src/runtime/store/runtime-store-recorder.ts`
- 查询入口与读模型出口：
  - `src/commands/runtime.ts`
  - ability: `runtime.audit`
- 背景门禁与最小 session 节律摘要验证：
  - `tests/extension.service-worker.contract.test.ts`
  - `tests/cli.contract.test.ts`
- 浏览器侧当前已存在的节律信号来源：
  - `extension/xhs-search.ts`
  - `extension/background.ts`

### 1.3 当前已经存在的真相源与缺口

当前 SQLite runtime store 已落地的正式表只有：

- `runtime_runs`
- `runtime_events`
- `runtime_gate_approvals`
- `runtime_gate_audit_records`

这意味着当前持久化真相源仍以审批与审计为主，Layer 3 的窗口/阶段/事件/决策还没有独立落表。

当前 `runtime.audit` 只是读取：

- `approval_record`
- `audit_records`
- 由共享逻辑派生出的 `risk_state_output`

但当前 CLI 侧仍有一小段读时归约逻辑：`src/commands/runtime.ts` 中的 `resolveCurrentRiskState()` 会优先读取最新 `audit_record.next_state`，否则再对 legacy/缺字段场景做回退推断。后续实现不应继续把这段逻辑留在 CLI 私有分支中，而应下沉到共享层，避免形成“查询时第二套状态机”。

因此，`FR-0014` 的实现第一刀不该新造第二套状态机，而应把 Layer 3 新增对象补到 runtime store，并继续由 `runtime.audit` 做读模型投影。

## 2. 后续实现目标拆分

后续实现建议按以下顺序推进，而不是一次做完整引擎。

### 2.1 第 1 层：补齐 Layer 3 新增真相源

先落地这些 `FR-0014` 新增真相源：

- `session_rhythm_window_state`
- `session_rhythm_event`

其中：

- `approval_record` / `audit_record` 继续是审批与门禁审计真相源
- `session_rhythm_window_state` / `session_rhythm_event` 只补 Layer 3 自己的窗口、阶段与事件语义
- `session_rhythm_decision` 继续作为 `FR-0014` 的正式决策对象存在，但在第一刀中优先按共享 projector / 读模型收口，不要求先单独持久化
- 不新增 `risk_state_v2`、`approval_record_v2`、`audit_record_v2`

### 2.2 第 2 层：建立 Layer 3 的查询投影

在真相源落地后，再让 `runtime.audit` 输出：

- `session_rhythm_status_view`

要求：

- `runtime.audit` 仍是读模型入口，不是写入口
- 读模型冲突时，以底层真相源为准
- 不允许把 `runtime.audit` 反向写回窗口状态

### 2.3 第 3 层：把门禁审计与窗口推进接线

后续实现才开始把以下关系接起来：

- `audit_record` 驱动 `session_rhythm_event`
- `session_rhythm_event` 推进 `session_rhythm_window_state`
- 共享 projector 基于窗口状态产出 `session_rhythm_decision`
- `runtime.audit` 读取并投影为 `session_rhythm_status_view`

这里的关键约束是：

- 放行语义仍由 `FR-0010/FR-0011` 的门禁结果与审批证据承载
- Layer 3 只能追加阶段感知和窗口感知，不能替代门禁主判定

## 3. 预计修改的代码路径

### 3.1 共享状态对象与纯逻辑

- `shared/risk-state.js`
  - 追加 Layer 3 窗口/阶段/恢复探测/稳定窗口的共享读模型和纯逻辑
  - 保持 `paused|limited|allowed` 与现有 `SESSION_RHYTHM_POLICY` 兼容
- `src/runtime/risk-state.ts`
  - 继续做 runtime 侧导出，不在这里引入独立私有语义

### 3.2 持久化与迁移

- `src/runtime/store/sqlite-runtime-store.ts`
  - 新增 Layer 3 所需表
  - 建议从 `schema version 5` 升到 `6`
  - 增加写入方法和查询方法
  - 明确迁移/回滚边界
- `src/runtime/store/runtime-store-recorder.ts`
  - 仅在后续 summary/details 开始携带 Layer 3 对象时，作为写入抽取入口

### 3.3 查询入口

- `src/commands/runtime.ts`
  - 在 `runtime.audit` 中追加 `session_rhythm_status_view`
  - 继续沿用现有 `approval_record`、`audit_records`、`risk_state_output`
  - 不改变 `runtime.audit` 的能力定位

### 3.4 浏览器侧信号接入

后续实现可能消费但**不应作为第一刀主改造面**的路径：

- `extension/xhs-search.ts`
- `extension/background.ts`

这两处当前更适合作为已有风险/恢复信号来源，而不是在第一刀里承担完整 Layer 3 真相源落地。

## 4. 共享真相源 / 正式状态对象

### 4.1 继续沿用的正式真相源

- `approval_record`
- `audit_record`
- `consumer_gate_result`
- `paused | limited | allowed`

这些对象由 `FR-0010/FR-0011/#226/#227` 冻结，`FR-0014` 不得重定义。

### 4.2 FR-0014 新增的正式对象

`FR-0014` 应先收口并实现以下共享对象：

- `session_rhythm_engine_input`
- `session_rhythm_window_state`
- `session_rhythm_event`
- `session_rhythm_decision`
- `session_rhythm_status_view`

其中建议分层如下：

- 真相源：
  - `approval_record`
  - `audit_record`
  - `session_rhythm_window_state`
  - `session_rhythm_event`
- 决策对象：
  - `session_rhythm_decision`
- 衍生读模型：
  - `session_rhythm_status_view`
  - `runtime.audit.*`

### 4.3 单写与单口径约束

后续实现必须先冻结并遵守：

- 同一 `(profile, platform, issue_scope)` 只能有一个可写窗口
- `session_rhythm_window_state` 是 Layer 3 窗口真相源
- `runtime.audit` 只能投影，不得反写
- `FR-0013` 或其他消费者只能读取共享视图，不能自造并行窗口状态

## 5. 与 #226 / #227 的继承边界

### 5.1 FR-0014 继承什么

`FR-0014` 继承：

- 三态风险状态机
- 最小 session 节律基线
- 指数退避冷却
- `recon_only` 恢复探测
- 写路径动作分级
- 审批与审计证据载体

### 5.2 FR-0014 追加什么

`FR-0014` 只追加：

- session 级阶段：
  - `warmup`
  - `steady`
  - `cooldown`
  - `recovery_probe`
  - `afterglow_hook`
- 窗口：
  - 观测窗口
  - 冷却窗口
  - 恢复探测窗口
  - 稳定窗口
- 事件链：
  - `risk_signal`
  - `cooldown_started`
  - `cooldown_extended`
  - `recovery_probe_started`
  - `recovery_probe_passed`
  - `recovery_probe_failed`
  - `stability_window_passed`
  - `manual_approval_recorded`
  - `window_closed`
- Layer 3 决策与状态视图

### 5.3 明确不做什么

- 不新增第二套风险状态集合
- 不替代 `approval_record` / `audit_record`
- 不把 `runtime.audit` 改成门禁真相源
- 不把 Layer 3 扩成 Layer 2 事件细节
- 不恢复 `#208` live 验证
- 不把 `warmup/afterglow_hook` 扩成完整 persona 或内容编排

## 6. 与 FR-0013 的并行 / 串行关系

### 6.1 共享边界上，FR-0014 应先收口的内容

如果后续 `FR-0013` 实现要消费 Layer 3 节律上下文，`FR-0014` 应先落定以下共享边界：

- `session_rhythm_engine_input` 的继承口径
- `session_rhythm_window_state` 的主键与单写约束
- `session_rhythm_event` 的事件类型与回链规则
- `session_rhythm_decision` 的 `allowed|blocked|deferred` 语义
- `session_rhythm_status_view` 的只读定位
- 阶段/窗口语义：
  - `warmup`
  - `steady`
  - `cooldown`
  - `recovery_probe`
  - `afterglow_hook`

### 6.2 可并行部分

可并行的是：

- `FR-0013` 自身规约或实现继续围绕 Layer 2 事件策略展开
- Layer 2 的事件链、回退策略、节奏生成器可继续独立实现

前提是：

- 仍只继承 `FR-0011`
- 不自己定义 Layer 3 状态真相源

### 6.3 必须串行的部分

以下内容应先由 `FR-0014` 落定，再交给 `FR-0013` 消费：

- Layer 3 共享窗口状态对象
- Layer 3 状态视图字段
- 恢复探测与稳定窗口的正式名称和语义
- `runtime.audit` 对外暴露的 Layer 3 读模型

也就是说，`FR-0013` 不是 `FR-0014` 的规约前置，但如果 L2 实现要读取 session 节律上下文，则 `FR-0014` 的共享对象应先冻结并先实现。

## 7. 最小可行实现切片

最推荐的第一刀不是完整引擎，而是下面这个最小切片。

### Slice A：先落共享窗口真相源与查询投影

范围建议只包含：

1. `sqlite-runtime-store` 进入 `schema v6`
2. 新增 `session_rhythm_window_state` 表
3. 新增 append-only 的 `session_rhythm_event` 表
4. 对 `runtime_gate_audit_records` 只做轻量关联字段扩展或回链扩展，不替代原表职责
5. 增加最小 store 方法：
   - `upsertSessionRhythmWindowState`
   - `appendSessionRhythmEvent`
   - `getSessionRhythmStatusView` / `listSessionRhythmStatusViews`
6. `shared/risk-state.js` 新增窗口/阶段/状态视图纯逻辑
7. 把 `resolveCurrentRiskState()` 一类 trail projector 下沉到共享层
8. `runtime.audit` 追加 `session_rhythm_status_view`
9. 针对当前已有 `audit_record` 信号做最小窗口推进

补充约束：

- `session_rhythm_decision` 仍是 `FR-0014` 的正式对象
- 但 Slice A 先只要求它作为共享 projector 的稳定输出语义存在
- Slice A 不要求先为 `session_rhythm_decision` 建独立持久化表或独立查询入口

### Slice A 明确不包含

- Layer 2 事件编排
- 新的 CLI 命令
- 完整 `warmup` / `afterglow_hook` 行为执行器
- 真实站点自然浏览编排
- `#208` live 恢复
- Layer 4 persona

### Slice A 的最小产出

- 新表存在，schema 可迁移
- `schema v5 -> v6` 后旧库仍可读
- 能根据已有 `audit_record` 写入最小 `session_rhythm_event`
- 能维护一条 `(profile, platform, issue_scope)` 级唯一窗口
- `runtime.audit` 能读出 `session_rhythm_status_view`
- 保持现有 `risk_state_output` 与 `approval_record` / `audit_records` 查询兼容

## 8. 建议优先补的测试与迁移验证

### 8.1 单元 / 纯逻辑测试

优先补：

- 阶段推进测试
  - `steady -> cooldown`
  - `cooldown -> recovery_probe`
  - `recovery_probe -> steady`
  - `limited -> allowed` 仅在稳定窗口与审批完整时成立
- 冷却延长测试
- 恢复探测失败继续冷却测试
- `decision=deferred` 不被误判为放行测试

### 8.2 Store / migration 测试

优先补：

- schema version 升级测试
- 旧库迁移后保留 `runtime_gate_approvals` / `runtime_gate_audit_records`
- `schema v5 -> v6` 后新增 Layer 3 表为空但可写
- 新增 Layer 3 表后，旧查询仍可工作
- 单窗口约束测试
- 晚到审计事件与重复恢复探测测试
- 禁止对历史窗口阶段做启发式回填测试

### 8.3 Query / contract 测试

优先补：

- `runtime.audit` 同时返回：
  - `approval_record`
  - `audit_records`
  - `risk_state_output`
  - `session_rhythm_status_view`
- 读模型不反写真相源测试
- 缺失窗口对象时仍保持 `FR-0011` 基线兼容测试
- 共享 trail projector 与 CLI 查询结果一致测试

### 8.4 失败注入测试

最关键的失败注入：

- 并发 session 争抢同一 `(profile, platform, issue_scope)`
- stale window
- 重复 recovery probe
- 浏览器断开后窗口未收敛
- 审计写入晚到
- 审批记录缺失但尝试升级窗口状态

## 9. 主要风险、回滚与兼容策略

### 9.1 主要风险

- 并发双写导致窗口失真
- `audit_record` 与 Layer 3 事件链重复记义
- `runtime.audit` 被误做成写入口
- 迁移后旧库查询失效
- L2/L3 各自生成状态，造成双口径

### 9.2 兼容策略

- 对外继续保留 `FR-0011` 基线输出
- Layer 3 输出按“追加字段”进入 `runtime.audit`
- 旧数据缺失 Layer 3 表时，查询仍能退回 `FR-0011` 基线
- 所有新增语义以 `approval_record` / `audit_record` 回链为准
- 迁移时只创建新表或 nullable 关联字段，不对历史窗口阶段做启发式补算

### 9.3 回滚策略

回滚单位必须是新增 Layer 3 对象，而不是回退 `FR-0011` 基线。

允许回滚的边界：

- 关闭 Layer 3 窗口推进写入
- 关闭 `session_rhythm_status_view` 投影
- 保留现有 `approval_record` / `audit_records` / `risk_state_output`

不允许的回滚方式：

- 回退或改写 `FR-0010/FR-0011/#226/#227` 已冻结对象
- 删除现有最小状态机输出

## 10. 推荐的后续实现第一刀

最推荐的第一刀是：

**先在 `src/runtime/store/sqlite-runtime-store.ts`、`shared/risk-state.js`、`src/commands/runtime.ts` 之间落地 Layer 3 的共享窗口真相源和 `runtime.audit` 读模型扩展。**

原因：

- 这条线直接收口共享边界
- 与 `#226` 单一真相源兼容
- 不需要先做完整浏览器侧行为编排
- 能为 `FR-0013` 后续只读消费提供稳定输入
- 回滚边界清晰，风险可控

## 11. 实现 PR 边界建议

后续正式实现 PR 建议：

- `Refs #237`
- 只做 Layer 3 共享窗口/事件/状态视图切片
- 不混入 Layer 2、Layer 4、`#208` live 恢复或平台完整发布链路

本 implementation prep PR 也应明确：

- 这是 implementation prep / design-prep PR
- 不是功能实现 PR
- 只冻结后续实现切片、共享边界、测试入口与 ownership
- 不代表 `FR-0013` / `FR-0014` 已实现
