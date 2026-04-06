# FR-0010 XHS 风险门禁与执行硬化

## 背景

`FR-0009` 已经冻结了“XHS 读写路径风险审查与保护门禁”的治理边界，但当前仓库仍缺少实现级门禁能力。`#209` 的读路径已经落地，`#208` 的最小页面交互验证仍待推进；若不先完成执行硬化，后续 live 验证和功能实现会持续放大账号与风控风险。

`FR-0010` 在 Sprint 2 作为 `FR-0009` 的执行契约替代层：`FR-0009` 保留治理基线，`FR-0010` 提供实现前可直接消费的单一机器契约。

本 FR 对应 `#220`，并承载 Sprint 2 的三条实现项：

- `#218`：读写域分离与目标域/目标页显式确认
- `#219`：执行模式门禁（默认 `dry_run/recon`，live 升级显式放行）
- `#221`：人工确认与审计记录链路

目标是把 Sprint 2 的门禁前置落到可执行能力，作为 `#208` 与 `#209` 后续 live 扩展的统一准入。

## 目标

1. 把读域/写域分离约束落到执行前检查，禁止跨域混推放行。
2. 建立显式目标域/目标页确认门禁，移除高风险默认执行路径。
3. 建立默认 `dry_run/recon` 执行模式，并定义升级到 live 的前置条件。
4. 建立人工确认与审计记录最小闭环，支持事后追溯与回滚。
5. 将 `#208` 与 `#209` 统一纳入同一门禁模型。
6. 冻结统一门禁输出对象，确保 `#208/#209` 消费同一字段口径（`target_domain`、`target_tab_id`、`target_page`、`action_type`、`requested_execution_mode`、`effective_execution_mode`、`gate_decision`、`gate_reasons`）。

## 非目标

- 不交付完整发布闭环能力。
- 不实现完整 Layer 3/4 行为节律引擎。
- 不扩展到账号矩阵、运营策略或平台对抗系统。
- 不在本 FR 内实现新的平台业务能力命令。

## 功能需求

### 1. 读域/写域分离门禁（承载 #218）

- 必须显式区分：
  - 读域：`www.xiaohongshu.com`
  - 写域：`creator.xiaohongshu.com`
- 任意执行请求必须在门禁阶段声明目标域与动作类型。
- 禁止以读域可用性推导写域放行，反之亦然。

### 2. 显式目标域/目标页确认（承载 #218）

- 高风险动作不得走“后台自动选页即执行”的默认路径。
- 执行前必须完成：
  - 目标域确认
  - 目标页确认（必须同时给出 `target_tab_id` 与 `target_page`，防止退化为页面类型字符串）
  - 动作类型确认（读、写、不可逆写）
- 所有门禁请求都必须显式携带 `target_tab_id` 与 `target_page`；不得只在 `live_*` 请求中临时补齐。

### 3. 执行模式门禁（承载 #219）

- 请求方模式必须写入 `requested_execution_mode`。
- 门禁生效模式必须写入 `effective_execution_mode`。
- 默认生效模式必须为 `dry_run` 或 `recon`。
- `live_read_limited`、`live_read_high_risk` 与 `live_write` 进入 live 前都必须满足升级前置；若前置缺失则默认阻断。
- `live_read_limited` 在本 FR 中只保留为 Sprint 3 兼容占位值；其正式公开模式语义与 live-entry 条件仍由 `FR-0011` 单独冻结。
- `live_read_limited` 只允许用于读动作，不得被写动作或不可逆写动作请求或生效；在 `FR-0011` 未完成 formal 收口前，本 FR 必须默认阻断该模式。
- `FR-0009.resume_requirements.limited_read_rollout_ready` 仍是 `live_read_limited` 的 staged rollout 治理前置；在 `FR-0011` 提供其正式机器承载前，本 FR 只保留默认阻断，不把该前置冻结为 Sprint 2 契约字段。
- 任意 live 恢复或扩展都必须同时满足治理侧 `scope_context.spec_review_passed=true` 与 `scope_context.risk_review_completed=true`；任一为 `false` 时必须阻断。
- 升级 live 前置至少包含：
  - 风险状态检查通过
  - 人工确认通过
  - 审批记录落盘
  - 审批检查项完整

### 4. 人工确认与审计（承载 #221）

- 门禁实现必须记录最小审计信息：
  - run_id / session_id / profile
  - target_domain / target_tab_id / target_page
  - action_type / requested_execution_mode / effective_execution_mode
  - approver / approved_at
  - gate_decision / gate_reasons
- 任意 live 放行必须可追溯到审批记录。
- `live_read_limited` 不得绕开审批记录、审计记录或冻结字段独立放行。
- `approval_record` 与 `audit_record` 必须各自提供稳定记录标识，供 `FR-0009` 的 `approval_record_ref` / `audit_record_ref` 等价消费。
- `audit_record` 必须显式回链到同一次 `gate_decision` 与 `approval_record`，保证 `approval_record_ref` 与 `audit_record_ref` 能唯一对应同一 live 恢复/扩展决策。

### 5. 与 #208 / #209 的统一约束

- `#208` 的 live 正式验证必须依赖本 FR 门禁实现。
- `#209` 的后续 live 扩展也必须服从同一门禁，不得豁免。
- 对外输出必须给出可消费的门禁结论对象，避免后续事项口头解释。

### 6. 统一消费对象冻结

- 门禁输出必须包含并冻结以下最小字段：
  - `target_domain`
  - `target_tab_id`
  - `target_page`
  - `action_type`
  - `requested_execution_mode`
  - `effective_execution_mode`
  - `gate_decision`
  - `gate_reasons`
