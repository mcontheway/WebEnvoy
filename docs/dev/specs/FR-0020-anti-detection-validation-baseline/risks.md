# FR-0020 风险与回滚

## 风险 1：把 PR 门禁与能力级验证混为一谈

- 表现：`anti_detection_validation_view` 被直接当成 merge gate
- 缓解：明确由 `FR-0016` 继续独占 PR 级门禁语义
- 回滚：删除越界字段，回到能力级对象

## 风险 2：baseline 退化成自由文本结论

- 表现：只有截图、评论或 issue comment，没有结构化信号向量
- 缓解：要求 `signal_vector`、`source_run_ids`、`captured_at` 为 baseline 最小必填
- 回滚：未满足结构化条件的样本只保留为原始 evidence，不升格为 baseline

## 风险 3：Layer 4 范围被提前混入长期运营系统

- 表现：行为模型被直接扩张到养号、运营、评分或配额系统
- 缓解：明确 Layer 4 只承接平台行为模型与长期基线，不进入上层运营系统
- 回滚：将越界内容拆回后续独立事项

## 风险 4：baseline replacement 出现第二真相源

- 表现：snapshot、record、issue comment 或自由文本与 registry entry 对 active baseline 的判定不一致
- 缓解：明确只有 `AntiDetectionBaselineRegistryEntry` 可以声明 active/superseded baseline；其余对象只能引用和投影
- 回滚：撤销带外声明，仅保留 registry entry 的正式判定，再重算视图

## 风险 5：不同 execution mode 的证据被混入同一 baseline

- 表现：`dry_run`、`recon` 与 live 证据共享同一 baseline key，导致后续对比和诊断结果失真
- 缓解：把 `effective_execution_mode` 纳入 sample / baseline / view 的正式分区维度，并继承 `FR-0010/0011` 的 mode 语义
- 回滚：按 execution mode 重建 baseline 分区，废弃混合快照

## 风险 6：`sample_ref` 指向的样本对象缺少统一 payload

- 表现：不同下游 FR 各自把 `sample_ref` 解释为截图、临时日志或私有 JSON，导致 replay、比对与诊断失去统一输入
- 缓解：冻结 `AntiDetectionStructuredSample` 的最小字段和 ownership，要求 `structured_payload` 为正式承载
- 回滚：拒绝消费不符合正式样本结构的记录，只保留原始 evidence

## 风险 7：validation record 无法被确定性归入正确 scope

- 表现：record 缺少 profile/browser/surface 等作用域键，只能依赖 `baseline_ref` 或 `sample_ref` 间接归属，导致 latest view 漂移
- 缓解：要求 `AntiDetectionValidationRecord` 自身携带完整作用域键
- 回滚：拒绝消费缺键记录，回退到仅保留原始 evidence

## 风险 8：`baseline_status` 被下游 FR 各自扩写

- 表现：共享视图的 `baseline_status` 没有 closed enum，`FR-0012/0013/0014` 为同一字段各自发明不同取值
- 缓解：把 `baseline_status` 冻结为 `ready | insufficient | superseded`，并要求新增取值必须重新走 spec review
- 回滚：移除未冻结状态，回到正式枚举集合
