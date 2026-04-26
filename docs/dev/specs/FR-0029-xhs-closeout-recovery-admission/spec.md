# FR-0029 冻结 XHS Closeout Recovery Admission

Canonical Issue: #552

## 背景

`#445` 的 closeout 语义已经冻结：只有在 current latest main 上重新完成 `xhs.search`、`xhs.detail`、`xhs.user_home` 的 XHS-specific fresh primary API multi-round evidence，才允许回写 `FR-0005` formal docs 并关闭 `#445`。

但当前仓库已经形成一个新的正式缺口：系统虽然已经通过 `#540/#541/#542/#543/#544` 建立了最小 account-safety、cooldown、operator confirmation 与 validation gate 基础，却仍缺少一条 XHS-specific formal owner 来回答下面这个问题：

- 在什么条件下，才允许从 account-safety / anti-detection 恢复链重新进入 `#445` latest-main closeout rerun？

如果这一层继续停留在 issue comment 或实现侧约定，就会出现两类持续性漂移：

- `#265/#267/#266/#239` 的通用 anti-detection 工作各自推进，但没有一条唯一正式链路把这些能力绑定回 XHS closeout 场景。
- `#445` 容易重新退化成 live probe harness，被用来替代恢复准入 contract 本身。

因此，本 FR 的职责不是改写 `#445` 的 close condition，也不是提前执行 live rerun，而是补齐这条缺失的 formal owner：冻结 XHS closeout recovery admission 的唯一正式输入、阶段机、probe bundle 隔离、以及与 `FR-0012/0013/0014/0020` 的绑定方式。

## 目标

1. 冻结 `#552` 作为 `#445` 恢复主线的唯一 XHS-specific contract owner。
2. 冻结从 account-safety gate 恢复到 `#445` full bundle 之间的三段恢复阶段。
3. 冻结 recon recovery probe 与 closeout admission live probe 的正式分工。
4. 冻结 `FR-0012/0013/0014/0020` 在 XHS closeout admission 场景中的最小绑定方式。
5. 冻结 `probe-bundle/xhs-recovery-recon-v1` 与 `probe-bundle/xhs-closeout-min-v1` 的 formal 隔离边界。

## 非目标

- 不改写 `#445` 已冻结的 close condition。
- 不在本 FR 内运行 `#445` full bundle 或任何 fresh live closeout rerun。
- 不新增 public CLI command、public API 或第二套 runtime gate surface。
- 不把 low-risk-site、stub、fake_host、历史 artifact 或 Browser Computer Use evidence 升格为 XHS recovery evidence。
- 不把 `#238 / FR-0022` 当前直接升级为最小硬前置；它只保留条件升级 hook。
- 不把当前执行现场使用的具体 profile 名（例如 `xhs_001`）冻结成 formal contract 常量。

## 功能需求

### 1. current formal owner

系统必须冻结：`#552 / FR-0029` 是 current repo 中唯一负责定义 “何时允许重新进入 `#445` latest-main closeout rerun” 的 XHS-specific formal owner。

约束：

- `#445` 继续只承接 closeout 语义，不再承接恢复准入 contract 本身。
- `#265/#267/#266/#239` 继续分别拥有各自 layer / baseline formal scope，不直接拥有 `#445` rerun admission 的最终聚合语义。
- 任何后续实现 PR 如要声称“XHS closeout 现在允许重新开始”，必须显式消费本 FR，而不是只引用通用 anti-detection FR。

### 2. public surface 与 contract boundary

系统必须冻结：本 FR 不新增新的 public command surface，只复用以下 current formal surface：

- `xhs.search`
- `xhs.detail`
- `xhs.user_home`
- `runtime.status.account_safety`
- `runtime.status.xhs_closeout_rhythm`
- `runtime.audit.anti_detection_validation_view`
- `options.xhs_recovery_probe=true`

约束：

- `FR-0029` 只定义 rerun admission predicate，不定义新的 closeout success bar。
- `FR-0029` 不得把 `runtime.status` / `runtime.audit` 派生视图改写成新的 writable truth source。
- `FR-0029` 不得把 `options.xhs_recovery_probe=true` 重新定义为 live admission probe。

