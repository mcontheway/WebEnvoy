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