- `#208` 与 `#209` 不得定义私有门禁字段绕过上述对象。

### 7. #223 统一状态机与阻断策略归属锚点（规约层）

- `#223` 的 Sprint 2 统一风险状态机与阻断策略，归属在 FR-0010 套件内扩展，不再新增并行门禁契约。
- `#223` 仅允许在 FR-0010 的 `risk_state`、`gate_decision` 与 `gate_reasons` 语义上做规约层收口；本 FR 不扩展到代码实现承诺。

## GWT 验收场景

### 场景 1：读写域分离生效

Given 运行请求包含 XHS 目标域与动作类型
When 门禁执行预检查
Then 系统能明确识别读域和写域并做分离判定
And 不允许单域成功结论跨域放行

### 场景 2：默认非 live 执行

Given 未满足 live 升级前置
When 请求进入执行阶段
Then 默认模式为 `dry_run` 或 `recon`
And `live_read_high_risk` 与 `live_write` 被阻断
And `live_read_limited` 在未满足升级前置时同样被阻断

### 场景 3：显式目标页确认

Given 请求为高风险执行动作
When 目标页未显式确认
Then 门禁返回阻断结论
And 不进入自动选页执行

### 场景 4：人工确认与审计可追溯

Given 请求满足 live 升级前置并被批准
When 执行放行后查询审计记录
Then 能看到完整的审批与门禁决策信息
And 可用于后续回滚与复盘

### 场景 5：#208 与 #209 统一受控

Given `#208` 与 `#209` 存在后续 live 扩展需求
When 评审者检查门禁输出与依赖关系
Then 两者都被纳入同一门禁模型
And 不存在某一事项绕过门禁的路径

## 异常与边界场景

1. 账号出现风险预警：默认进入 `paused`，阻断高风险 live。
2. 域名/目标页信息缺失：按阻断处理，不允许降级放行。
3. 审批记录缺失或损坏：live 放行无效，回退到 `dry_run/recon`。
4. 写域登录态失配：即便读域可用，写域 live 仍必须阻断。
5. 并发执行竞争：同一 profile 的高风险 live 升级应串行化，避免并发放行。

## 验收标准

1. FR-0010 套件完整并通过 spec review。
2. 读域/写域分离规则已定义为执行前硬门禁。
3. 默认模式为 `dry_run/recon`，高风险 live 默认阻断。
4. 显式目标域/目标页确认（含 `target_tab_id`）、人工确认、审计记录要求均已冻结。
5. `#208` 与 `#209` 的后续 live 扩展前置条件已统一。
6. 输出对象可被实现层与当前已明确的 `#208/#209` 稳定消费。
7. `requested_execution_mode` 与 `effective_execution_mode` 语义已无歧义；`live_read_limited` 在本 FR 中仅作 Sprint 3 兼容占位，不单独冻结其公开模式语义。
8. `gate_decision`（标量）与 `gate_outcome`（对象层）命名冲突已消除。
9. `gate_reasons` 为唯一正式原因字段。

## 与 FR-0009 的替代与兼容关系

- 关系声明：`FR-0009` 继续作为治理基线；Sprint 2 实现与测试统一消费 `FR-0010` 契约对象。
- 替代范围：`FR-0009` 的 `execution_mode_gate` 与 `resume_requirements` 在实现入口侧由 FR-0010 的 `gate_input/gate_outcome/approval_record/audit_record/consumer_gate_result` 承接；后续 FR 只能在保持该对象单口径的前提下扩展受控 live 模式。
- 替代细化：
  - `FR-0009.resume_requirements.spec_review_passed` -> `FR-0010.scope_context.spec_review_passed`
  - `FR-0009.resume_requirements.risk_review_completed` -> `FR-0010.scope_context.risk_review_completed`
  - `FR-0009.resume_requirements.explicit_scope_for_209_extension` -> `FR-0010.scope_context.explicit_scope_for_209_extension`
  - `FR-0009.resume_requirements.explicit_scope_for_208` -> `FR-0010.scope_context.explicit_scope_for_208`
  - `FR-0009.resume_requirements.approval_record_ref` -> `FR-0010.approval_record.approval_id`
  - `FR-0009.resume_requirements.audit_record_ref` -> `FR-0010.audit_record.event_id`
- 兼容要求：若存在旧消费者仍依赖 FR-0009 字段，必须在实现 PR 提供显式映射，不得在 FR-0010 契约中并存双语义字段；`live_read_limited` 的正式公开语义仍以 `FR-0011` 为唯一来源，FR-0010 在其 formal 收口前只承接“默认阻断”语义，不提前冻结 Sprint 3 readiness 字段。
- 上游保留说明：`FR-0009.resume_requirements.limited_read_rollout_ready` 仍是受控读侧 staged rollout 的治理前置；在 `FR-0011` 提供并审查其正式机器承载前，Sprint 2 消费者必须把 `live_read_limited` 视为默认阻断，而不是忽略该前置。
- 迁移完成判定：`#218/#219/#221/#208/#209` 仅消费 FR-0010 冻结字段后，FR-0009 机器字段视为历史参考，不再作为实现准入输入。

## 依赖与前置条件

- 输入事项：`#220`、`#218`、`#219`、`#221`、`#223`、`#213`、`#208`、`#209`、`#216`
- 规约基线：`FR-0009`
- 架构约束：
  - `docs/dev/architecture/system-design/read-write.md`
  - `docs/dev/architecture/anti-detection.md`
