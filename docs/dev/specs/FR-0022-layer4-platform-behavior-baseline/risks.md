# FR-0022 风险与回滚

## 风险 1：假阳性导致过度收紧

- 场景：
  - 样本不足或阈值过紧时，Layer 4 把正常行为误判为高偏移。
- 影响：
  - 过度触发 `hold_live_write` 或 `require_manual_review`，影响可用性。
- 缓解：
  - 冷启动和学习期与 ready 分离。
  - 对 `high/critical` 判定要求最小样本阈值与证据回链。
  - 漂移阈值验证纳入 `FR-0020`（`#239`）。
- 回滚：
  - 临时关闭 Layer 4 高偏移强约束，只保留 `allow_read_only` 建议输出。

## 风险 2：样本污染与跨 profile 串扰

- 场景：
  - 不同 profile/platform 的行为样本被合并写入同一基线。
- 影响：
  - 基线失真，后续评估不可用。
- 缓解：
  - 以 `(profile, platform, browser_channel, execution_surface, proxy_binding_ref)` 作为隔离主键。
  - `runtime_context_id` 仅用于 run/session 证据回链，不参与可写基线主键。
  - 缺少主键坐标的信号一律拒绝入库。
- 回滚：
  - 发现污染后冻结对应基线，回退 `baseline_state=learning` 并触发 `require_reseed`。

## 风险 3：并行真相源导致状态冲突

- 场景：
  - Layer 4 与 `FR-0010/0011` 各自维护一套放行状态。
- 影响：
  - 审计不可解释，门禁行为不一致。
- 缓解：
  - Layer 4 只输出 `decision_hint`，不写门禁最终状态。
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
  - 未达标前默认 `allow_read_only` 或 `require_manual_review`。
- 回滚：
  - 发现误放行后统一降级到 `learning`，并暂停 Layer 4 放行建议消费。

## 风险 5：采集越界触发隐私与合规风险

- 场景：
  - 将页面原文、输入明文等敏感信息写入 Layer 4 样本。
- 影响：
  - 数据治理风险和审查阻断。
- 缓解：
  - 合同层只允许行为摘要字段。
  - 引入字段白名单与入库校验。
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
  - `goal_kind=read` 的批次包含 `type` 或 `submit`，却仍被标记为 `pure_read`。
- 影响：
  - `FR-0019` 的 read lane 边界被绕过，评估结果不可解释。
- 缓解：
  - 强制执行 pure-read 动作白名单：`navigate | locate | reveal_only_click | extract | wait_settled`。
  - 只要 `type` 或 `submit` 非零，立即禁止标记为 `pure_read`。
- 回滚：
  - 发现误标后回滚该批次评估，重算并强制转入 `require_manual_review`。
