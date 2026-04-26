# FR-0029 契约：XHS Closeout Recovery Admission

## Ownership 与边界

- `FR-0029` 是 current repo 中唯一拥有 `#445` XHS-specific rerun admission 聚合语义的 formal owner。
- `FR-0029` 不拥有 `#445` close condition，也不拥有 `FR-0012/0013/0014/0020` 的底层对象定义。
- `FR-0029` 只复用现有 formal surface：`xhs.search`、`xhs.detail`、`xhs.user_home`、`runtime.status.account_safety`、`runtime.status.xhs_closeout_rhythm`、`runtime.audit.anti_detection_validation_view`、`options.xhs_recovery_probe=true`。
- `FR-0029` 不引入新的 public CLI command、第二套 writable gate object family 或独立的 runtime status 顶层状态对象。

## Formal Scope

```ts
type XhsCloseoutRecoveryScopeV1 = {
  platform: "xhs";
  target_domain: "www.xiaohongshu.com";
  browser_channel: "Google Chrome stable";
  execution_surface: "real_browser";
  profile_ref: string;
};
```

约束：

- `profile_ref` 必须复用 `FR-0003` / `FR-0020` 的 canonical namespace。
- 具体 profile 名不是 formal contract 常量。
- `creator.xiaohongshu.com` 不在本 contract 的 closeout admission scope 内。

## Recovery Stages

```ts
type XhsCloseoutRecoveryStageV1 =
  | "recovery_probe_recon"
  | "closeout_admission_probe_live"
  | "closeout_bundle_allowed";
```

约束：

- `closeout_bundle_allowed` 只表示允许重新开始 `#445`，不表示 `#445` 已通过。
- `xhs.detail` / `xhs.user_home` 在前两段阶段均不得参与恢复 single-probe。

## Probe Definitions

### `recovery_probe_recon`

```ts
type XhsRecoveryReconProbeV1 = {
  command: "xhs.search";
  requested_execution_mode: "recon";
  options: {
    xhs_recovery_probe: true;
  };
  probe_bundle_ref: "probe-bundle/xhs-recovery-recon-v1";
};
```

约束：

- 它只服务恢复后的 recon 探针。
- 它通过后，只能解锁 live admission probe 的尝试资格。
- 它不得直接解锁 `#445` full bundle。

### `closeout_admission_probe_live`

```ts
type XhsCloseoutAdmissionLiveProbeV1 = {
  command: "xhs.search";
  requested_execution_mode: "live_read_high_risk";
  options: {
    xhs_recovery_probe?: false | undefined;
  };
  probe_bundle_ref: "probe-bundle/xhs-closeout-min-v1";
};
```

约束：

- 它是 current v1 唯一允许作为 `#445` 恢复前 live admission 的 probe。
- 它不允许被 `xhs.detail` / `xhs.user_home` 替代。
- 它通过前，不得恢复 `#445` 的 `detail/user_home` 路径。

### `XhsCloseoutAdmissionProbeSuccessV1`

```ts
type XhsCloseoutAdmissionProbeSuccessV1 = {
  producer_command: "xhs.search";
  producer_run_id: string;
  profile_ref: string;
  target_domain: "www.xiaohongshu.com";
  browser_channel: "Google Chrome stable";
  execution_surface: "real_browser";
  effective_execution_mode: "live_read_high_risk";
  probe_bundle_ref: "probe-bundle/xhs-closeout-min-v1";
  runtime_audit_run_id: string;
};
```

约束：

- `producer_run_id` 只允许来自当前 `closeout_admission_probe_live` 的 producer run。
- `runtime_audit_run_id` 必须与 `producer_run_id` 相同，不得引用 recon probe 或其他命令 run。
- `profile_ref`、`target_domain`、`browser_channel`、`execution_surface`、`effective_execution_mode`、`probe_bundle_ref` 必须与当前 `XhsCloseoutRecoveryScopeV1` 和 live admission probe 定义一致。
- 若缺少同 run 的 `runtime.audit` 追溯入口，或 run identity 与 scope 键不一致，则不得成立 `live admission success`。

## Validation Binding

