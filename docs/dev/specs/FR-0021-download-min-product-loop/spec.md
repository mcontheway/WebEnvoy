# FR-0021 网页文件下载最小产品闭环

Canonical Issue: #153

## 背景

下载是 WebEnvoy 面向用户交付的三类核心能力之一，但当前 Phase 2 backlog 里只有 `#153` 作为子级 issue，尚未形成正式 FR。若继续缺少 formal suite，后续实现很容易把以下边界混成一团：

- 下载目标如何被描述
- 下载结果、文件落盘位置与失败类型如何表达
- 下载能力如何进入 `FR-0017` 的统一候选能力描述
- 下载能力如何继续进入 `FR-0018` 的最小验证与可信判断

因此，本 FR 以 `#153` 为 canonical FR 容器，负责冻结“网页文件下载最小产品闭环”的正式边界。

## 目标

1. 冻结下载能力的最小请求、结果与产物引用边界。
2. 明确下载能力如何进入 `FR-0017` 的统一能力模型，而不是另起特例协议。
3. 明确下载能力与读取、验证、运行记录的继承关系。
4. 定义下载成功、部分成功、失败的最小正式语义。
5. 为后续实现 PR 提供 implementation-ready 的正式输入。

## 非目标

- 不在本 FR 内定义完整下载管理器、断点续传系统或跨平台同步系统。
- 不实现最终交付、分享、导入与版本治理。
- 不把浏览器外 HTTP 抓取器引入为核心运行时。
- 不在本 FR 内混入实现代码。

## 功能需求

### 1. Phase 与继承边界

- 本 FR 归属 `Phase 2`，以 `#153` 作为 canonical FR 容器。
- 本 FR 必须显式继承：
  - `FR-0007` 的统一能力调用壳（`params.ability/input/options` 与 `summary.capability_result`）
  - `FR-0017` 的候选能力描述与统一能力壳
  - `FR-0018` 的最小验证与可信判断对象
  - `FR-0004` 的诊断与错误分类边界
  - `FR-0006` 的运行记录与证据引用边界
- 本 FR 只冻结最小下载闭环，不承诺批量下载编排、复杂断点续传或交付市场协议。

### 2. 最小下载请求对象

- 必须冻结 `download_ability_request`，至少包含：
  - `ability_ref`
  - `download_source`
  - `profile_ref`
  - `download_goal`
  - `output_policy`
  - `requested_execution_layer`
- `download_goal` 至少支持：
  - `single_file`
  - `single_media_asset`
- `output_policy` 至少包含：
  - `destination_root`
  - `file_name_policy`
  - `conflict_policy`
- `destination_root` 只允许表达 CLI owned trusted download base 内的目标子目录，不得直接表达任意宿主绝对路径
- `download_source` 必须覆盖三类输入路径：
  - `direct_url`：调用方直接提供可访问 URL
  - `page_blob`：下载对象来自页面内 `Blob` 句柄或 `blob:` URL，但正式输入必须给出可在页面执行面内桥接读取的 `blob_locator`
  - `page_derived`：需先执行页面导出/页面动作后，才能在浏览器侧解析出最终下载对象
- `page_blob` 必须提供 `blob_locator`；`blob_url` 如存在，只能作为浏览器侧 source identity 或审计线索，不能单独构成足以落盘的输入。`page_derived` 至少需要 `trigger_hint` 或 `page_context_hint` 其一
- 必须明确：
  - 下载能力仍属于统一能力面中的 `download`
  - `download_ability_request` 只能作为 `FR-0007` `params.input` 下的下载输入对象，不得提升为新的顶层请求壳
  - `params.ability.id` 必须直接等于 `download_ability_request.ability_ref`
  - `params.ability.action` 必须固定为 `download`
  - `params.ability.layer` 仍是本次 invocation 的权威执行层；`download_ability_request.requested_execution_layer` 只作为下载输入对象内的显式镜像字段，且必须与 `params.ability.layer` 严格相等
  - 若 `params.ability.layer` 与 `download_ability_request.requested_execution_layer` 不一致，请求必须在 `input_validation` 阶段直接拒绝，不得由实现自行猜测优先级或静默改写
  - `ability_ref` 在进入候选能力描述后必须直接等于 `FR-0017.candidate_ability_descriptor.ability_id`
  - `requested_execution_layer` 的共享正式枚举必须保留 `L1`、`L2`、`L3`；当前最小实现切片可优先 `L3/L2`，但不得在 formal 契约层排除 `L1`
  - `download_source` 只描述“当前浏览器执行上下文内可解析的请求输入”，不得被提升为新的全局 artifact/ref 真相源
  - `page_blob.blob_locator` 的正式语义是页面执行面内可解析的 Blob 读取/桥接定位点，用于让浏览器侧把 Blob 内容交给 CLI 落盘；不得把单独的 `blob_url` 视为足以完成落盘的充分输入
  - 下载目标必须来自浏览器内可达路径，不得把浏览器外异构抓取器写成正式主路径

