# FR-0020 反风控验证与基线评估

Canonical Issue: #239

## 背景

`anti-detection.md` 已经明确 Layer 3/4 是 WebEnvoy 的核心差异化方向，但当前仓库仍缺少一套正式冻结的“验证与基线评估”契约。`#239` 现在承担的是横切主线 issue，而不是正式 FR 容器，这会导致以下问题继续混在一起：

- live 试验结果
- 反风控能力是否成立的最小判断
- 基线样本如何采集、保存与比较
- `FR-0012`、`FR-0013`、`FR-0014` 与后续 Layer 4 能力如何共享同一套验证方法

因此，本 FR 以 `#239` 为 canonical FR 容器，负责冻结“反风控验证与基线评估”的最小正式边界，让验证不再依赖零散 live 试验和口头判断。

## 目标

1. 冻结反风控验证请求、验证记录、基线快照与基线权威索引的最小对象边界。
2. 明确 `FR-0012`、`FR-0013`、`FR-0014` 如何共享同一套验证与基线评估输入。
3. 定义“已收集样本”“已形成 baseline”“已发现漂移”的最小正式语义。
4. 为后续 Layer 4 平台行为模型提供可复用的验证输入，而不是临时日志。
5. 为后续实现 PR、review 与 GitHub Work Item 提供 implementation-ready 的正式输入。

## 非目标

- 不在本 FR 内承诺真实 live evidence 已经齐备。
- 不重定义 `FR-0016` 的 reviewer / guardian / PR 门禁语义。
- 不把 `FR-0015` official Chrome runtime migration 的安装、bootstrap 或 readiness 对象混入本 FR。
- 不在本 FR 内实现完整账号健康系统、长期养号系统或跨平台运营系统。
- 不在本 FR 内混入实现代码。

## 功能需求

### 1. Phase 与继承边界

- 本 FR 归属 `Phase 2`，以 `#239` 作为 canonical FR 容器。
- 本 FR 必须显式服务以下正式 FR：
  - `FR-0012`
  - `FR-0013`
  - `FR-0014`
  - 后续 Layer 4 平台行为模型 FR
- 本 FR 必须显式继承以下既有边界：
  - `FR-0004` 的最小诊断与结构化错误边界
  - `FR-0006` 的运行记录与证据引用边界
  - `FR-0016` 的 PR / review 门禁边界
- 本 FR 只冻结验证与 baseline 评估对象，不承接 runtime 主链、安装分发、live merge 门禁或能力交付协议。

### 2. 最小验证请求对象

- 必须冻结 `anti_detection_validation_request`，至少包含：
  - `request_ref`
  - `validation_scope`
  - `target_fr_ref`
  - `profile_ref`
  - `browser_channel`
  - `execution_surface`
  - `sample_goal`
  - `requested_execution_mode`
  - `probe_bundle_ref`
  - `request_state`
  - `requested_at`
- `validation_scope` 至少支持：
  - `layer1_consistency`
  - `layer2_interaction`
  - `layer3_session_rhythm`
  - `cross_layer_baseline`（Layer 4 平台行为基线的唯一编码，跨 Layer 1-3 统一聚合信号）
- `validation_scope × target_fr_ref` 的合法组合至少冻结为：
  - `layer1_consistency -> FR-0012`
  - `layer2_interaction -> FR-0013`
  - `layer3_session_rhythm -> FR-0014`
  - `cross_layer_baseline -> 后续 Layer 4 FR`
- 必须明确：
  - `request_ref` 是 validation request 的稳定标识；即使参数元组完全相同，不同请求也必须使用不同 `request_ref`
  - 当前 formal baseline 下，`target_fr_ref` 只允许命中 `FR-0012`、`FR-0013`、`FR-0014` 或后续 Layer 4 FR
  - 不合法的 `validation_scope × target_fr_ref` 组合必须在 request 阶段直接阻断，不得进入 sample / baseline / record
  - `execution_surface` 只描述样本采集执行面，不等于 `FR-0016` 的 merge gate verdict
  - `sample_goal` 只描述本次验证目标，不承载产品功能请求
  - `requested_execution_mode` 继承 `FR-0010/0011` 已冻结的 execution mode 语义；本 FR 不并行发明私有模式
  - `probe_bundle_ref` 必须指向稳定、可复用的最小探针集合，而不是一次性手工步骤
  - `request_state` 至少支持：
    - `accepted`
    - `sampling`
    - `completed`
    - `aborted`
  - `request_state` 只允许单向推进，不得从终态回退

