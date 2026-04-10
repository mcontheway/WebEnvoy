# FR-0022 实施计划

## 实施目标

为 `FR-0022` / `#238` 冻结 Layer 4 平台行为基线的正式输入边界，使后续实现 PR 能在不重写 `FR-0010/0011/0014` 既有语义的前提下，落地“行为信号采集 -> 基线状态计算 -> 偏移评估 -> 风险建议输出”的最小闭环。

## 分阶段拆分

### 阶段 A：范围与继承边界冻结

- 产出：
  - `spec.md`
- 目标：
  - 明确 Layer 4 的职责是长期行为基线与偏移评估，不是账号运营系统。
  - 明确 Layer 4 只输出建议，不直接改写门禁状态真相源。
  - 明确 Layer 4 只消费 `FR-0020` 的 `anti_detection_validation_request` / `anti_detection_structured_sample` / `anti_detection_baseline_snapshot` / `anti_detection_baseline_registry_entry` / `anti_detection_validation_record`，且 `validation_scope=cross_layer_baseline` 是唯一正式输入入口。
  - 明确固定 lane 常量是 `target_fr_ref=FR-0022`，继续复用 `FR-0020` 的 FR 标识语义，而不是写成 GitHub issue 号。
  - 明确 active baseline 判定只能通过 `anti_detection_baseline_registry_entry.active_baseline_ref` 解析，不能由 Layer 4 直接根据 snapshot / record 自行决定。
  - 明确 `FR-0020` registry 只拥有 shared upstream scope，`platform/target_domain/goal_kind` 仍属于 `FR-0022` 自己的 downstream drift baseline scope。
  - 明确同一条上游 `active_baseline_ref` 可以被多个 `(platform, target_domain, goal_kind)` downstream scope 并行引用为 shared lineage input，但每个 scope 都必须拥有自己独立的 `platform_behavior_baseline_snapshot`、状态对象与评估历史。
  - 明确 `profile_ref`、`target_domain`、`effective_execution_mode` 与 `probe_bundle_ref` 仍属于 Layer 4 baseline identity，不能在跨层评估时被折叠丢失。
  - 明确 read lane 继承 `FR-0019` 的 pure-read 语义与动作白名单。
  - 明确当前 implementation-ready formal input 只接受 `execution_surface=real_browser`；`stub | fake_host | other` 不进入 Layer 4 baseline 输入。

### 阶段 B：稳定对象与数据模型冻结

- 产出：
  - `contracts/layer4-platform-behavior-baseline.md`
  - `data-model.md`
- 目标：
  - 冻结 `platform_behavior_signal_batch`、`platform_behavior_baseline_snapshot`、`platform_behavior_baseline_state`、`platform_behavior_assessment`。
  - 冻结 `baseline_state`、`drift_level`、`decision_hint` 枚举和最小必填字段，并完成 `target_domain/browser_channel/execution_surface/effective_execution_mode/probe_bundle_ref/goal_kind` 分区隔离；proxy binding 暂不纳入 implementation-ready formal 输入。
  - 冻结 `platform_behavior_signal_batch` 对 `FR-0020` 的 lineage keys：`request_ref`、`sample_ref`、`record_ref`。
  - 冻结 `platform_behavior_baseline_snapshot` 的 per-scope identity 与 `upstream_active_baseline_ref` 回链，避免把 shared upstream baseline 误当作 Layer 4 直接比较对象。
  - 冻结 reveal-only click 的保真字段，确保 `FR-0019` 的 `interaction_semantics` 与 `click_kind` 不在 Layer 4 汇总时丢失。
  - 冻结 `degraded` 与 `reseed_required` 的最小触发准则，使 freshness window、连续高漂移与污染场景都能直接形成实现断言。
  - 冻结 healthy write baseline 的非阻断 `decision_hint`，使 Layer 4 能表达“当前不额外加严”，而不是被迫退化为 hold/manual/reseed。
  - 冻结下载链路进入 Layer 4 前的 `goal_kind` 映射，避免把 `download` 另起为独立 Layer 4 goal 枚举。
  - 明确 `platform_behavior_baseline_state` 与 `platform_behavior_assessment` 的审计回放字段：`baseline_ref` 与 `threshold_config_snapshot_ref`。
  - 统一 `baseline_state` / `assessment` 的条件字段语义，避免 `ready_at`、`last_assessed_at`、`decision_id`、`audit_record_ref` 在 spec、contracts、data-model 之间漂移。

### 阶段 C：风险、审计与回滚冻结

- 产出：
  - `risks.md`
  - `TODO.md`
- 目标：
  - 明确假阳性、样本污染、跨 profile 污染、边界漂移等风险的缓解与回滚。
  - 明确实现前必须补齐的验证前置。

### 阶段 D：implementation-ready 准入收口

- 产出：
  - “进入实现前条件”审查结论
- 目标：
  - 保证 `FR-0020`（`#239`）已合入，且 Layer 4 所需共享验证输入已正式可达后再进入实现。

## 实现约束

1. 本 FR 只落规约文档，不提交运行时代码。  
2. 不得重定义 `FR-0010/0011` 风险状态机与审批审计真相源。  
3. 不得把 Layer 4 能力扩张成账号矩阵调度、养号运营、跨账号策略系统。  
4. 不得把 Layer 4 结果直接当作放行裁决，必须经既有门禁链路消费。  
5. 不得在本 FR 中混入 Layer 5、Camoufox 或 C++ 内核级方案承诺。  
6. 采集字段必须遵守数据最小化，不写入页面正文、私密输入明文或媒体内容。  
7. `goal_kind=read` 的采样必须继承 `FR-0019` pure-read 语义；出现 `type`、`submit`、`confirm`、`publish`、`purchase`、`dispatch`、`bind` 任一动作时不得继续标记为 `pure_read`。
8. 下载链路进入 Layer 4 前必须先映射到 `goal_kind=read|write`，不能把 `download` 冻结为独立 Layer 4 goal 枚举。