### 3. 最小下载结果对象

- 必须冻结 `download_result_summary`，并把字段语义分层写清：
  - 始终必填：
    - `download_ref`
    - `result_state`
    - `content_descriptor`
  - `result_state=downloaded` 时条件必填：
    - `resolved_output_path`
    - `source_url`
    - `file_name_hint`
  - `result_state=partial` 时条件必填：
    - `resolved_output_path` 与 `saved_artifact_refs` 至少其一
  - 可选 run-scoped evidence refs：
    - `saved_artifact_refs`
- `result_state` 至少支持：
  - `downloaded`
  - `partial`
- `content_descriptor` 至少包含：
  - `content_kind`
  - `mime_type`
- `size_bytes` 在当前 formal baseline 下为可选字段；当运行期已知稳定字节数时应返回
- 必须明确：
  - `download_result_summary` 只能作为 `FR-0007` 成功壳内 `summary.capability_result.download_result_summary` 的下载专用结构化结果对象，不得再声明为 `summary.capability_result.data_ref` 的解引用结果，也不得作为新的平行顶层返回结构
  - `summary.capability_result.action` 必须固定为 `download`，且 `outcome` 只能与 `download_result_summary.result_state` 做一致映射（`downloaded->success`，`partial->partial`）
  - `summary.capability_result.data_ref` 如存在，只能继续承载 opaque `download_ref` 或等价引用，不得成为 `resolved_output_path`、`source_url`、`file_name_hint`、`content_descriptor` 的唯一承载位置
  - 下载失败路径必须复用 `FR-0007` 的错误壳：`status=error` + `error.*`；不得把 `failed` 结果继续挂到 `summary.capability_result` 成功壳下
  - 下载能力的最小失败分类必须通过 `error.details.reason` 表达，至少支持：
    - `SOURCE_UNAVAILABLE`
    - `AUTH_OR_SESSION_REQUIRED`
    - `WRITE_BLOCKED`
    - `RUNTIME_ERROR`
  - 在上游 artifact carrier 尚未正式冻结前，`saved_artifact_refs` 只作为可选的 run-scoped evidence refs，不得被提升为新的正式真相源
  - `resolved_output_path` 是本次执行结果的落盘结果，不等于能力定义时的固定安装路径
  - `source_url` 必须回传本次下载最终使用的浏览器侧 source identity（可归一化），可为 direct URL、`blob:` URL 或页面执行后解析出的最终下载来源，用于审计与复现定位
  - `file_name_hint` 用于回传下载结果的文件名提示（可来自目标 URL、页面信号或响应头），不得替代最终落盘路径
  - `partial` 只能用于存在可保留产物但整体目标未完全满足的场景

### 4. 与统一能力模型的接线

- 本 FR 必须明确：
  - 下载能力进入 `FR-0017` 时，`ability_kind` 固定为 `download`
  - 下载结果继续复用统一能力壳，不得发明平行顶层结果结构
  - 下载能力进入 `FR-0018` 时，允许使用普通 `read|download` trust 域
