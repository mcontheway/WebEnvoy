# FR-0020 契约：反风控验证与基线评估

## 对象

### `anti_detection_validation_request`

- `validation_scope`
- `target_fr_ref`
- `profile_ref`
- `browser_channel`
- `execution_surface`
- `sample_goal`
- `probe_bundle_ref`

### `anti_detection_baseline_snapshot`

- `baseline_ref`
- `validation_scope`
- `probe_bundle_ref`
- `profile_ref`
- `browser_channel`
- `execution_surface`
- `signal_vector`
- `captured_at`
- `source_run_ids`

### `anti_detection_validation_record`

- `record_ref`
- `target_fr_ref`
- `validation_scope`
- `probe_bundle_ref`
- `sample_ref`
- `baseline_ref`
- `result_state`
- `drift_state`
- `failure_class`
- `run_id`
- `validated_at`

### `anti_detection_validation_view`

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

## 契约约束

- `validation_scope=cross_layer_baseline` 是唯一 Layer 4 编码入口，仅用于跨 Layer 1-3 信号聚合后的基线评估，不承载 Layer 4 模型本体输出。
- baseline snapshot 不得仅以自由文本或 issue comment 充当正式载体。
- validation record 不得替代 `FR-0016` 的 PR 级 gate 对象。
- Layer 4 只能消费本契约对象，不得借此引入长期运营系统对象。

## 状态机语义

### `result_state`

- `captured`：已完成采样并持久化 `sample_ref` 指向的结构化样本，但尚未完成基线对比或基线不足；此时 `drift_state` 必须为 `insufficient_baseline`，`failure_class` 为空。
- `verified`：基线对比已完成且在容差内；此时 `drift_state` 必须为 `no_drift`，`failure_class` 必须为空。
- `broken`：基线对比已完成且判定失败，或验证流程确认不可通过；此时 `failure_class` 必须填写，`drift_state` 必须为 `drift_detected` 或 `insufficient_baseline`。
- `stale`：记录因基线被替换、时间窗过期或关键样本缺失而失效；此时 `drift_state` 必须为 `insufficient_baseline`，`failure_class` 为空。

### `drift_state`

- `no_drift`：已完成基线对比且未发现偏离；只允许与 `result_state=verified` 同时出现。
- `drift_detected`：已完成基线对比且发现偏离；只允许与 `result_state=broken` 同时出现。
- `insufficient_baseline`：基线缺失、样本不足或基线已被替换导致无法给出有效对比；只允许与 `result_state=captured`、`result_state=stale` 或 `result_state=broken` 同时出现。

### `baseline_ref`

- 在存在可用 baseline 且验证已绑定该 baseline 时必须填写。
- 当 `drift_state=insufficient_baseline` 且当前不存在可用 baseline 时允许为空，不得伪造引用。
- 当记录因已有 baseline 被替换而进入 `stale` 语义时，应继续保留原 `baseline_ref` 以支持 superseded 判定。

### `sample_ref`

- `sample_ref` 必须引用已持久化的结构化样本载体，不得退化为 issue comment、自由文本摘要或临时控制台输出。
- 在 `result_state=captured` 时必须填写。
- 在 `result_state=verified/broken/stale` 时允许继续保留，用于追溯本次判定所依据的样本。

### `failure_class`

- 仅在 `result_state=broken` 时允许出现且必须填写。
- 在 `result_state=captured/verified/stale` 时必须为空。
