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

## 风险 4：下载失败被挂入成功能力壳

- 表现：`summary.capability_result` 下继续承载 `failed` 下载结果，导致与 `FR-0007` 的成功/错误分层冲突
- 缓解：规定 `download_result_summary` 只承载 `downloaded|partial`，失败统一走 `status=error + error.*`
- 回滚：移除失败态成功壳映射，回到 FR-0007 单一错误承载

## 风险 5：把下载请求收窄为 direct-URL-only

- 表现：formal 请求对象要求调用方必须预先给出稳定 `target_url`，导致页内 `blob:` / 导出后解析路径无法进入正式输入
- 缓解：冻结 `download_source` 判别联合，显式覆盖 `direct_url`、`page_blob`、`page_derived`
- 回滚：撤销 direct-URL-only 约束，恢复浏览器内三类下载来源路径

## 风险 5.1：`page_blob` 只给 `blob_url`，却没有可落盘桥接

- 表现：formal 契约允许 `page_blob` 只提供 `blob_url`，实现即使合法满足契约，也无法在脱离来源页面上下文后把 Blob 内容落盘到 CLI trusted download base
- 缓解：冻结 `page_blob.blob_locator` 为必填桥接定位点；`blob_url` 只作为浏览器侧来源标识或审计线索
- 回滚：撤销 `blob_url-only` 语义，恢复“浏览器执行面先物化 Blob 内容，再交由 CLI 落盘”的单一路径

## 风险 6：下载执行层枚举与共享能力模型分叉

- 表现：`requested_execution_layer` 或 `candidate_shell_seed.execution_layer_support` 只允许 `L3/L2`，导致与 `FR-0017` 的 `L1/L2/L3` 正式枚举冲突
- 缓解：formal 契约统一保留 `L1/L2/L3`，并明确“保留枚举不等于本 FR 已承诺完成 L1 实现”
- 回滚：将分叉枚举回滚到共享正式枚举并重审 suite 内所有相关字段

## 风险 6.1：`requested_execution_layer` 与 `ability.layer` 冲突

- 表现：调用对象同时携带 `params.ability.layer` 与 `download_ability_request.requested_execution_layer`，但 formal 契约没有冻结两者关系，导致实现方各自猜测谁是权威执行层
- 缓解：冻结 `params.ability.layer` 为权威 invocation layer；`requested_execution_layer` 仅作镜像字段，且必须与之严格相等；冲突输入统一在 `input_validation` 阶段拒绝
- 回滚：撤销模糊双字段语义，恢复单一权威执行层表达

## 风险 7：`source_url` 被误写为调用方预填稳定 URL

- 表现：结果对象沿用“请求时已知 URL”假设，无法审计 `blob:` 或页面执行后才解析出的真实下载来源
- 缓解：冻结 `source_url` 为“本次下载最终使用的浏览器侧 source identity”，允许 direct URL、`blob:` URL、页面执行后解析来源
- 回滚：废弃“预填稳定 URL”语义，按运行时最终来源重新定义并校验结果字段

## 风险 8：调用方可借 `destination_root` 指向任意宿主路径

- 表现：`destination_root` 被解释为任意宿主绝对路径，下载实现可写入 CLI 进程可访问的任意位置
- 缓解：冻结 `destination_root` 为 CLI trusted download base 内的目标子目录；绝对路径、`..`、`~`、Windows drive/UNC 和规范化后越界都必须拒绝
- 回滚：撤销任意路径语义，恢复到 trusted-base 内子目录约束

## 风险 9：结构化下载结果被藏进 opaque `data_ref`

- 表现：`resolved_output_path`、`source_url`、`file_name_hint` 等字段只被声明为 `summary.capability_result.data_ref` 的解引用结果，下游实现无法一致消费
- 缓解：冻结 `download_result_summary` 直接挂在 `summary.capability_result.download_result_summary`；`data_ref` 如存在只承载 opaque `download_ref`
- 回滚：撤销对 `data_ref` 的结构化绑定，恢复 capability shell 内显式结果字段

## 风险 10：`candidate_shell_seed` 不能直接物化 `FR-0017` descriptor

- 表现：下载 handoff 只返回 `ability_id/entrypoint/*_contract_ref`，却缺少 `display_name`、`platform_scope`、`capture_origin`、`capture_run_id`、`capture_profile`、`captured_at`、`candidate_status` 等正式 descriptor 必填字段，导致下游仍依赖带外补写。
- 缓解：冻结 `candidate_shell_seed` 必须足以直接物化 `FR-0017.candidate_ability_descriptor` 的必填字段，并同时携带 descriptor-owned `contract_registry_seed`。
- 回滚：撤销不完整 handoff 形状，回到与 `FR-0017` 必填字段一一对齐的 seed。