- `candidate_shell_seed` 必须足以直接物化 `FR-0017.candidate_ability_descriptor` 的必填字段，并同时提供 descriptor-owned `candidate_ability_contract_registry` 的最小 seed；不得依赖带外补字段或私有默认值。其正式字段至少包括：
  - `ability_id`
  - `display_name`
  - `ability_kind=download`
  - `entrypoint`
  - `platform_scope`
  - `input_contract_ref`
  - `output_contract_ref`
  - `error_contract_ref`
  - `execution_layer_support`
  - `capture_origin`
  - `capture_run_id`
  - `capture_profile`
  - `captured_at`
  - `candidate_status`
  - `capture_artifact_refs`（可选）
  - `contract_registry_seed`
- `candidate_shell_seed.execution_layer_support` 的共享正式枚举必须保留 `L1`、`L2`、`L3`；当前最小实现切片可优先 `L3/L2`，但 formal 契约层不得排除 `L1`
- `candidate_shell_seed.platform_scope.platform_family` 必须使用稳定、归一化的平台键；站点无关下载能力默认应落在 `generic_web`
- `candidate_shell_seed` 中的 `input_contract_ref`、`output_contract_ref`、`error_contract_ref` 必须遵循 `FR-0017` 的 canonical namespace：
  - 格式固定为 `cad::<ability_id>::<input|output|error>::v<major>`
  - `ability_id` 必须直接等于当前 `candidate_shell_seed.ability_id`
  - `<input|output|error>` 只能表达该 ref 的契约种类；不兼容语义变更时必须递增 `v<major>`
- `candidate_shell_seed.contract_registry_seed` 必须显式继承 `FR-0017` 的 `candidate_ability_contract_registry` 有效性规则：
  - `contract_registry_seed.ability_id` 必须直接等于 `candidate_shell_seed.ability_id`
  - `entries[*].contract_ref` 必须至少覆盖 `input_contract_ref`、`output_contract_ref`、`error_contract_ref`
  - 同一 `contract_ref` 不得出现冲突 entry，且 `contract_kind` 必须与 ref kind 一致
  - 对 `input_contract_ref`、`output_contract_ref`、`error_contract_ref` 的 lookup 必须都能得到唯一有效结果；否则不得上报成功 handoff

### 5. 最小落盘与冲突策略

- 本 FR 必须冻结最小落盘边界：
  - 目标文件最终落盘到 `destination_root` 下的单一路径
  - `file_name_policy` 必须表达如何确定文件名
  - `conflict_policy` 必须表达同名冲突处理方式
- `conflict_policy` 至少支持：
  - `fail_if_exists`
  - `rename_with_suffix`
  - `replace_existing`
- 必须明确：
  - `destination_root` 的正式语义是 trusted download base 内的目标子目录；真正的宿主写入根由 CLI 持有，调用方不得借此指定任意宿主绝对路径
  - 实现必须先对 `destination_root` 做本地规范化，再拼接到 trusted download base；若输入为绝对路径、`..`、`~`、Windows drive/UNC 前缀，或规范化后逃逸 trusted base，必须在 `input_validation` 阶段直接拒绝
  - `resolved_output_path` 必须是最终仍位于 trusted download base 内的实际落盘路径
  - 文件落盘是下载能力闭环的一部分，不得只返回远程 URL 冒充下载成功
  - `replace_existing` 属于高风险路径；后续实现必须与审计和风险策略对齐

## GWT 验收场景

### 场景 1：下载能力进入统一能力模型

Given 仓库已经存在 `read` 与 `write` 的统一能力方向
When reviewer 检查本 FR
Then 能明确看到下载能力通过 `ability_kind=download` 进入同一套模型
And 不会再建立下载特例协议
And `download_ability_request` / `download_result_summary` 继续挂接在 `FR-0007` 统一能力调用壳内

### 场景 2：下载成功必须落盘

Given 某次下载请求成功
When 系统返回 `download_result_summary`
Then `result_state=downloaded`
And `resolved_output_path` 存在
And `source_url` 与 `file_name_hint` 均存在
And `source_url` 可以是 direct URL、`blob:` URL，或页面执行后解析出的最终浏览器侧来源标识
And 结构化下载结果直接出现在 `summary.capability_result.download_result_summary`
And `saved_artifact_refs` 若存在，只作为 run-scoped evidence refs 返回
And 不会只返回源 URL 冒充成功

### 场景 3：存在部分结果时不能伪装为完整成功

