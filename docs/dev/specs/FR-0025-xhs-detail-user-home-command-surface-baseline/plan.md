# FR-0025 实施计划

## 实施目标

冻结 `xhs.detail` / `xhs.user_home` 的 current public command surface、caller-facing `ability` envelope、canonical command input、canonical shared-path ability metadata 对齐边界、target-page baseline，以及它们与 `FR-0023` 四个顶层对象输入和请求级结果对象之间的 command-level ownership，为后续 `#500` 实现 PR 与 `#445` closeout 提供稳定正式输入；其中 legacy public CLI path 的 `ability.layer` / `ability.action` 只冻结为 envelope 存在性与枚举合法性，`L3/read` 只冻结在 canonical metadata 对齐边界。

## 分阶段拆分

### 阶段 1：baseline 冲突收敛

- 产出：`spec.md`
- 重点：收敛 `FR-0005` 历史样本与 current main 的 command-surface 口径，并只为 `#504` 冻结 current public command surface，不提前改判 closeout 语义

### 阶段 2：command-level contract 冻结

- 产出：`contracts/detail-user-home-command-surface.md`
- 重点：冻结 caller-facing `ability` envelope、`note_id` / `user_id`、canonical shared-path ability metadata 对齐边界、`explore_detail_tab` / `profile_tab`、legacy/canonical 两条 request-context 入口的真实差异，以及四个顶层对象输入 ownership
- 重点：同时写明 canonical top-level `FR-0023` caller path 上更严格的 `ability.id` / `ability.action` 约束，避免 formal baseline 比 current main 更宽松

### 阶段 3：风险与研究边界收口

- 产出：`research.md`、`risks.md`、`TODO.md`
- 重点：锁定 current implementation 证据、formal 冲突来源与 `#505` 的 deferred scope，避免后续实现 PR 混入 detail identity

### 阶段 4：spec review PR 准备

- 产出：spec-only Draft PR、纯度门禁记录、PR 结构化元数据
- 重点：确保 PR 只承载 `FR-0025` formal suite 与 issue-sync map，不混 runtime/extension/tests 实现

## 实现约束

- 不修改 runtime、extension、CLI、测试实现或真实执行路径代码。
- 不改写 `FR-0023` 的四对象契约，也不新增第二套授权输入。
- 不冻结 `xhs.detail` canonical identity，不碰 `image_scenes` / `CRD_PRV_WEBP`。
- 不在当前 PR 中混入 `#500` 修复、`#445` rerun、live evidence 或 closeout comment。
- 不修改 `FR-0024` search-only formal freeze，只允许引用其 deferred-scope 结论。
- 不改写 `#504/#505` 的 issue 角色。

## 测试与验证策略

- 规约对照：
  - 对照 `src/commands/xhs-runtime.ts`，确认 current main 已公开注册 `xhs.detail` / `xhs.user_home`
  - 对照 `src/commands/xhs-input.ts` 与相关 tests，确认 caller-facing `ability` envelope、`note_id` / `user_id`、canonical shared-path ability metadata 对齐边界、`target_page`、四个顶层对象输入消费方式与 current implementation 一致，且不把 legacy path 的 `ability.layer` / `ability.action` 误写成强制 `L3/read`
  - 对照 `XHS_COMMAND_ACTION_NAMES` 与 canonical upstream 校验链，确认 top-level `FR-0023` path 继续要求 canonical `ability.id` 命中命令映射，且 `ability.action` 与 upstream read action 对齐
  - 对照 `src/commands/xhs-runtime.ts` 与相关 tests，确认 `request_admission_result` / `execution_audit` 的 canonical slot 继续允许对象 / 显式 `null` / 缺失三种结果形态
  - 对照 `FR-0005` research/TODO，确认当前已完成 command-surface 口径对齐，而不提前关闭 `#445` 或改判其 live blocker 语义
  - 对照 `FR-0023`，确认 command-level ownership 不发明第二套授权输入
- 文档门禁：
  - `bash scripts/docs-guard.sh`
  - `bash scripts/spec-guard.sh`
  - `bash scripts/check-pr-purity.sh docs/FR-0025-xhs-detail-user-home-command-surface-baseline main`
  - `git diff --check`