## 测试与验证策略

- 规约阶段门禁：
  - `bash scripts/docs-guard.sh`
  - `bash scripts/spec-guard.sh`
  - `git diff --check`
- 评审重点：
  - Layer 4 与 Layer 1/2/3 及门禁主链边界是否清晰
  - 状态枚举与对象字段是否足够稳定
  - 可写基线主键是否已收敛到 `(profile_ref, platform, target_domain, browser_channel, execution_surface, effective_execution_mode, probe_bundle_ref, goal_kind)`
  - suite 是否已明确未 canonical 的 proxy binding 不属于当前 implementation-ready formal 输入
  - `platform_behavior_signal_batch` 是否已携带 `FR-0020` lineage keys，而不是只靠 runtime 坐标回链
  - `target_domain` 是否已从 signal batch 继续保留到 baseline / assessment identity
  - `goal_kind=read|write` 是否已进入 baseline / assessment 隔离，避免读写历史混用
  - shared upstream scope 与 downstream writable scope 是否已被清晰拆分，不再把 `platform/target_domain` 误写成 `FR-0020` registry key
  - 是否已明确同一 `active_baseline_ref` 可被多个 domain/goal downstream scope 并行引用，但不会导致 downstream `platform_behavior_baseline_snapshot` / state / history 折叠
  - `platform_behavior_baseline_snapshot` 是否已与 `FR-0020` shared upstream ownership 正确拆层，而不是把 upstream `active_baseline_ref` 直接拿来充当 Layer 4 drift baseline
  - `goal_kind=write` 健康基线是否已具备非阻断 `decision_hint`，且该 hint 不被误写成 live write 自动放行
  - `platform_behavior_baseline_state` 是否已持久化 `threshold_config_snapshot_ref`
  - 当前 formal input 是否已明确只接受 `execution_surface=real_browser`
  - pure-read 场景中的 `click` 是否继续保留 `interaction_semantics=reveal_only_click` 与 `click_kind`
  - 冷启动/学习期/降级/reseed 语义是否可直接写成实现断言
  - 下载链路进入 Layer 4 前的 `goal_kind` 映射是否已与 pure-read / write 边界保持一致
- 实现前验证前置（由后续 PR 承担）：
  - 样本完整性阈值可复核
  - 漂移等级阈值可解释
  - 决策建议与门禁消费链可追溯

## TDD 范围

- 后续实现 PR 默认先写测试：
  - 基线状态迁移逻辑
  - downstream `platform_behavior_baseline_snapshot` 生成与绑定逻辑
  - 漂移等级判定逻辑
  - 决策建议映射逻辑
  - healthy write baseline 的非阻断 `decision_hint` 映射
  - 基线数据隔离（profile_ref/platform/target_domain/browser_channel/execution_surface/effective_execution_mode/probe_bundle_ref/goal_kind 维度）
  - proxy binding 在上游 canonical contract 落地前不会被误当作当前 formal 必填输入的约束
  - `FR-0020` lineage keys 到 Layer 4 signal batch 的回链约束
  - pure-read click 语义与 `click_kind` 的保真约束
  - 审计对象生成与回链
- 不在本 FR 强制 TDD：
  - 真实平台长期运营实验
  - 跨月行为样本统计稳定性

## 并行 / 串行关系

### 串行前置

- `FR-0022` spec review 未通过前，不进入 Layer 4 实现 PR。
- `FR-0020`（`#239`）未合入，或尚未提供 Layer 4 可消费的正式共享验证输入前，不进入 implementation-ready。
- 若需要扩展 `FR-0010/0011` 正式对象，必须先补充 spec review。

### 可并行

- Layer 4 指标阈值研究可与 `FR-0020`（`#239`）并行推进；若后续需要把阈值、假阳性/漏报口径升级为正式共享契约，应再进入独立 spec review。
- 数据保留策略细化可与实现设计并行，但最终以本 FR 冻结对象为准。

### 串行后置

- Layer 4 的任何自动化决策路径进入生产前，必须先完成：
  - 对 `decision_hint` 的门禁消费验收
  - 假阳性回滚演练

## 进入实现前条件

1. `FR-0022` spec review 通过且无阻断项。
2. reviewer 确认 Layer 4 未越界到账号运营系统。
3. reviewer 确认 Layer 4 不直接改写门禁真相源。
4. `contracts/` 与 `data-model.md` 被确认足以支撑实现与测试。
5. `FR-0020`（`#239`）已合入，且至少冻结：
  - Layer 4 可消费的 `anti_detection_validation_request`
  - Layer 4 可消费的 `anti_detection_structured_sample`
  - Layer 4 可消费的 `anti_detection_baseline_snapshot`
  - Layer 4 可消费的 `anti_detection_baseline_registry_entry`
  - Layer 4 可消费的 `anti_detection_validation_record`
  - `validation_scope=cross_layer_baseline` 作为 Layer 4 唯一正式输入入口
  - `FR-0019.risk_gate_context.target_domain` 已在 Layer 4 baseline identity 中被保留
  - `profile_ref`、`target_domain`、`effective_execution_mode` 与 `probe_bundle_ref` 继续作为 Layer 4 baseline identity 的正式 scope keys
  - 当前 formal input 已明确收紧到 `execution_surface=real_browser`
6. 后续实现 PR 必须明确：
  - 持久化落点
  - 审计落点
  - 回滚开关
  - 与 `FR-0010/0011/0014` 的兼容策略
