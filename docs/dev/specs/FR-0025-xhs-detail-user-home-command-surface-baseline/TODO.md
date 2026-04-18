# FR-0025 TODO

- [x] 建立 `FR-0025-xhs-detail-user-home-command-surface-baseline` 正式套件
- [x] 建立 canonical issue 绑定 `#504`
- [ ] reviewer 确认 `xhs.detail` / `xhs.user_home` 已冻结为 current public CLI command surface
- [ ] reviewer 确认本 PR 已把 `FR-0005` 的旧命令面表述对齐为 dated historical fact，而未提前改判 `#445` 的 live blocker / closeout 语义
- [ ] reviewer 确认 caller-facing `ability.id` / `ability.layer` / `ability.action` envelope 仍是 current public CLI baseline，且 legacy path 未被误写成强制 `L3/read`
- [ ] reviewer 确认 `note_id` / `user_id` 是唯一 required canonical command input
- [ ] reviewer 确认 canonical shared-path ability 只冻结为 current canonical metadata 对齐边界，且 non-canonical `ability.id` 未被 formal 误报为受支持公共契约
- [ ] reviewer 确认 canonical top-level `FR-0023` path 下 `ability.id` 必须命中命令对应的 canonical shared-path ability，且 `ability.action` 必须与 upstream read action 对齐
- [ ] reviewer 确认 `explore_detail_tab` / `profile_tab` 是唯一 target-page baseline
- [ ] reviewer 确认 legacy public CLI request-context 仍要求显式 `target_domain`、`target_tab_id`、`target_page`、`requested_execution_mode`
- [ ] reviewer 确认 `requested_execution_mode` 只冻结 parser 接受面与后续 rejection chain，而未被 formal 误收窄为 read-only allowlist
- [ ] reviewer 确认 canonical top-level `FR-0023` path 继续从 `runtime_target` / current parser 行为派生 shared gate fields，而不是新增第二套外显输入
- [ ] reviewer 确认 `options.upstream_authorization_request` 继续保留为 current command/runtime payload 的兼容 mirror 与现有调用路径，而未被降格为 internal-only
- [ ] reviewer 确认 background/extension direct path 的内部 auto target-tab resolution 未被误冻结为公共 CLI 契约
- [ ] reviewer 确认 canonical top-level path 下两条命令继续消费 `FR-0023` 四个顶层对象输入，不新增第二套授权输入
- [ ] reviewer 确认 legacy public CLI path 仍被保留为 current command-level input model，而未被 formal 误删
- [ ] reviewer 确认 `request_admission_result` / `execution_audit` 的 canonical slot / 位置约束与 current implementation 对齐
- [ ] reviewer 确认本 FR 未放宽 `FR-0023` 对 `request_admission_result` / `execution_audit` 的结果边界
- [ ] reviewer 确认 `request_admission_result` / `execution_audit` 的对象 / 显式 `null` / 缺失兼容形态未被 formal 误收窄
- [ ] reviewer 确认 `execution_audit` 不进入 `observability`
- [ ] reviewer 确认 detail identity 与 `image_scenes` 已显式转交 `#505`
- [ ] reviewer 确认 PR 描述已显式填写 integration-gated 元数据：`integration_applicable=yes`、`integration_touchpoint=active`、`integration_ref=#464`
- [ ] reviewer 确认 PR 描述已显式填写 `shared_contract_changed=yes`、`merge_gate=integration_check_required`、`joint_acceptance_needed=yes`
- [ ] reviewer 确认 PR 描述已完整填写 formal spec review PR 所需 `gate_applicability` 字段：`review_lane`、`governance_context_issue_ref`、`governance_scope_targets`、`in_scope`、`trigger_reasons`、`n_a_allowed`
- [ ] reviewer 确认 `Closing=Refs #504` 与 `live_evidence_record=N/A`
- [ ] reviewer 确认 `bash scripts/check-pr-purity.sh docs/FR-0025-xhs-detail-user-home-command-surface-baseline main` 与单分支职责一致
- [ ] spec review 通过并形成可进入实现的新冻结输入

## Handoff

- 当前阶段只冻结 `xhs.detail` / `xhs.user_home` 的 command surface 与 request-context baseline，不承诺实现代码。
- 后续实现应优先消费本 FR 冻结的：
  - current public command surface 结论
  - caller-facing `ability` envelope
  - `note_id` / `user_id`
  - `explore_detail_tab` / `profile_tab`
  - `FR-0023` 四个顶层对象输入 ownership
  - `options.upstream_authorization_request` 兼容 mirror 路径
  - `request_admission_result` / `execution_audit` 的 command-level ownership
- deferred scope：
  - `#505`：`xhs.detail` canonical identity 与 `image_scenes`
