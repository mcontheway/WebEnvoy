# FR-0022 风险与回滚

## 风险 1：假阳性导致过度收紧

- 场景：
  - 样本不足或阈值过紧时，Layer 4 把正常行为误判为高偏移。
- 影响：
  - 过度触发 `hold_live_write` 或 `require_manual_review`，影响可用性。
- 缓解：
  - 冷启动和学习期与 ready 分离。
  - 对 `high/critical` 判定要求最小样本阈值与证据回链。
  - `platform_behavior_baseline_state` 与 `platform_behavior_assessment` 都必须持久化 `threshold_config_snapshot_ref`，避免阈值变更后静默重解释旧状态。
  - `goal_kind=write` 的健康基线只能输出“Layer 4 不额外加严”的非阻断 hint，不得把该 hint 误写成 live write 自动放行真相源。
  - Layer 4 的共享证据输入必须回链 `FR-0020`（`#239`）的 `anti_detection_validation_request` / `anti_detection_structured_sample` / `anti_detection_baseline_snapshot` / `anti_detection_baseline_registry_entry` / `anti_detection_validation_record`；active baseline 只能通过 registry 判定；若后续需要冻结更细的阈值、假阳性/漏报口径，必须单独进入 spec review。
- 回滚：
  - 临时关闭 Layer 4 高偏移强约束，只保留 `allow_read_only` 建议输出。

## 风险 2：样本污染与跨 profile 串扰

- 场景：
  - 不同 profile/platform/target_domain/goal_kind，或不同 `effective_execution_mode` / `probe_bundle_ref` 的行为样本被合并写入同一基线。
  - Layer 4 把上游尚未 canonical 的 proxy binding 直接写成 formal 必填输入或并行 active baseline key。
- 影响：
  - 基线失真，后续评估不可用，或引入第二条 active baseline 真相源。
- 缓解：
  - 以 `(profile_ref, platform, target_domain, browser_channel, execution_surface, effective_execution_mode, probe_bundle_ref, goal_kind)` 作为可写隔离主键。
  - `runtime_context_id` 仅用于 run/session 证据回链，不参与可写基线主键。
  - 明确 `FR-0020` registry 只拥有 shared upstream scope；`platform/target_domain` 继续属于 `FR-0022` downstream writable isolation，不得被误写成上游 active baseline selector。
  - `FR-0022` 必须拥有自己的 downstream `platform_behavior_baseline_snapshot`；不得把 `FR-0020.active_baseline_ref` 直接当作 per-platform/per-domain/per-goal drift baseline。
  - 同一条上游 `active_baseline_ref` 可以被多个 `(platform, target_domain, goal_kind)` downstream scope 并行引用；真正需要阻断的是把多个 scope 的 downstream baseline、学习/ready/degraded/reseed 历史折叠到同一条状态对象。
  - 当前 FR 不把 proxy binding 纳入 implementation-ready formal 输入；如未来需要 `proxy_binding_ref`，必须先补上游 canonical contract。
  - 缺少主键坐标的信号一律拒绝入库。
- 回滚：
  - 发现污染后冻结对应基线，回退 `baseline_state=learning` 并触发 `require_reseed`。

## 风险 3：并行真相源导致状态冲突

- 场景：
  - Layer 4 与 `FR-0010/0011` 各自维护一套放行状态。
  - Layer 4 signal batch 只靠 `run_id/runtime_context_id`，却无法回链到 `FR-0020` formal lineage。
- 影响：
  - 审计不可解释，门禁行为不一致，或重新打开并行真相源。
- 缓解：
  - Layer 4 只输出 `decision_hint`，不写门禁最终状态。
  - `platform_behavior_signal_batch` 必须携带 `request_ref`、`sample_ref`、`record_ref`，并保证三者属于同一条 `FR-0020` formal lineage。
  - 固定 lane 常量必须写为 `target_fr_ref=FR-0022 + validation_scope=cross_layer_baseline`，不得把 GitHub issue 号写进 formal lineage。
  - 审计中明确“建议输出”和“最终决策”两个对象。
- Stop-ship：
  - 任何实现若出现 Layer 4 直接改写门禁状态，必须阻断合并。

## 风险 4：冷启动被误放行

- 场景：
  - `unseeded/learning` 状态被当作 `ready` 使用。
- 影响：
  - 高风险动作在无基线下放行，账号风险上升。
- 缓解：
  - 学习完成条件需同时满足样本量、时间跨度、字段完整性。
  - freshness window 过期、连续高漂移或样本完整性失效时，必须显式降级到 `degraded`，不得继续伪装为 `ready`。
  - 命中 reseed threshold、registry invalidation 或污染场景时，必须把 `reseed_required` 置为 `true`。
  - `goal_kind=read` 未达标前默认 `allow_read_only` 或 `require_manual_review`；`goal_kind=write` 未达标前默认 `hold_live_write` 或 `require_manual_review`。
- 回滚：
  - 发现误放行后统一降级到 `learning`，并暂停 Layer 4 放行建议消费。

## 风险 5：采集越界触发隐私与合规风险

- 场景：
  - 将页面原文、输入明文等敏感信息写入 Layer 4 样本。
  - 将 `stub | fake_host | other` 这类非真实浏览器执行面样本混入当前 Layer 4 implementation-ready formal baseline。
- 影响：
  - 数据治理风险和审查阻断。
- 缓解：
  - 合同层只允许行为摘要字段。
  - 引入字段白名单与入库校验。
  - 当前 formal input 只接受 `execution_surface=real_browser`；其余执行面必须在上游证据层被拒绝或隔离，不得进入 Layer 4 baseline。
- 回滚：
  - 立即停写违规字段并清理对应历史样本分区。

## 风险 6：回滚路径不清晰

- 场景：
  - Layer 4 上线后与门禁链路深耦合，无法快速回退。
- 影响：
  - 线上风险扩大且难以收敛。
- 缓解：
  - 实现必须提供 Layer 4 建议消费开关。
  - 将评估与门禁消费保持可拆卸边界。
- 回滚：
  - 关闭 Layer 4 消费开关，门禁退回 `FR-0010/0011` 既有策略。

## 风险 7：pure-read 误标导致 read lane 边界失效

- 场景：
  - `goal_kind=read` 的批次包含 `type`、`submit`、`confirm`、`publish`、`purchase`、`dispatch` 或 `bind`，却仍被标记为 `pure_read`。
  - 下载链路未经正式映射就被直接写成独立 `download` goal，导致与 `action_type`/pure-read 边界脱节。
- 影响：
  - `FR-0019` 的 read lane 边界被绕过，评估结果不可解释。
- 缓解：
  - 强制执行 pure-read 动作白名单：`navigate | locate | click | extract | wait_settled`，其中 `click` 只允许复用 `FR-0019` 的 `action=click + interaction_semantics=reveal_only_click`。
  - `click_kind_mix` 与 assessment 上的 `interaction_semantics/click_kind` 必须保留 reveal-only click 语义，不得把合法点击退化为不可解释的裸 `click`。
  - `ActionMix` 与 `action_type` 必须稳定编码 `type | submit | confirm | publish | purchase | dispatch | bind` 等非读动作。
  - 只要上述非读动作任一非零，立即禁止标记为 `pure_read`。
  - 下载链路进入 Layer 4 前必须先映射到 `goal_kind=read|write`；若包含上述非读动作，只能映射为 `write`。
- 回滚：
  - 发现误标后回滚该批次评估，重算并强制转入 `require_manual_review`。
