# FR-0021 TODO

- [ ] 将 `#153` 从 Phase 2 子级 issue 收口为 canonical FR 容器
- [ ] reviewer 确认下载能力已进入统一能力模型，不再是特例协议
- [ ] reviewer 确认最小落盘与冲突策略边界已冻结
- [ ] reviewer 确认 `download_ability_request` 已接纳 `direct_url`、`page_blob`、`page_derived` 三类输入，不再要求调用方预先提供最终 `target_url`
- [ ] reviewer 确认 `requested_execution_layer` 已与 `params.ability.layer` 冻结为严格相等，冲突输入会在 `input_validation` 阶段直接拒绝
- [ ] reviewer 确认 `page_blob` 已禁止 `blob_url-only`，并冻结 `blob_locator` 为浏览器执行面到 CLI 落盘的桥接定位点
- [ ] reviewer 确认 `requested_execution_layer` 与 `candidate_shell_seed.execution_layer_support` 已与 `FR-0017` 对齐为 `L1/L2/L3` 共享正式枚举（且未过度承诺 L1 已实现）
- [ ] reviewer 确认 `candidate_shell_seed` 已足以直接物化 `FR-0017.candidate_ability_descriptor` 的必填字段，并同时携带 descriptor-owned `contract_registry_seed`
- [ ] reviewer 确认 `destination_root` 已冻结为 CLI trusted download base 内的目标子目录，而不是任意宿主路径
- [ ] reviewer 确认下载失败统一走 `status=error + error.*`，不再挂到 `summary.capability_result`
- [ ] reviewer 确认 `source_url` 语义已覆盖 direct URL、`blob:`、页面执行后解析出的浏览器侧最终来源标识
- [ ] reviewer 确认 `download_result_summary` 已直接挂在 `summary.capability_result.download_result_summary`，不再依赖 opaque `data_ref`
- [ ] spec review 通过并形成明确结论
- [ ] 后续实现 Work Item ownership 与高风险路径切片冻结

## Handoff

- 当前阶段只冻结规约，不承诺实现代码。
- 后续实现优先消费：
  - `download_ability_request`
  - `download_result_summary`
  - `saved_artifact_refs`
  - `output_policy`
