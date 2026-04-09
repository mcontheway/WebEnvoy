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
- `baseline_ref`
- `result_state`
- `drift_state`
- `failure_class`
- `run_id`
- `validated_at`

### `anti_detection_validation_view`

- `target_fr_ref`
- `validation_scope`
- `latest_record_ref`
- `baseline_status`
- `current_result_state`
- `current_drift_state`
- `last_success_at`

## 契约约束

- baseline snapshot 不得仅以自由文本或 issue comment 充当正式载体。
- validation record 不得替代 `FR-0016` 的 PR 级 gate 对象。
- Layer 4 只能消费本契约对象，不得借此引入长期运营系统对象。
