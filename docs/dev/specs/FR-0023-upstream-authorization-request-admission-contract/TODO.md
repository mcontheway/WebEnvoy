# FR-0023 TODO

- [x] 建立 `FR-0023-upstream-authorization-request-admission-contract` 正式套件
- [ ] reviewer 确认 `action_request` / `resource_binding` / `authorization_grant` / `runtime_target` 的第一版边界已冻结
- [ ] reviewer 确认 `anonymous_context` 与 `profile_session` 是第一版唯一主执行主体
- [ ] reviewer 确认 `account_ref` / `subject_ref` 仅作为治理引用，不会漂移成执行主体
- [ ] reviewer 确认匿名请求命中已登录现场时必须阻断
- [ ] reviewer 确认 `request_admission_result` 与 `execution_audit` 只返回请求级事实，不篡夺上游资源长期状态权威
- [ ] reviewer 确认 `dry_run / recon / live_*`、request-time admission、session rhythm 仍归 WebEnvoy 内部运行时
- [ ] reviewer 确认 `FR-0010/0011/0014` 的兼容迁移表无阻断歧义
- [ ] reviewer 确认 `integration_check` 已按 integration-gated 事项绑定 `#464`，且 `contract_surface=runtime_modes`
- [ ] reviewer 确认 `gate_applicability`、`live_evidence_record=N/A` 与当前 PR 范围一致
- [ ] reviewer 确认 `bash scripts/check-pr-purity.sh docs/472-upstream-authorization-contract-spec main` 结果与单 worktree 单 issue/PR 约束一致
- [ ] spec review 通过并形成实现前冻结结论

## Handoff

- 当前阶段只冻结 formal contract，不承诺实现代码。
- 后续实现应优先消费本 FR 的：
  - `action_request`
  - `resource_binding`
  - `authorization_grant`
  - `runtime_target`
  - `request_admission_result`
  - `execution_audit`
