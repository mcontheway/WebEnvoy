# FR-0020 反风控验证与基线评估

## 背景

`anti-detection.md` 已经明确 Layer 3/4 是 WebEnvoy 的核心差异化方向，但当前仓库仍缺少一套正式冻结的“验证与基线评估”契约。`#239` 现在承担的是横切主线 issue，而不是正式 FR 容器，这会导致以下问题继续混在一起：

- live 试验结果
- 反风控能力是否成立的最小判断
- 基线样本如何采集、保存与比较
- `FR-0012`、`FR-0013`、`FR-0014` 与后续 Layer 4 能力如何共享同一套验证方法

因此，本 FR 以 `#239` 为 canonical FR 容器，负责冻结“反风控验证与基线评估”的最小正式边界，让验证不再依赖零散 live 试验和口头判断。

## 目标

1. 冻结反风控验证请求、验证记录与基线快照的最小对象边界。
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
  - `validation_scope`
  - `target_fr_ref`
  - `profile_ref`
  - `browser_channel`
  - `execution_surface`
  - `sample_goal`
  - `probe_bundle_ref`
- `validation_scope` 至少支持：
  - `layer1_consistency`
  - `layer2_interaction`
  - `layer3_session_rhythm`
  - `cross_layer_baseline`
- 必须明确：
  - 当前 formal baseline 下，`target_fr_ref` 只允许命中 `FR-0012`、`FR-0013`、`FR-0014` 或后续 Layer 4 FR
  - `execution_surface` 只描述样本采集执行面，不等于 `FR-0016` 的 merge gate verdict
  - `sample_goal` 只描述本次验证目标，不承载产品功能请求
  - `probe_bundle_ref` 必须指向稳定、可复用的最小探针集合，而不是一次性手工步骤

### 3. 基线快照与验证记录

- 必须冻结 `anti_detection_baseline_snapshot`，至少包含：
  - `baseline_ref`
  - `validation_scope`
  - `profile_ref`
  - `browser_channel`
  - `execution_surface`
  - `signal_vector`
  - `captured_at`
  - `source_run_ids`
- 必须冻结 `anti_detection_validation_record`，至少包含：
  - `record_ref`
  - `target_fr_ref`
  - `validation_scope`
  - `baseline_ref`
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
  - baseline snapshot 与 validation record 是两类对象，不得混写成同一条 run 日志
  - `signal_vector` 必须是结构化信号集合，不得退化为自由文本摘要
  - `failure_class` 只在 `result_state=broken` 时必填；成功态必须为空

### 4. 最小共享视图

- 必须冻结 `anti_detection_validation_view`，至少包含：
  - `target_fr_ref`
  - `validation_scope`
  - `latest_record_ref`
  - `baseline_status`
  - `current_result_state`
  - `current_drift_state`
  - `last_success_at`
- 必须明确：
  - 该视图是面向 reviewer、实现 PR 与后续诊断链路的最小共享视图
  - 它不替代 `FR-0016` 的 PR 级 `live_evidence_record`
  - 它也不等于最终的账号健康度或平台长期评分

### 5. 与 Layer 4 的边界

- 本 FR 必须明确：
  - Layer 4 平台行为模型消费本 FR 的 baseline snapshot 与 validation record
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

## 异常与边界场景

1. 只有一次 live 试验截图，没有 `signal_vector` 或 `source_run_ids`：不得视为 baseline。
2. `target_fr_ref` 指向 `FR-0016`、`FR-0015` 或其他非反风控能力 FR：视为范围越界。
3. `anti_detection_validation_view` 被直接当成 PR merge gate：视为与 `FR-0016` 边界冲突。
4. baseline snapshot 只保存自由文本结论，不保存结构化信号：视为契约未冻结。
5. Layer 4 需求被直接塞入账号健康、长期养号或运营系统：视为越过当前产品边界。

## 验收标准

1. FR-0020 套件完整，至少包含 `spec.md`、`plan.md`、`TODO.md`、`contracts/`、`data-model.md`、`research.md`、`risks.md`。
2. 已冻结验证请求、baseline snapshot、validation record 与共享视图的最小边界。
3. 已明确 `FR-0012/0013/0014` 与后续 Layer 4 的共享方式。
4. 已明确与 `FR-0016`、`FR-0015` 的边界，不混入 PR 门禁或 runtime 主链。
5. 本 PR 只冻结规约，不混入实现代码。

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