### 3. XHS-specific recovery scope

系统必须冻结以下 XHS closeout recovery scope：

- `platform = xhs`
- `target_domain = www.xiaohongshu.com`
- `browser_channel = Google Chrome stable`
- `execution_surface = real_browser`
- `profile_ref` 继续复用 `FR-0003` / `FR-0020` 的 canonical namespace

约束：

- 不得把具体 profile 名字写成 formal contract 常量。
- low-risk site、非 XHS 域、stub、fake_host、非 real-browser surface 不得充当本 scope 的恢复证据。
- `target_domain` 当前固定为 closeout read domain `www.xiaohongshu.com`；creator write domain 不属于本 FR 的恢复 admission scope。

### 4. 三段恢复阶段

系统必须冻结：XHS closeout recovery admission 在 current v1 有且只有三段正式阶段：

- `recovery_probe_recon`
- `closeout_admission_probe_live`
- `closeout_bundle_allowed`

约束：

- `closeout_bundle_allowed` 只表示“允许重新开始 `#445`”，不表示 `#445` 已通过。
- `xhs.detail` / `xhs.user_home` 不得参与前两段 single-probe。
- 只有完成前两段后，才允许重新回到 `#445` 的 `xhs.search` round 1。

### 5. recon recovery probe

系统必须冻结：第一阶段 `recovery_probe_recon` 沿用 `#543` 的恢复探针语义。

固定定义：

- command: `xhs.search`
- `options.xhs_recovery_probe = true`
- `requested_execution_mode = recon`
- probe bundle: `probe-bundle/xhs-recovery-recon-v1`

约束：

- 它只用于恢复后的安全 recon 探针。
- 它通过后，仍不得直接进入 `#445` full bundle。
- 它通过后，只能解锁第二阶段 live admission probe 的尝试资格。

### 6. closeout admission live probe

系统必须冻结：第二阶段 `closeout_admission_probe_live` 是 current v1 唯一允许作为 `#445` 恢复前 live admission 的 probe。

固定定义：

- command: `xhs.search`
- `requested_execution_mode = live_read_high_risk`
- 不携带 `options.xhs_recovery_probe = true`
- probe bundle: `probe-bundle/xhs-closeout-min-v1`

约束：

- 它的职责是证明“当前可以开始 `#445`”，不是证明 `#445` 已关闭。
- 它不允许被 `xhs.detail` / `xhs.user_home` 替代。
- 它通过前，不得进入 `#445` 的 `xhs.detail` / `xhs.user_home` rerun。
- 它的成功必须产出可机器校验的 live admission success 来源，至少绑定：
  - producer command = `xhs.search`
  - producer `run_id`
  - `profile_ref`
  - `target_domain = www.xiaohongshu.com`
  - `browser_channel = Google Chrome stable`
  - `execution_surface = real_browser`
  - `effective_execution_mode = live_read_high_risk`
  - `probe_bundle_ref = probe-bundle/xhs-closeout-min-v1`
  - 同一 `run_id` 的 `runtime.audit` 追溯入口
- 它只有在以下条件全部满足时才允许开始：
  - recon recovery probe 已通过
  - `runtime.status.account_safety.state = clear`
  - `runtime.status.xhs_closeout_rhythm` 允许进入 live admission probe 阶段
  - `runtime.audit.anti_detection_validation_view` 对 `FR-0012/0013/0014` 三条 scope 同时满足 `ready + verified + no_drift`

### 7. closeout bundle admission predicate

系统必须冻结：只有当以下条件全部满足时，才允许进入 `closeout_bundle_allowed`：

- recon recovery probe 已通过
- 存在一条属于当前 closeout admission scope 的 live admission success 来源
- `runtime.status.account_safety.state = clear`
- `runtime.status.xhs_closeout_rhythm` 已允许进入 live admission probe 之后的 bundle escalation
- `runtime.audit.anti_detection_validation_view` 对以下三条 scope 同时满足：
  - `target_fr_ref=FR-0012` + `validation_scope=layer1_consistency`
  - `target_fr_ref=FR-0013` + `validation_scope=layer2_interaction`
  - `target_fr_ref=FR-0014` + `validation_scope=layer3_session_rhythm`
