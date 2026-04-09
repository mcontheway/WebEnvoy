# FR-0020 数据模型

本 FR 不新增最终运行时 schema，但需要冻结共享对象语义。

## 持久化与派生边界

- **持久化实体**：`AntiDetectionValidationRequest`、`AntiDetectionBaselineSnapshot`、`AntiDetectionValidationRecord`。
- **派生视图**：`AntiDetectionValidationView` 仅由持久化实体投影得到，不作为事实来源写回或复用为 gate 依据。

## 1. `AntiDetectionValidationRequest`

- `validation_scope`
- `target_fr_ref`
- `profile_ref`
- `browser_channel`
- `execution_surface`
- `sample_goal`
- `probe_bundle_ref`

`validation_scope=cross_layer_baseline` 是唯一 Layer 4 编码入口，仅用于跨 Layer 1-3 信号聚合后的基线评估。

## 2. `AntiDetectionBaselineSnapshot`

- `baseline_ref`
- `validation_scope`
- `profile_ref`
- `browser_channel`
- `execution_surface`
- `signal_vector`
- `captured_at`
- `source_run_ids`

### 不可变与替换规则

- `baseline_ref` 是不可变的快照标识，不允许复写或复用。
- 若生成新的基线，应创建新的 `baseline_ref`；旧快照通过外部基线索引标记为 `superseded`，但快照内容不得变更。
- 引用已 `superseded` 的 `baseline_ref` 的验证记录应进入 `stale` 或 `insufficient_baseline` 语义范围（见下文）。

## 3. `AntiDetectionValidationRecord`

- `record_ref`
- `target_fr_ref`
- `validation_scope`
- `baseline_ref`
- `result_state`
- `drift_state`
- `failure_class`
- `run_id`
- `validated_at`

### 状态语义

- `result_state=captured`：已持久化样本但尚未完成有效对比，`drift_state` 必须为 `insufficient_baseline`。
- `result_state=verified`：已完成对比且无偏离，`drift_state` 必须为 `no_drift`。
- `result_state=broken`：对比失败或验证流程不可通过，`failure_class` 必填，`drift_state` 为 `drift_detected` 或 `insufficient_baseline`。
- `result_state=stale`：记录因基线被替换、时间窗过期或关键样本缺失而失效，`drift_state` 必须为 `insufficient_baseline`。

### `baseline_ref` 绑定规则

- 当记录引用了可用 baseline 并完成对比时，`baseline_ref` 必填且一经写入不得改写。
- 当 `drift_state=insufficient_baseline` 且当前不存在可用 baseline 时，`baseline_ref` 允许为空。
- 当记录因原基线已 `superseded` 而进入 `stale` 语义时，必须保留原 `baseline_ref`，不得清空。

## 4. `AntiDetectionValidationView`

- `target_fr_ref`
- `validation_scope`
- `profile_ref`
- `browser_channel`
- `execution_surface`
- `latest_record_ref`
- `baseline_status`
- `current_result_state`
- `current_drift_state`
- `last_success_at`

### 派生规则

- 当 `latest_record_ref` 指向的记录为 `stale` 或其 `baseline_ref` 已 `superseded`，视图应将 `current_result_state` 置为 `stale`，并将 `current_drift_state` 置为 `insufficient_baseline`。
- 当目标 scope 不存在可用基线或样本覆盖不足时，视图应将 `baseline_status` 标记为 `insufficient`，并将 `current_drift_state` 置为 `insufficient_baseline`。

## 约束

- baseline snapshot 与 validation record 不得共用同一对象。
- `target_fr_ref` 只允许指向反风控能力 FR。
- 本 FR 的对象只承载能力级验证，不承载 PR 级 merge gate。
