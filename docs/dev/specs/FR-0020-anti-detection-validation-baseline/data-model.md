# FR-0020 数据模型

本 FR 不新增最终运行时 schema，但需要冻结共享对象语义。

## 1. `AntiDetectionValidationRequest`

- `validation_scope`
- `target_fr_ref`
- `profile_ref`
- `browser_channel`
- `execution_surface`
- `sample_goal`
- `probe_bundle_ref`

## 2. `AntiDetectionBaselineSnapshot`

- `baseline_ref`
- `validation_scope`
- `profile_ref`
- `browser_channel`
- `execution_surface`
- `signal_vector`
- `captured_at`
- `source_run_ids`

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

## 4. `AntiDetectionValidationView`

- `target_fr_ref`
- `validation_scope`
- `latest_record_ref`
- `baseline_status`
- `current_result_state`
- `current_drift_state`
- `last_success_at`

## 约束

- baseline snapshot 与 validation record 不得共用同一对象。
- `target_fr_ref` 只允许指向反风控能力 FR。
- 本 FR 的对象只承载能力级验证，不承载 PR 级 merge gate。
