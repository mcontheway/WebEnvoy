# FR-0029 数据模型边界

## 结论

本 FR 不新增 SQLite 表、迁移或新的持久化真相源。它只冻结 current v1 XHS closeout recovery admission 如何复用既有 formal object family，并明确哪些字段共同组成恢复作用域与阶段判断。

## 共享对象与派生边界

### 1. `runtime.status.account_safety`

角色：

- XHS account-risk hard stop 的唯一 formal 读模型输入
- 用于判断当前是否仍允许继续评估 closeout recovery admission

当前正式使用字段：

- `state`
- `platform`
- `reason`
- `cooldown_until`
- `source_run_id`
- `source_command`
- `target_domain`
- `target_tab_id`
- `page_url`
- `live_commands_blocked`

约束：

- `FR-0029` 只消费其读模型语义，不拥有该对象 schema。
- `state=clear` 是进入 live admission probe 与 closeout bundle admission predicate 的必要条件。
- `state=account_risk_blocked` 时，不得进入任何 XHS closeout live 恢复路径。

### 2. `runtime.status.xhs_closeout_rhythm`

角色：

- XHS closeout recovery phase 与 escalation gate 的唯一正式读模型输入

当前正式使用字段：

- `state`
- `cooldown_until`
- `operator_confirmed_at`
- `single_probe_required`
- `single_probe_passed_at`
- `probe_run_id`
- `full_bundle_blocked`
- `reason_codes`

约束：

- `FR-0029` 只消费其读模型语义，不重定义状态机。
- recon recovery probe 与 closeout admission live probe 都必须服从该状态机。
- `closeout_bundle_allowed` 只能在 rhythm stage 明确允许 escalation 时成立。

### 3. `anti_detection_validation_view`

角色：

- `FR-0012/0013/0014` 三层 anti-detection baseline 的 machine-checkable readiness 输入

当前正式使用字段：

- `target_fr_ref`
- `validation_scope`
- `profile_ref`
- `browser_channel`
- `execution_surface`
- `effective_execution_mode`
- `probe_bundle_ref`
- `baseline_status`
- `current_result_state`
- `current_drift_state`
- `latest_record_ref`
- `last_success_at`

约束：

- `FR-0029` 不拥有 `anti_detection_validation_view` schema，只拥有它在 XHS closeout admission 中的消费方式。
- 三条 scope：
  - `FR-0012 + layer1_consistency`
  - `FR-0013 + layer2_interaction`
  - `FR-0014 + layer3_session_rhythm`
- 这三条 scope 都必须满足：
  - `baseline_status=ready`
  - `current_result_state=verified`
  - `current_drift_state=no_drift`

### 4. `XhsCloseoutRecoveryScopeV1`

角色：

- `FR-0029` 自有的 formal scope definition

字段：

- `platform = xhs`
- `target_domain = www.xiaohongshu.com`
- `browser_channel = Google Chrome stable`
- `execution_surface = real_browser`
- `profile_ref`

约束：

- `profile_ref` 必须复用 `FR-0003/FR-0020` canonical namespace。
- 具体 profile 名不是 formal constant。
- 非 XHS domain、非 real-browser、错误 browser channel 都不得进入该 scope。

### 5. `XhsCloseoutRecoveryStageV1`

角色：

- `FR-0029` 自有的 formal phase model

枚举：

- `recovery_probe_recon`
- `closeout_admission_probe_live`
- `closeout_bundle_allowed`

约束：

- `closeout_bundle_allowed` 不表示 closeout 成功，只表示允许重新进入 `#445`。
- `xhs.detail` / `xhs.user_home` 不参与前两段 single-probe。

### 6. Probe bundle identity

角色：

- `FR-0029` 在 `FR-0020` 作用域键之上的 formal probe-bundle binding

枚举：

- `probe-bundle/xhs-recovery-recon-v1`
- `probe-bundle/xhs-closeout-min-v1`

约束：

- 两条 bundle 不得共用同一 baseline registry scope。
- `recon` 与 `live_read_high_risk` 不得共用同一 baseline scope。
- 不同 `profile_ref`、`browser_channel`、`execution_surface`、`effective_execution_mode`、`probe_bundle_ref` 之间不得互相替代。

## Admission Predicate

`closeout_bundle_allowed` 的正式判断输入必须同时满足：

- `recon_probe_passed = true`
- `live_admission_probe_passed = true`
- `account_safety_state = clear`
- `rhythm_stage_allows_escalation = true`
- `validation_requirements_satisfied = true`

其中：

- `recon_probe_passed` 指 `xhs.search + options.xhs_recovery_probe=true + requested_execution_mode=recon`
- `live_admission_probe_passed` 指 `xhs.search + requested_execution_mode=live_read_high_risk` 的 closeout admission probe
- `validation_requirements_satisfied` 指三条 validation view 全部满足 `ready + verified + no_drift`

## 不属于本 FR 的对象

- `#445` closeout evidence bar
- `FR-0012/0013/0014` 的 layer implementation schema
- `FR-0020` 的 request / sample / baseline / registry / record / view formal ownership
- `FR-0022` 的 Layer 4 downstream writable object family

上述对象继续保持原归属；`FR-0029` 只冻结它们在 XHS closeout recovery admission 中的组合消费方式。