### 3. 基线快照、基线权威索引与验证记录

- 必须冻结 `anti_detection_structured_sample`，至少包含：
  - `sample_ref`
  - `request_ref`
  - `target_fr_ref`
  - `validation_scope`
  - `profile_ref`
  - `browser_channel`
  - `execution_surface`
  - `effective_execution_mode`
  - `probe_bundle_ref`
  - `run_id`
  - `captured_at`
  - `structured_payload`
  - `artifact_refs`
- 必须冻结 `anti_detection_baseline_snapshot`，至少包含：
  - `baseline_ref`
  - `target_fr_ref`
  - `validation_scope`
  - `probe_bundle_ref`
  - `profile_ref`
  - `browser_channel`
  - `execution_surface`
  - `effective_execution_mode`
  - `signal_vector`
  - `captured_at`
  - `source_sample_refs`
  - `source_run_ids`
- 必须冻结 `anti_detection_baseline_registry_entry`，至少包含：
  - `target_fr_ref`
  - `validation_scope`
  - `profile_ref`
  - `browser_channel`
  - `execution_surface`
  - `effective_execution_mode`
  - `probe_bundle_ref`
  - `active_baseline_ref`
  - `superseded_baseline_refs`
  - `replacement_reason`
  - `updated_at`
- 必须冻结 `anti_detection_validation_record`，至少包含：
  - `record_ref`
  - `request_ref`
  - `target_fr_ref`
  - `validation_scope`
  - `profile_ref`
  - `browser_channel`
  - `execution_surface`
  - `effective_execution_mode`
  - `probe_bundle_ref`
  - `sample_ref`
  - `baseline_ref`（存在可用 baseline 时必填；`drift_state=insufficient_baseline` 且当前无可用 baseline 时允许为空）
  - `result_state`
  - `drift_state`
  - `failure_class`
  - `run_id`
  - `validated_at`
- `result_state` 至少支持：
  - `captured`
  - `verified`
  - `broken`
  - `stale`
- `drift_state` 至少支持：
  - `no_drift`
  - `drift_detected`
  - `insufficient_baseline`
- 必须明确：
  - `anti_detection_structured_sample` 是 `sample_ref` 的唯一正式归属对象；下游 FR 不得把它各自解释成私有日志、截图集合或自由文本摘要
  - `structured_payload` 必须是可重放、可比对、可诊断的最小结构化样本；`artifact_refs` 只作为原始证据引用，不替代结构化 payload 本身
  - `anti_detection_structured_sample.request_ref` 与 `anti_detection_validation_record.request_ref` 必须回链到同一条 `anti_detection_validation_request`
  - baseline snapshot 与 validation record 是两类对象，不得混写成同一条 run 日志
  - `anti_detection_baseline_registry_entry` 是 baseline replacement 的唯一正式真相源；baseline snapshot 本身不得自带“当前生效”或 `superseded` 的可写状态
  - `effective_execution_mode` 继承 `FR-0010/0011` 的正式语义，并作为 baseline/sample/record/view 的共享分区维度；不得把 `dry_run`、`recon` 与任意 live 模式落入同一 baseline scope
  - `probe_bundle_ref` 是 baseline/sample/record/view 的正式分区维度；不同 probe bundle 默认不得复用同一 baseline scope
  - `anti_detection_validation_record` 必须携带 `(target_fr_ref, validation_scope, profile_ref, browser_channel, execution_surface, effective_execution_mode, probe_bundle_ref)` 的完整作用域键；不得把正确归属只留给 `sample_ref` 或 `baseline_ref` 间接推断
  - 只有当同一 `(target_fr_ref, validation_scope, profile_ref, browser_channel, execution_surface, effective_execution_mode, probe_bundle_ref)` 作用域下的 `active_baseline_ref` 被切换到新的 `baseline_ref` 时，旧 baseline 才进入 `superseded` 语义
  - `sample_ref` 必须指向已持久化的结构化样本载体，并在 `captured|verified|broken|stale` 全部终态中保留；不得在完成态丢失 replay / compare / diagnose 所需的样本引用
  - `source_sample_refs` 必须记录形成 baseline snapshot 所消费的结构化样本集合，`source_run_ids` 只作为补充审计引用
  - `probe_bundle_ref` 必须随 baseline snapshot 与 validation record 一起持久化，不能只停留在 request 输入侧
  - `signal_vector` 必须是结构化信号集合，不得退化为自由文本摘要
  - `failure_class` 只在 `result_state=broken` 时必填；成功态必须为空
  - `browser_channel`、`execution_surface`、`profile_ref` 必须使用唯一 canonical encoding；当前 formal baseline 下分别由 `FR-0015`（browser identity binding）、`FR-0016`（execution_surface 枚举）与稳定 profile namespace 负责归一化