Given 远程资源只完成了部分保存
When 系统返回结果
Then `result_state=partial`
And `saved_artifact_refs` 若存在，只作为 run-scoped evidence refs 返回
And 不会被误标为完整下载成功

### 场景 4：下载能力可继续进入验证链路

Given 某个下载能力已经进入候选能力描述
When reviewer 检查与 `FR-0018` 的关系
Then 能明确看到下载能力属于普通 `read|download` trust 域
And 不需要为下载能力另建第二套验证协议

### 场景 5：下载失败走统一错误壳

Given 某次下载执行失败
When 系统返回结果
Then 外层必须是 `status=error`
And 下载失败原因通过 `error.details.reason` 表达
And 不会把 `failed` 结果挂在 `summary.capability_result` 成功壳下

### 场景 6：页内派生下载对象不要求预先给出最终 URL

Given 下载对象需要先在页面内执行导出或解析 `Blob` 才能确定
When 调用方提交 `download_ability_request.download_source`
Then 请求仍然是合法输入
And 不要求调用方预先提供稳定的最终 `target_url`
And 最终来源通过结果中的 `source_url` 回传

### 场景 7：越界的 `destination_root` 在输入校验阶段被拒绝

Given 调用方提交的 `output_policy.destination_root` 是绝对路径、包含 `..`，或规范化后会逃逸 trusted download base
When 系统执行下载请求输入校验
Then 请求必须在 `input_validation` 阶段被拒绝
And 不会继续进入文件落盘阶段

## 异常与边界场景

1. 只返回远程链接，没有本地产物或 `resolved_output_path`：不得视为下载成功。
2. 使用浏览器外异构抓取器作为正式主路径：视为与浏览器内执行边界冲突。
3. `replace_existing` 被默认放行但没有风险对齐说明：视为高风险边界未冻结。
4. 下载结果另起顶层返回壳：视为与 `FR-0017` 冲突。
5. 下载失败继续被挂在 `summary.capability_result` 成功壳下：视为与 `FR-0007` 能力壳冲突。
6. 下载能力被排除在 `FR-0018` 普通 trust 域之外：视为与既有验证模型冲突。
7. `candidate_shell_seed.contract_registry_seed` 存在重复 ref、kind 不匹配或无法唯一解引用的 entry，仍被标为成功 handoff：视为与 `FR-0017` 契约冲突。
8. 把下载输入冻结为 direct-URL-only，排除 `blob:` 或页面导出路径：视为与既有下载架构冲突。
9. `page_blob` 允许只靠 `blob_url` 就被视为合法输入，导致 CLI 无法在脱离页面上下文时实际落盘：视为浏览器到 CLI 的桥接边界未冻结。
10. `destination_root` 允许调用方直接写任意宿主绝对路径，或规范化后可逃逸 trusted download base：视为高风险写入边界未冻结。
11. 把 `download_result_summary` 继续声明为 opaque `data_ref` 的解引用结果：视为与 `FR-0007` 的 opaque reference 契约冲突。
12. `candidate_shell_seed` 缺少 `display_name`、`platform_scope`、`capture_origin`、`capture_run_id`、`capture_profile`、`captured_at` 或 `candidate_status` 等 descriptor 必填字段，却仍被当作成功 handoff：视为与 `FR-0017` 的 descriptor 物化边界冲突。

## 验收标准

1. FR-0021 套件完整，至少包含 `spec.md`、`plan.md`、`TODO.md`、`contracts/`、`data-model.md`、`research.md`、`risks.md`。
2. 下载请求、结果、产物引用与最小落盘边界已冻结。
3. 已明确与 `FR-0017/0018/0004/0006` 的继承关系。
4. 已明确成功/部分成功继续挂在 `summary.capability_result`，其中结构化下载结果直接位于 `summary.capability_result.download_result_summary`，失败统一走 `status=error + error.*`。
5. 已明确下载能力不再是模型外特例。
6. 本 PR 只冻结规约，不混入实现代码。

## 依赖与前置条件

- GitHub 事项：
  - `#153` canonical FR 容器
- 上游 FR：
  - `FR-0017`
  - `FR-0018`
  - `FR-0004`
  - `FR-0006`
