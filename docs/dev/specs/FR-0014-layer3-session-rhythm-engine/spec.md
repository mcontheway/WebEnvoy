# FR-0014 Layer 3 完整 Session 行为节律引擎（延续规约）

## 背景

`FR-0011`（含 `#226`）已经冻结了 Sprint 3 的最小可执行前置：最小 session 节律、冷却与恢复规则、以及 `paused/limited/allowed` 三态风险状态机。该前置目标是“先可执行、可门禁、可审计”，不是完整 Layer 3 行为节律引擎。

当前 Layer 3 owning Work Item 是 Phase 2 主树下、由 `FR-0014` 承接的 Layer 3 scope。因此 `FR-0014` 的定位是：在不重定义既有稳定契约的前提下，为 Layer 3 完整 session 节律引擎补齐延续规约。

本 FR 所在 PR 仅用于 spec review，非实现 PR，不承诺在本 PR 内提交运行时代码。

## 目标

1. 明确 `#226/FR-0011` 与 `#237/FR-0014` 的关系：前者是最小可执行前置，后者是完整 Layer 3 延续规约。
2. 冻结 session 级边界：频率、窗口、阶段、冷却、恢复探测、稳定窗口、升级/降级条件。
3. 明确与 `profile`、`session`、`runtime.audit`、`approval_record`、`audit_record` 的职责与数据边界。
4. 明确“追加不重定义”规则：`FR-0014` 只可扩展 `FR-0010/FR-0011` 已冻结语义，不可并行造新口径。
5. 为 `#237` 后续实现 PR 提供可审查、可验收、可测试的正式规约输入。

## 非目标

- 不在本 FR 内实现 Layer 3 引擎代码、调度器、持久化或运行时策略执行。
- 不展开 Layer 1（指纹补全）或 Layer 2（事件拟人）实现细节。
- 不承诺 Layer 4 平台行为模型与长期 persona 体系实现。
- 不承担 `#208` 的实现闭环或恢复 live 实施。
- 不把 `warmup/afterglow` 表述为完整 persona/内容编排能力；仅允许作为 Phase 2 的阶段挂点预留。

## 功能需求

### 1. 追加规约与兼容边界

- `FR-0014` 必须显式声明：`#226/FR-0011` 为最小可执行前置，`#237/FR-0014` 为完整引擎延续，二者是“前置 + 追加”关系，不是替代关系。
- `FR-0014` 只能追加以下维度，不得重定义 `FR-0010/FR-0011` 既有字段语义：
  - `requested_execution_mode` / `effective_execution_mode` / `gate_decision`
  - `approval_record` / `audit_record`
  - `paused/limited/allowed` 基础状态集合
- 若出现冲突，以 `FR-0010/FR-0011` 已冻结语义为准；`FR-0014` 只能通过新增字段或新增约束表达扩展。

### 2. Session 级节律边界（频率、窗口、阶段）

- 必须冻结 session 级最小边界字段组：
  - 频率：单动作最小间隔、阶段内突发上限、同 session 的高风险动作节流上限。
  - 窗口：观测窗口、冷却窗口、恢复探测窗口、稳定窗口。
  - 阶段：`warmup`、`steady`、`cooldown`、`recovery_probe`、`afterglow_hook`。
- `warmup` 与 `afterglow_hook` 仅定义“节律阶段挂点”：
  - 允许约束频率和允许动作范围。
  - 不承诺完整 persona 驱动、内容编排或长期运营策略实现。
- 必须定义阶段切换最小条件：进入条件、退出条件、超时条件、失败回落条件。

### 3. 冷却、恢复探测与稳定窗口

- 必须定义冷却规则：
  - 风险信号触发后进入 `cooldown`，并采用可审计的退避策略（允许指数或分段退避，但语义必须冻结）。
  - 冷却窗口内只允许低风险探测动作或显式阻断。
- 必须定义恢复探测规则：
  - `recovery_probe` 期间仅允许受控探测动作（默认 `recon` 级），不得直接恢复高风险 live。
  - 探测结果必须写入可追溯证据，供状态迁移判定使用。
- 必须定义稳定窗口规则：
  - 只有在稳定窗口满足阈值且审批证据完整时，才允许从 `limited` 升级到 `allowed`。
  - 稳定窗口失败必须触发降级或继续冷却，不得口头放行。

### 4. 升级/降级条件与状态机衔接

- 必须在 `FR-0011` 三态状态机上补充“阶段感知”条件，而不是另起并行状态机。
- 升级条件至少包含：
  - 风险状态检查通过
  - 稳定窗口达标
  - `approval_record` 完整
  - 审计链路可追溯
- 降级条件至少包含：
  - 新风险信号命中
  - 探测失败或证据不足
  - 审计缺失或审批记录不完整
- 任一降级触发后，`effective_execution_mode` 必须反映真实执行结果，不得对外暴露未实际执行的 `live_*` 模式。

### 5. 与 profile/session/runtime.audit/approval_record/audit_record 的关系