- PR 校验：
  - `Closing=Refs #504`
  - `integration_check.integration_applicable=yes`
  - `integration_check.integration_touchpoint=active`
  - `integration_check.integration_ref=#464`
  - `integration_check.shared_contract_changed=yes`
  - `integration_check.external_dependency=both`
  - `integration_check.merge_gate=integration_check_required`
  - `integration_check.contract_surface=runtime_modes`
  - `integration_check.joint_acceptance_needed=yes`
  - `integration_check.integration_status_checked_before_pr=yes`
  - `integration_check.integration_status_checked_before_merge=yes`
  - `gate_applicability.review_lane=formal_spec_review_pr`
  - `gate_applicability.governance_context_issue_ref=null`
  - `gate_applicability.governance_scope_targets=[]`
  - `gate_applicability.in_scope=false`
  - `gate_applicability.trigger_reasons=[]`
  - `gate_applicability.n_a_allowed=true`
  - `live_evidence_record=N/A`

## TDD 范围

- 当前 formal suite 不进入实现代码 TDD。
- 后续实现 PR 至少应补齐以下测试矩阵：
  - `xhs.detail` / `xhs.user_home` 的 current command surface 不回退
  - `note_id` / `user_id` 缺失时的入口失败
  - caller-facing `ability` envelope 不回退，legacy path 的 `ability.layer` / `ability.action` 只保持枚举合法性校验，且非 canonical `ability.id` 不被误报为受支持公共契约
  - legacy public CLI path 下 target-page mismatch 与缺失 `target_domain` / `target_tab_id` / `requested_execution_mode` 的入口失败
  - `requested_execution_mode` 继续对齐 current CLI parser 接受面，并保留后续 gate/runtime rejection chain
  - canonical top-level `FR-0023` path 下 shared gate fields 继续从 `runtime_target` / parser 派生，不回退为第二套外显输入
  - `options.upstream_authorization_request` 兼容 mirror 路径继续保留，不被降格为 internal-only
  - canonical top-level objects 存在时的 `request_admission_result` / `execution_audit` canonical slot ownership
  - 本 FR 不放宽 `FR-0023` 对 `request_admission_result` / `execution_audit` 的结果边界，同时不把 current compatibility behavior 中的显式 `null` 收窄为非法
  - legacy path 下 `request_admission_result` / `execution_audit` 为 `null` 时的兼容行为

## 并行 / 串行关系

- 可并行：
  - `#505` 的 formal 准备工作
  - 其他不触碰 `FR-0025` 套件的 formal / implementation 事项
- 串行 / 依赖：
  - 后续实现 PR 必须等待 `FR-0025` 与 `#505` 都完成 formal freeze 后再创建
  - `#445` closeout 不能在本 FR 合并后立即重开，仍需等待新实现 PR merge 与 latest-main rerun
  - `#501` 的 superseded 状态只能在新实现 PR 建立后收口

## 进入实现前条件

- FR-0025 spec review 通过。
- reviewer 确认 `xhs.detail` / `xhs.user_home` 已冻结为 current public CLI command surface。
- reviewer 确认 caller-facing `ability` envelope、`note_id` / `user_id`、canonical shared-path ability metadata 对齐边界、`explore_detail_tab` / `profile_tab`、legacy public CLI shared gate fields，以及 canonical top-level path 的派生规则都无阻断歧义，且 legacy path 未被误写成强制 `L3/read`。
- reviewer 确认两个命令在 canonical top-level path 下的四个顶层对象输入 ownership 与 current implementation 对齐，且没有第二套授权输入。
- reviewer 确认 `options.upstream_authorization_request` 继续冻结为 current command/runtime payload 的兼容 mirror 与现有调用路径，而未被降格为 internal-only。
- reviewer 确认本 FR 未放宽 `FR-0023` 对 `request_admission_result` / `execution_audit` 的结果边界，且未把 current compatibility behavior 中的显式 `null` 收窄为非法。
- reviewer 确认 canonical ability 对齐只冻结为 metadata 边界，且 non-canonical `ability.id` 未被 formal 误报为受支持公共契约。
- reviewer 确认 canonical top-level `FR-0023` path 下的 `ability.id` / `ability.action` 约束与 current main 对齐，没有把该 caller path 误放宽成任意非空 ability。
- reviewer 确认 legacy public CLI path 未被 formal 误删或误写成无效输入模型。
- reviewer 确认 `request_admission_result` / `execution_audit` 的 canonical slot / 位置约束已冻结，且未把其产出写成强制真相。
- reviewer 确认 detail identity 与 `image_scenes` 已显式转交 `#505`。
- 后续实现 issue / PR 已明确为替代 `#501` 的新链路，而不是继续在 `#501` 上补丁。
