# FR-0020 TODO

- [ ] 将 `#239` 从“横切主线 issue”收口为 canonical FR 容器
- [ ] reviewer 确认 baseline snapshot 与 validation record 已清楚分离
- [ ] reviewer 确认 `effective_execution_mode` 已进入共享 baseline key，`dry_run/recon/live` 不会混用
- [ ] reviewer 确认 `sample_ref` 的正式归属对象已冻结为 `anti_detection_structured_sample`
- [ ] reviewer 确认 baseline replacement 的唯一真相源已冻结为 `anti_detection_baseline_registry_entry`
- [ ] reviewer 确认 validation record 已携带完整作用域键
- [ ] reviewer 确认 `baseline_status` 的 closed enum 语义已冻结
- [ ] reviewer 确认与 `FR-0015` / `FR-0016` 的边界无冲突
- [ ] spec review 通过并形成明确结论
- [ ] 后续实现 Work Item 命名与 ownership 建议冻结

## Handoff

- 当前阶段只冻结规约，不承诺实现代码。
- 后续实现应优先消费本 FR 的：
  - `anti_detection_validation_request`
  - `anti_detection_structured_sample`
  - `anti_detection_baseline_snapshot`
  - `anti_detection_validation_record`
  - `anti_detection_validation_view`
