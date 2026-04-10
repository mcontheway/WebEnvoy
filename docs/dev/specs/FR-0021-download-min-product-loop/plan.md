# FR-0021 实施计划

## 实施目标

把 `#153` 收口为正式下载能力 FR，冻结最小请求、结果、落盘与统一能力模型接线边界。

## 分阶段拆分

### 阶段 1：规约冻结

- 产出：`spec.md`、`contracts/`、`data-model.md`
- 重点：下载请求（direct URL / page blob / page-derived）、下载结果、artifact refs、落盘策略

### 阶段 2：spec review 收口

- 产出：review 结论、与 `FR-0017/0018` 的边界确认
- 重点：阻断下载特例协议、浏览器外主路径，以及与 `FR-0007` 冲突的失败承载方式

### 阶段 3：实现前切片

- 产出：首刀 Work Item、验证入口、风险边界
- 重点：先做单文件/单媒体资产，不扩张到复杂下载器

## 实现约束

- 不引入浏览器外异构抓取器作为正式主路径。
- 下载请求不得冻结为 direct-URL-only；必须覆盖页内 `blob:` 与页面导出后解析来源的输入路径。
- `page_blob` 不得把单独的 `blob_url` 冻结为充分输入；formal 契约必须保留可由浏览器执行面桥接到 CLI 落盘的 `blob_locator`。
- `params.ability.layer` 与 `download_ability_request.requested_execution_layer` 的关系必须在 formal 契约层冻结为严格相等；出现冲突时统一在 `input_validation` 阶段拒绝。
- `download_source` 只表达当前浏览器执行上下文内可解析输入，不扩张为新的全局 artifact/ref 真相源。
- `destination_root` 只允许表达 CLI trusted download base 内的目标子目录；不得把任意宿主路径暴露给调用方。
- 不把批量下载、断点续传或跨平台同步写进首刀。
- 不把下载结果从统一能力壳中拆出去。
- `download_result_summary` 必须直接挂在 `summary.capability_result` 内，不得继续依赖 opaque `data_ref` 作为结构化结果载体。
- `requested_execution_layer` 与 `candidate_shell_seed.execution_layer_support` 共享正式枚举保留 `L1/L2/L3`，但当前最小实现切片可优先 `L3/L2`。
- `candidate_shell_seed` 必须足以直接物化 `FR-0017.candidate_ability_descriptor` 的必填字段，不得把 provenance / lifecycle 字段留给带外补写。
- `replace_existing` 属于高风险路径，后续实现必须显式审计。

## 测试与验证策略

- 规约阶段：
  - 对照 `FR-0017/0018` 检查下载是否仍在统一能力模型内
  - 对照 `roadmap.md` 检查下载是否仍属于 Phase 2 能力面
  - 检查下载请求是否覆盖 direct URL、`blob:`、页面导出后解析三类路径
  - 检查 `requested_execution_layer` 与 `params.ability.layer` 是否已冻结为严格相等，并在冲突输入时统一拒绝
  - 检查 `page_blob` 是否已禁止 `blob_url-only`，并冻结了浏览器执行面到 CLI 落盘的桥接定位语义
  - 检查 `source_url` 是否被定义为下载时最终浏览器侧来源标识，而非调用方预填稳定 URL
  - 检查 `destination_root` 是否已冻结为 trusted download base 内的子目录语义
  - 检查结构化下载结果是否直接暴露在 `summary.capability_result.download_result_summary`，不再依赖 opaque `data_ref`
  - 检查 `candidate_shell_seed` 是否已能直接物化 `FR-0017` descriptor 必填字段，并同时提供 descriptor-owned `contract_registry_seed`
- 校验：
  - `bash scripts/docs-guard.sh`
  - `bash scripts/spec-guard.sh`

## TDD 范围

- 当前只冻结规约，不进入实现代码 TDD。
- 后续实现时优先覆盖：
  - 文件名/冲突策略解析
  - 下载成功、部分成功、失败三态
  - artifact ref 与本地落盘结果一致性

## 并行 / 串行关系

- 可并行：
  - 与 `FR-0017/0018/0019` 的 formal 套件收口
  - 与 GitHub 单一结构治理链
- 串行 / 依赖：
  - 下载能力接入实现前，需要 `FR-0017` 的 descriptor 边界稳定
  - 下载能力进入普通 trust 域前，需要 `FR-0018` 的验证对象稳定
  - 下载失败返回必须与 `FR-0007` 成功/错误壳保持单一语义

## 进入实现前条件

- FR-0021 spec review 通过。
- `#153` 已被确认为 canonical FR 容器。
- 下载请求、结果、落盘与冲突策略无阻断争议。
- direct URL / page blob / page-derived 三类下载输入无阻断争议。
- `destination_root` 的 trusted-base 约束无阻断争议。
- `download_result_summary` 与 `summary.capability_result` 的挂载位置无阻断争议。
- 下载失败路径与 `FR-0007` 错误壳的承载方式无阻断争议。
- 后续 Work Item 已明确 ownership 与高风险边界。