- 对上述三条 scope，对应的 validation view 还必须同时绑定当前 closeout admission scope 键：
  - `profile_ref =` 当前 `XhsCloseoutRecoveryScopeV1.profile_ref`
  - `browser_channel = Google Chrome stable`
  - `execution_surface = real_browser`
  - `effective_execution_mode = live_read_high_risk`
  - `probe_bundle_ref = probe-bundle/xhs-closeout-min-v1`
- 对上述三条 scope，当前都必须满足：
  - `baseline_status=ready`
  - `current_result_state=verified`
  - `current_drift_state=no_drift`

约束：

- 其中任一条件不满足，都不得进入 `closeout_bundle_allowed`。
- `closeout_bundle_allowed` 不得消费裸布尔值 `live_admission_probe_passed=true`；必须消费带 producer/run identity 的 live admission success 来源。
- 当前 formal baseline 下，`FR-0020` 的 validation view 只能作为 rerun admission predicate 输入，不得直接充当 `FR-0016` PR merge gate。

### 8. FR-0012 / 0013 / 0014 / 0020 binding

系统必须冻结：`FR-0029` 不发明第二套 anti-detection 要求，而是绑定回现有正式 layer owner。

- `FR-0012 / #265`
  - 提供 XHS managed closeout runtime 的 profile / fingerprint consistency 前置
- `FR-0013 / #267`
  - 提供 XHS 恢复 / 预热 / 开页 / closeout 所需的最小 humanized interaction boundary
- `FR-0014 / #266`
  - 提供 cooldown、operator confirmation、recon probe、live admission probe 与 bundle escalation 的 session rhythm 语义
- `FR-0020 / #239`
  - 提供 machine-checkable baseline request / sample / registry / record / view truth

约束：

- `FR-0029` 不得自己定义新的 baseline object family。
- `FR-0029` 不得把 Layer 2/3/validation 的 scope 简化为口头说明，必须在合同中显式绑定。

### 9. probe bundle isolation

系统必须冻结以下 current v1 probe bundle：

- `probe-bundle/xhs-recovery-recon-v1`
- `probe-bundle/xhs-closeout-min-v1`

约束：

- 不同 probe bundle 不得共用同一 baseline registry scope。
- `recon` 与 `live_read_high_risk` 不得共用同一 baseline registry scope。
- 不同 `profile_ref`、`browser_channel`、`execution_surface`、`effective_execution_mode`、`probe_bundle_ref` 之间不得互相替代。

### 10. FR-0022 upgrade hook

系统必须冻结以下 current v1 结论：

- `#238 / FR-0022` 当前不是 `#445` 恢复的最小硬前置。
- 但如果后续事实证明 Layer 4 平台行为基线必须成为恢复门的一部分，必须先显式更新 `#552` 与 `#445` 的 truth，再升级本 FR。

约束：

- 不得在实现 PR 中静默把 `#238` 变成新的硬前置。
- 不得在无 truth-sync 的情况下引用 Layer 4 结果阻断或放行 `#445`。

## GWT 验收场景

### 场景 1：`#445` close condition 未变，但 rerun admission 已升级

Given `#445` 仍然是 XHS-specific closeout-only issue
When reviewer 检查 `FR-0029`
Then 能看到 `#445` 的 close condition 没有被改写
And rerun admission 已明确升级为 `#265/#267/#266/#239/#552`

### 场景 2：recon recovery probe 不等于允许 full bundle

Given `xhs.search` 以 `options.xhs_recovery_probe=true` 且 `requested_execution_mode=recon` 成功通过
When 系统判断是否允许进入 `#445` full bundle
Then 仍不得进入 `closeout_bundle_allowed`
And 只允许继续评估 live admission probe

### 场景 3：live admission probe 必须满足三层 validation 与 gate 条件

