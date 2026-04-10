# FR-0022 研究记录

## 研究问题

在不越界到账号运营系统的前提下，如何为 Layer 4 冻结一套可实现、可验证、可回滚的“平台历史行为基线与偏移评估”正式边界。

## 当前输入

- `docs/dev/architecture/anti-detection.md`（Layer 4 与 backlog 映射）
- `docs/dev/roadmap.md`（Layer 4 作为后层扩展，不在当前阶段承诺完整实现）
- `docs/dev/architecture/system-design/account.md`（profile/session 最小身份边界）
- `FR-0010`、`FR-0011`（门禁主链）
- `FR-0014`（session 节律边界）
- `#423/#238/#239`（当前主树挂接与验证前置）

## 收敛结论

1. Layer 4 的首要缺口是 formal contract 与 data model，不是先写实现代码。  
2. Layer 4 必须与门禁主链解耦：只输出 `decision_hint`，不直接改写最终放行状态。  
3. 冷启动与学习期必须保守处理，否则会出现“无基线自动放行”的高风险缺陷。  
4. 评估对象必须坚持数据最小化，行为模型只消费结构化摘要，不消费页面原文/私密原文。  
5. `FR-0020`（`#239`）是 Layer 4 共享验证输入的唯一 formal owner；`FR-0022` 只消费 `anti_detection_validation_request`、`anti_detection_structured_sample`、`anti_detection_baseline_snapshot`、`anti_detection_baseline_registry_entry`、`anti_detection_validation_record` 与 `validation_scope=cross_layer_baseline`。
6. `FR-0022` 当前固定 lane 必须写成 `target_fr_ref=FR-0022 + validation_scope=cross_layer_baseline`；`target_fr_ref` 继续复用 `FR-0020` 的 FR 标识语义，不得写成 GitHub issue 号。
7. active baseline 的唯一正式判定来源是 `anti_detection_baseline_registry_entry.active_baseline_ref`；Layer 4 不得仅凭 snapshot / record 自行声明当前生效基线。
8. `FR-0020` registry 的 shared upstream scope 不包含 `platform`、`target_domain` 或 `goal_kind`；这些键继续属于 `FR-0022` 的 downstream drift baseline scope。因此 `FR-0022` 必须拥有自己的 `platform_behavior_baseline_snapshot`；同一条上游 `active_baseline_ref` 只能作为多个 `(platform, target_domain, goal_kind)` scope 的 shared lineage input，不能直接充当这些 scope 共用的 drift baseline 对象。
9. `profile_ref`、`target_domain`、`effective_execution_mode`、`probe_bundle_ref` 与 `goal_kind` 仍属于 Layer 4 baseline identity；不同域名、不同 recon/live scope、不同 probe bundle 或不同 read/write 目标不得被折叠到同一条 Layer 4 baseline / assessment。
10. `browser_channel` 与 `execution_surface` 必须复用共享 canonical 编码，但当前 implementation-ready formal input 只接受 `Google Chrome stable + real_browser`；`stub | fake_host | other` 只保留在上游 `FR-0016` 证据对象中。
11. `platform_behavior_baseline_state` 与 `platform_behavior_assessment` 都需要显式保留 `threshold_config_snapshot_ref`；其中 assessment 还必须保留 `baseline_ref`，否则状态迁移与漂移判定都无法稳定回放或审计。
12. `FR-0022` 进入 implementation-ready 的必要前置是 `FR-0020` 已合入并提供上述正式输入；更细的阈值、假阳性/漏报口径如需冻结，应另行进入 spec review。
