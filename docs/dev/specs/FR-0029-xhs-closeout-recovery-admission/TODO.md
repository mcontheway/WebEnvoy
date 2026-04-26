# FR-0029 TODO

- [ ] reviewer 确认 `#552` 已被正式升格为 `FR-0029` canonical FR issue
- [ ] reviewer 确认 `#445` close condition 未被改写，变化的只有 rerun admission
- [ ] reviewer 确认 current v1 recovery contract 只复用现有 public surface：`xhs.search`、`xhs.detail`、`xhs.user_home`、`runtime.status.account_safety`、`runtime.status.xhs_closeout_rhythm`、`runtime.audit.anti_detection_validation_view`、`options.xhs_recovery_probe=true`
- [ ] reviewer 确认 current v1 恢复阶段已冻结为 `recovery_probe_recon`、`closeout_admission_probe_live`、`closeout_bundle_allowed`
- [ ] reviewer 确认 `xhs.search + options.xhs_recovery_probe=true + requested_execution_mode=recon` 仍只属于 recon recovery probe，不得替代 live admission
- [ ] reviewer 确认 `xhs.search + requested_execution_mode=live_read_high_risk` 已被冻结为当前唯一 closeout admission live probe
- [ ] reviewer 确认进入 `closeout_bundle_allowed` 前，除了 recon probe 之外还必须显式通过 live admission probe
- [ ] reviewer 确认 `xhs.detail` / `xhs.user_home` 不参与恢复 single-probe，并在 live admission probe 成功前不得恢复
- [ ] reviewer 确认 `FR-0012`、`FR-0013`、`FR-0014` 三条 validation view 已被显式绑定为 `ready + verified + no_drift`
- [ ] reviewer 确认 `probe-bundle/xhs-recovery-recon-v1` 与 `probe-bundle/xhs-closeout-min-v1` 已被冻结为两条独立 formal bundle
- [ ] reviewer 确认不同 bundle / execution mode / profile_ref / execution_surface 不得互相替代
- [ ] reviewer 确认 `data-model.md` 只复用既有 formal object family，没有发明新的持久化真相源
- [ ] reviewer 确认具体 profile 名（例如 `xhs_001`）没有被写成 formal contract 常量
- [ ] reviewer 确认 `#238 / FR-0022` 当前只保留条件升级 hook，未被直接提升为最小恢复门
- [ ] reviewer 确认后续实现顺序已冻结为 `#265 -> #267 -> #266 -> #239 -> #552 integrated verify`
