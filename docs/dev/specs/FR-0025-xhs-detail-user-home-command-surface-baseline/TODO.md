# FR-0025 TODO

- [x] 建立 `FR-0025-xhs-detail-user-home-command-surface-baseline` 正式套件
- [x] 建立 canonical issue 绑定 `#504`
- [ ] reviewer 确认 `xhs.detail` / `xhs.user_home` 已冻结为 current public CLI command surface
- [ ] reviewer 确认 `FR-0005` 中“缺失公开命令面”只保留为 dated historical fact
- [ ] reviewer 确认 `note_id` / `user_id` 是唯一 required canonical command input
- [ ] reviewer 确认 `explore_detail_tab` / `profile_tab` 是唯一 target-page baseline
- [ ] reviewer 确认 public CLI request-context 仍要求显式 `target_tab_id` / `runtime_target.tab_id`
- [ ] reviewer 确认 background/extension direct path 的内部 auto target-tab resolution 未被误冻结为公共 CLI 契约
- [ ] reviewer 确认两条命令只消费 `FR-0023` 四对象输入，不新增第二套授权输入
- [ ] reviewer 确认 `request_admission_result` / `execution_audit` 的 canonical slot / 位置约束与 current implementation 对齐
- [ ] reviewer 确认 canonical upstream path 下 `execution_audit` 允许为 `null`，formal 未误写为强制产出
- [ ] reviewer 确认 `execution_audit` 不进入 `observability`
- [ ] reviewer 确认 detail identity 与 `image_scenes` 已显式转交 `#505`
- [ ] reviewer 确认 PR 描述已显式填写 `integration_check.integration_applicable=no` 与 `integration_check.integration_ref=none`
- [ ] reviewer 确认 PR 描述已完整填写 formal spec review PR 所需 `gate_applicability` 字段：`review_lane`、`governance_context_issue_ref`、`governance_scope_targets`、`in_scope`、`trigger_reasons`、`n_a_allowed`
- [ ] reviewer 确认 `Closing=Refs #504` 与 `live_evidence_record=N/A`
- [ ] reviewer 确认 `bash scripts/check-pr-purity.sh docs/FR-0025-xhs-detail-user-home-command-surface-baseline main` 与单分支职责一致
- [ ] spec review 通过并形成可进入实现的新冻结输入

## Handoff

- 当前阶段只冻结 `xhs.detail` / `xhs.user_home` 的 command surface 与 request-context baseline，不承诺实现代码。
- 后续实现应优先消费本 FR 冻结的：
  - current public command surface 结论
  - `note_id` / `user_id`
  - `explore_detail_tab` / `profile_tab`
  - `FR-0023` 四对象输入 ownership
  - `request_admission_result` / `execution_audit` 的 command-level ownership
- deferred scope：
  - `#505`：`xhs.detail` canonical identity 与 `image_scenes`