```ts
type RequiredCloseoutValidationScopeV1 = {
  target_fr_ref: "FR-0012" | "FR-0013" | "FR-0014";
  validation_scope:
    | "layer1_consistency"
    | "layer2_interaction"
    | "layer3_session_rhythm";
  profile_ref: string;
  browser_channel: "Google Chrome stable";
  execution_surface: "real_browser";
  effective_execution_mode: "live_read_high_risk";
  probe_bundle_ref: "probe-bundle/xhs-closeout-min-v1";
  baseline_status: "ready";
  current_result_state: "verified";
  current_drift_state: "no_drift";
};
```

约束：

- `FR-0012 + layer1_consistency`
- `FR-0013 + layer2_interaction`
- `FR-0014 + layer3_session_rhythm`

上述三条 validation view 还必须同时绑定当前 closeout admission scope：

- `profile_ref = XhsCloseoutRecoveryScopeV1.profile_ref`
- `browser_channel = XhsCloseoutRecoveryScopeV1.browser_channel`
- `execution_surface = XhsCloseoutRecoveryScopeV1.execution_surface`
- `effective_execution_mode = live_read_high_risk`
- `probe_bundle_ref = probe-bundle/xhs-closeout-min-v1`

并且必须同时满足：

- `baseline_status=ready`
- `current_result_state=verified`
- `current_drift_state=no_drift`

才允许开始 `closeout_admission_probe_live`，并继续作为 `closeout_bundle_allowed` 的必要输入。

## Live Probe Admission Gate

```ts
type XhsCloseoutAdmissionLiveProbeGateV1 = {
  recon_probe_passed: true;
  account_safety_state: "clear";
  rhythm_stage_allows_live_admission_probe: true;
  validation_requirements_satisfied: true;
};
```

当前 v1 允许开始 `closeout_admission_probe_live` 的正式条件固定为：

1. recon recovery probe 已通过
2. `runtime.status.account_safety.state = clear`
3. `runtime.status.xhs_closeout_rhythm` 已允许进入 live admission probe 阶段
4. `FR-0012/0013/0014` 三条 validation view 全部满足 `ready + verified + no_drift`

其中任一条件不满足，都不得开始 `closeout_admission_probe_live`。

## Admission Predicate

```ts
type XhsCloseoutBundleAdmissionPredicateV1 = {
  recon_probe_passed: true;
  live_admission_probe_success: XhsCloseoutAdmissionProbeSuccessV1;
  account_safety_state: "clear";
  rhythm_stage_allows_escalation: true;
  validation_requirements_satisfied: true;
};
```

当前 v1 进入 `closeout_bundle_allowed` 的正式条件固定为：

1. recon recovery probe 已通过
2. 存在一条 `XhsCloseoutAdmissionProbeSuccessV1`
3. `runtime.status.account_safety.state = clear`
4. `runtime.status.xhs_closeout_rhythm` 已允许从 live admission probe 进入 bundle escalation
5. `FR-0012/0013/0014` 三条 validation view 全部满足 `ready + verified + no_drift`

其中任一条件不满足，都不得进入 `closeout_bundle_allowed`。

## Probe Bundle Isolation

```ts
type XhsCloseoutProbeBundleRefV1 =
  | "probe-bundle/xhs-recovery-recon-v1"
  | "probe-bundle/xhs-closeout-min-v1";
```

约束：

- 不同 `probe_bundle_ref` 不得共用同一 baseline registry scope。
- `recon` 与 `live_read_high_risk` 不得共用同一 baseline registry scope。
- 不同 `profile_ref`、`browser_channel`、`execution_surface`、`effective_execution_mode`、`probe_bundle_ref` 之间不得互相替代。

## Prohibited Evidence

以下证据不能作为 `#445` 恢复依据：

- low-risk site evidence
- `execution_surface=stub`
- `execution_surface=fake_host`
- Browser Computer Use evidence
- 旧 head、旧 run、旧 artifact
- 非 XHS domain scope 的 validation 结果

## FR-0022 Upgrade Hook

当前 v1 结论固定为：

- `#238 / FR-0022` 不是最小恢复硬前置。
- 如果后续事实证明 Layer 4 必须成为恢复门的一部分，必须先更新 `#552` 与 `#445` truth，再修订本契约。
- 实现 PR 不得在无 truth-sync 的情况下静默把 `#238` 提升为新的 admission prerequisite。