### 4. 最小共享视图

- 必须冻结 `anti_detection_validation_view`，至少包含：
  - `target_fr_ref`
  - `validation_scope`
  - `profile_ref`
  - `browser_channel`
  - `execution_surface`
  - `effective_execution_mode`
  - `probe_bundle_ref`
  - `latest_record_ref`
  - `baseline_status`
  - `current_result_state`
  - `current_drift_state`
  - `last_success_at`
- `baseline_status` 至少支持：
  - `ready`：当前作用域存在 active baseline，且 latest record 未指向已被替换的 baseline
  - `insufficient`：当前作用域不存在可用 active baseline，或样本覆盖不足以形成有效对比
  - `superseded`：latest record 绑定的 baseline 已不再是当前 active baseline
- 必须明确：
  - 该视图是面向 reviewer、实现 PR 与后续诊断链路的最小共享视图
  - 该视图必须由 baseline snapshot、baseline registry entry 与 validation record 共同投影；不得把任一单独对象误当成完整真相源
  - `baseline_status` 是 closed enum；下游 FR 不得各自扩写私有取值或重新解释兼容性
  - `anti_detection_validation_view` 只在首条 `anti_detection_validation_record` 生成后才允许物化；empty scope 或“只有 request/sample 尚无 record”的阶段不得伪造 view 行
  - 它不替代 `FR-0016` 的 PR 级 `live_evidence_record`
  - 它也不等于最终的账号健康度或平台长期评分

### 5. 共享契约 ownership 与兼容性

- 本 FR 必须明确：
  - `FR-0020` 独占 `anti_detection_validation_request`、`anti_detection_structured_sample`、`anti_detection_baseline_snapshot`、`anti_detection_baseline_registry_entry`、`anti_detection_validation_record`、`anti_detection_validation_view` 的正式 ownership
  - 下游 `FR-0012`、`FR-0013`、`FR-0014` 与后续 Layer 4 FR 只能消费这些共享对象，不得各自重定义同名字段、枚举或空值语义
  - `contracts/anti-detection-validation.md` 必须冻结对象字段的必填/可空规则、状态枚举、条件字段与最小兼容 payload 示例
  - 共享对象新增字段时，只允许新增向后兼容的可选字段，并且必须在同一 spec review PR 内同步更新 `spec.md`、`contracts/` 与 `data-model.md`
  - 共享对象若要修改既有字段语义、收紧/放宽枚举、或改变必填/可空规则，必须作为 breaking change 重新进入 spec review，不允许静默漂移

### 6. 与 Layer 4 的边界

- 本 FR 必须明确：
  - Layer 4 平台行为模型消费本 FR 的 baseline snapshot 与 validation record
  - `validation_scope=cross_layer_baseline` 是唯一 Layer 4 编码入口，仅用于跨 Layer 1-3 的基线聚合与评估，不承载 Layer 4 模型本体输出
  - 本 FR 不定义 Layer 4 的长期行为模型本体
  - 本 FR 不得提前冻结跨 session 的运营策略、账号人格或长期分群对象

## GWT 验收场景

### 场景 1：Layer 1/2/3 可以共享同一套验证对象

Given `FR-0012`、`FR-0013`、`FR-0014` 都需要验证与 baseline 评估
When reviewer 检查本 FR 的正式对象
Then 能看到统一的 `anti_detection_validation_request`
And 不需要为每个 Layer 再建第二套验证协议

### 场景 2：baseline 与 validation record 被清楚分开