Given recon recovery probe 已通过
And `runtime.status.account_safety.state=clear`
And `runtime.status.xhs_closeout_rhythm` 允许进入 live admission 阶段
And `FR-0012/0013/0014` 三条 validation view 都是 `ready + verified + no_drift`
And 这三条 validation view 都绑定当前 `profile_ref / browser_channel / execution_surface / effective_execution_mode=live_read_high_risk / probe_bundle_ref=probe-bundle/xhs-closeout-min-v1`
When 系统评估 `closeout_admission_probe_live`
Then 才允许进入 live admission probe
And probe bundle 必须固定为 `probe-bundle/xhs-closeout-min-v1`
And 后续若 probe 成功，必须产出绑定 producer `run_id` 与同 run `runtime.audit` 的 live admission success 来源

### 场景 4：live admission probe 未通过时不得进入 bundle

Given recon recovery probe 已通过
And 不存在属于当前 closeout admission scope 的 live admission success 来源
When 系统判断是否允许进入 `closeout_bundle_allowed`
Then 必须继续保持阻断
And 不得恢复 `#445` full bundle

### 场景 5：detail/user_home 在 live admission probe 成功前不得恢复

Given `closeout_admission_probe_live` 尚未成功
When 调用方尝试把 `xhs.detail` 或 `xhs.user_home` 恢复到 `#445` rerun
Then 系统必须保持阻断
And 只能从 `xhs.search` round 1 重启 closeout lane

### 场景 6：跨 site / 跨 profile / 跨 bundle / 跨 mode 证据不能替代 XHS closeout admission

Given 存在 low-risk site、stub、fake_host、非 XHS profile、错误 probe bundle 或错误 execution mode 下的 validation 证据
When 系统评估 `#445` 恢复准入
Then 这些证据都不得替代 XHS closeout admission scope

### 场景 7：Layer 4 默认不是最小前置

Given `#238 / FR-0022` 仍处于 open 或未被 truth-sync 升级
When reviewer 检查 current v1 recovery contract
Then `#238` 不应被视为最小硬前置
And 只有显式 truth-sync 后，才允许升级为新的恢复门

## 异常与边界场景

1. recon probe 成功，但 validation view 未 ready：不得进入 live admission probe。
2. validation view ready，但 account safety 不 clear：不得进入 live admission probe。
3. recon probe 成功，但 rhythm gate 尚未允许 live admission probe：不得进入 live admission probe。
4. recon probe 成功，但 live admission probe 未通过，或未形成可机器校验的 live admission success 来源：仍不得进入 `closeout_bundle_allowed`。
5. live admission probe 成功前尝试直接运行 `xhs.detail` / `xhs.user_home`：必须继续阻断。
6. probe bundle 错误或 scope 混用：必须视为 admission invalid。
7. 企图把具体 profile 名字写成 formal contract 常量：视为 scope 污染。
8. 未经 truth-sync 就把 `#238` 升为硬前置：视为阻断性违规。

## 验收标准

1. reviewer 能从本 FR 单独回答：在 current v1 下，什么条件满足时才允许重新进入 `#445`。
2. reviewer 能清楚区分 recon recovery probe、live admission probe 与 `#445` full bundle 三者的正式职责。
3. reviewer 能确认 `FR-0012/0013/0014/0020` 的 binding 已冻结，但没有被重写成第二套私有 anti-detection 体系。
4. reviewer 能确认 `#238` 当前只保留条件升级 hook，没有被静默提升为最小恢复硬前置。
5. reviewer 能确认 low-risk site、stub、fake_host、历史 artifact、Browser Computer Use evidence 全部被排除在恢复证据之外。

## 依赖与前置条件

- `#445` 已保持 closeout-only，并已把 rerun admission truth 指向 `#552`
- `#540/#541/#542/#543/#544` 已完成最小 safety / cooldown / validation gate 基础
- `FR-0011`、`FR-0015`、`FR-0020` 的 current formal objects 已存在并可复用
- `#265/#267/#266/#239` 仍为 open，后续实现必须消费本 FR 才能形成完整恢复链
