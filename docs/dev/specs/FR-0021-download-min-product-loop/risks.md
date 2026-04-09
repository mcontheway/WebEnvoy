# FR-0021 风险与回滚

## 风险 1：把下载做成模型外特例

- 表现：下载另起请求壳、结果壳或验证协议
- 缓解：强制复用 `FR-0007/0017/0018`，并冻结 `download_ability_request -> params.input`、`download_result_summary -> summary.capability_result` 映射
- 回滚：删去平行协议，回到统一能力模型

## 风险 2：只返回 URL 不落盘

- 表现：系统宣称下载成功，但没有本地产物或 artifact 引用
- 缓解：把 `resolved_output_path`、`source_url`、`file_name_hint` 设为成功态必备字段，并将 `saved_artifact_refs` 明确为可选 run-scoped evidence refs
- 回滚：未满足最小落盘条件的结果只允许标为失败或部分成功

## 风险 3：覆盖已有文件导致不可逆结果

- 表现：`replace_existing` 被默认启用
- 缓解：明确其为高风险路径，后续实现必须显式审计
- 回滚：退回 `fail_if_exists` 或 `rename_with_suffix`