Given 一次样本采集已经发生
When reviewer 检查本 FR 的对象边界
Then 能明确区分 baseline snapshot 与 validation record
And 不会把单次 run 日志误写成长期 baseline

### 场景 3：漂移可以被结构化表达

Given 某条能力当前行为与已冻结 baseline 不再一致
When 系统回传验证结果
Then `drift_state` 会明确表达是否发生漂移
And 不需要依赖自由文本说明

### 场景 4：Layer 4 可复用而不越界

Given 后续需要建立 Layer 4 平台行为模型
When reviewer 检查本 FR 的边界
Then 能明确看到 Layer 4 可以复用 baseline 与 validation record
And 本 FR 没有提前承诺 Layer 4 本体对象

### 场景 5：baseline replacement 的真相源唯一

Given 同一验证作用域下生成了新的 baseline
When reviewer 检查本 FR 的正式对象
Then 能看到 `anti_detection_baseline_registry_entry` 是唯一的 active/superseded 判定来源
And baseline snapshot 本身不会被原地改写成另一条基线

### 场景 6：不同 execution mode 不混用同一 baseline

Given 同一 profile 与浏览器 surface 既跑过 `recon` 也跑过受控 live
When reviewer 检查本 FR 的共享 key
Then 能看到 `effective_execution_mode` 是 baseline/sample/record/view 的正式分区维度
And `dry_run`、`recon` 与 live 证据不会落入同一条 baseline

### 场景 7：共享视图的 baseline_status 语义闭合

Given 下游 `FR-0012/0013/0014` 需要直接消费共享视图
When reviewer 检查 `anti_detection_validation_view`
Then 能看到 `baseline_status` 的允许取值与兼容性规则已经冻结
And 下游 FR 不需要各自发明新的状态枚举

## 异常与边界场景

1. 只有一次 live 试验截图，没有 `signal_vector` 或 `source_run_ids`：不得视为 baseline。
2. `target_fr_ref` 指向 `FR-0016`、`FR-0015` 或其他非反风控能力 FR：视为范围越界。
3. `anti_detection_validation_view` 被直接当成 PR merge gate：视为与 `FR-0016` 边界冲突。
4. baseline snapshot 只保存自由文本结论，不保存结构化信号：视为契约未冻结。
5. `sample_ref` 只指向截图、issue comment 或自由文本，没有正式 `anti_detection_structured_sample`：视为共享输入未冻结。
6. 通过 snapshot、record 或自由文本直接宣布某条 baseline 已被替换，但未更新 `anti_detection_baseline_registry_entry`：视为真相源冲突。
7. `dry_run`、`recon` 与 live 证据被落入同一 baseline scope：视为 execution mode 维度缺失。
8. `anti_detection_validation_record` 缺少完整作用域键，需要依赖外部对象才能归属到正确 baseline scope：视为共享对象未冻结完整。
9. `baseline_status` 没有 closed enum 而被下游 FR 各自扩写：视为共享视图语义失控。
10. Layer 4 需求被直接塞入账号健康、长期养号或运营系统：视为越过当前产品边界。

## 验收标准

1. FR-0020 套件完整，至少包含 `spec.md`、`plan.md`、`TODO.md`、`contracts/`、`data-model.md`、`research.md`、`risks.md`。
2. 已冻结验证请求、structured sample、baseline snapshot、baseline registry entry、validation record 与共享视图的最小边界。
3. 已明确 `FR-0012/0013/0014` 与后续 Layer 4 的共享方式。
4. 已明确 baseline replacement 的唯一正式真相源，以及 `stale/superseded` 的判定来源。
5. 已明确 `requested_execution_mode/effective_execution_mode` 的继承关系与 baseline 分区边界。
6. 已明确 validation record 的完整作用域键与 `baseline_status` 的 closed enum 语义。
7. 已明确与 `FR-0016`、`FR-0015` 的边界，不混入 PR 门禁或 runtime 主链。
8. 本 PR 只冻结规约，不混入实现代码。

## 依赖与前置条件

- GitHub 事项：
  - `#239` canonical FR 容器
- 上游 FR：
  - `FR-0004`
  - `FR-0006`
  - `FR-0012`
  - `FR-0013`
  - `FR-0014`
  - `FR-0016`