- `profile` / `session`：
  - 继续沿用既有运行时标识边界（见 `FR-0003`、`FR-0006`），`FR-0014` 不重定义会话主真相源。
  - session 节律策略绑定在 `(profile, session)` 维度判定，不得脱离会话上下文做全局放行。
- `approval_record` / `audit_record`：
  - 继续复用 `FR-0010/FR-0011` 冻结字段作为审批与审计证据载体。
  - `FR-0014` 只可追加阶段相关约束字段，不得新增并行审批对象替代。
- `runtime.audit`：
  - 作为审计证据读取与追溯入口。
  - 不作为门禁放行判定替代源；放行语义仍由门禁结果与审批证据共同决定。

### 6. Issue 映射与 PR 边界

- 本 FR 必须显式引用：
  - `#427`（Phase 2）
  - `#266`（Canonical FR issue: FR-0014）
  - `#237`（Owning Work Item: Layer 3 scope）
- 本 PR 仅完成 `FR-0014` 规约评审输入，不混入实现代码，不关闭实现 issue。

## GWT 验收场景

### 场景 1：明确最小前置与延续关系

Given reviewer 同时查看 `#226/FR-0011` 与 `#237/FR-0014`
When 检查 FR-0014 的边界声明
Then 能看到 `FR-0011` 是最小可执行前置
And 能看到 `FR-0014` 仅做 Layer 3 完整引擎追加规约而非重定义

### 场景 2：session 节律边界可审查

Given FR-0014 进入 spec review
When 检查功能需求中的 session 级定义
Then 能明确看到频率、窗口、阶段、冷却、恢复探测、稳定窗口
And 每一类边界都有进入/退出或触发条件

### 场景 3：升级与降级条件可判定

Given 当前风险状态为 `limited`
When 稳定窗口达标且审批证据完整
Then 才允许升级到 `allowed`
And 若探测失败或证据不足则保持 `limited` 或降级到 `paused`

### 场景 4：审计与审批关系不分叉

Given 请求涉及 live 升级判定
When reviewer 检查 `approval_record`、`audit_record` 与 `runtime.audit` 的关系
Then 能确认 `approval_record/audit_record` 是正式证据载体
And `runtime.audit` 仅是追溯入口而非替代门禁判定

### 场景 5：warmup/afterglow 没有越界承诺

Given 需求包含 `warmup` 与 `afterglow`
When 检查 FR-0014 文案
Then 两者只被定义为节律阶段挂点
And 未被承诺为完整 persona 或内容编排实现

### 场景 6：本 PR 保持 spec review 边界

Given 当前 PR 范围为 FR-0014 文档
When 检查验收标准与 TODO
Then 能确认本 PR 仅为 spec review
And 不包含 Layer 3 引擎实现承诺

## 异常与边界场景

1. 语义重定义冲突：若 FR-0014 试图重写 `FR-0010/FR-0011` 冻结字段，视为阻断性违规。
2. 阶段越界承诺：若把 `warmup/afterglow` 写成完整 persona/内容编排实现，视为范围漂移。
3. 冷却绕过：命中风险后未进入 `cooldown` 且直接恢复高风险 live，视为阻断性违规。
4. 恢复探测越权：`recovery_probe` 期间执行未批准高风险动作，视为阻断性违规。
5. 稳定窗口缺失：未满足稳定窗口就升级到 `allowed`，视为阻断性违规。
6. 审计链断裂：升级或降级缺少 `approval_record`/`audit_record` 关键字段时，状态变更无效并应回退保守状态。
7. 会话上下文缺失：无法关联到明确 `profile/session` 的节律判定，必须阻断 live 升级。

## 验收标准

1. `spec.md` 包含完整正式结构：背景、目标、非目标、功能需求、GWT、异常与边界、验收标准、依赖与前置条件。
2. 已明确写出 `#226/FR-0011` 为最小可执行前置，`#237/FR-0014` 为追加延续规约。
3. session 级边界完整覆盖：频率、窗口、阶段、冷却、恢复探测、稳定窗口、升级/降级条件。
4. 与 `profile/session/runtime.audit/approval_record/audit_record` 的关系已冻结，且未并行重定义审批/审计对象。
5. 非目标已明确排除 Layer1/2 细节、Layer4、`#208` 实现。
6. `warmup/afterglow` 被限定为 Phase 2 阶段挂点，不构成完整 persona/内容编排实现承诺。
7. 已引用 `#427/#266/#237`，并明确本 PR 为 spec review 而非实现 PR。

## 依赖与前置条件

- 最小可执行前置：`#226` / `FR-0011`
- 门禁与审批审计基线：`FR-0010`
- 父级与映射：`#427`（Phase 2）、`#266`（Canonical FR issue）、`#237`（Layer 3 Work Item）
- 架构依据：
  - `docs/dev/architecture/anti-detection.md`
  - `docs/dev/architecture/system-design/execution.md`
  - `docs/dev/architecture/system-design/read-write.md`
- 规约流程前置：本 FR 需先完成 spec review，后续实现 PR 才可进入 Sprint 承诺。
