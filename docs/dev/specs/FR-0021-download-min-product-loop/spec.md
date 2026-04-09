# FR-0021 网页文件下载最小产品闭环

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
  - `FR-0017` 的候选能力描述与统一能力壳
  - `FR-0018` 的最小验证与可信判断对象
  - `FR-0004` 的诊断与错误分类边界
  - `FR-0006` 的运行记录与证据引用边界
- 本 FR 只冻结最小下载闭环，不承诺批量下载编排、复杂断点续传或交付市场协议。

### 2. 最小下载请求对象

- 必须冻结 `download_ability_request`，至少包含：
  - `ability_ref`
  - `target_url`
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
- 必须明确：
  - 下载能力仍属于统一能力面中的 `download`
  - `ability_ref` 在进入候选能力描述后必须直接等于 `FR-0017.candidate_ability_descriptor.ability_id`
  - `requested_execution_layer` 当前至少支持 `L3` 与 `L2`，不得绕过浏览器内执行边界
  - 下载目标必须来自浏览器内可达路径，不得把浏览器外异构抓取器写成正式主路径

### 3. 最小下载结果对象

- 必须冻结 `download_result_summary`，至少包含：
  - `download_ref`
  - `result_state`
  - `failure_class`
  - `saved_artifact_refs`
  - `resolved_output_path`
  - `content_descriptor`
- `result_state` 至少支持：
  - `downloaded`
  - `partial`
  - `failed`
- `failure_class` 至少支持：
  - `source_unavailable`
  - `auth_or_session_required`
  - `write_blocked`
  - `runtime_error`
- `content_descriptor` 至少包含：
  - `content_kind`
  - `mime_type`
  - `size_bytes`
- 必须明确：
  - `saved_artifact_refs` 是正式产物引用，而不是临时路径列表
  - `resolved_output_path` 是本次执行结果的落盘结果，不等于能力定义时的固定安装路径
  - `partial` 只能用于存在可保留产物但整体目标未完全满足的场景

### 4. 与统一能力模型的接线

- 本 FR 必须明确：
  - 下载能力进入 `FR-0017` 时，`ability_kind` 固定为 `download`
  - 下载结果继续复用统一能力壳，不得发明平行顶层结果结构
  - 下载能力进入 `FR-0018` 时，允许使用普通 `read|download` trust 域
- `candidate_shell_seed` 必须至少提供：
  - `ability_id`
  - `ability_kind=download`
  - `entrypoint`
  - `input_contract_ref`
  - `output_contract_ref`
  - `error_contract_ref`
  - `execution_layer_support`

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
  - 文件落盘是下载能力闭环的一部分，不得只返回远程 URL 冒充下载成功
  - `replace_existing` 属于高风险路径；后续实现必须与审计和风险策略对齐

## GWT 验收场景

### 场景 1：下载能力进入统一能力模型

Given 仓库已经存在 `read` 与 `write` 的统一能力方向
When reviewer 检查本 FR
Then 能明确看到下载能力通过 `ability_kind=download` 进入同一套模型
And 不会再建立下载特例协议

### 场景 2：下载成功必须落盘

Given 某次下载请求成功
When 系统返回 `download_result_summary`
Then `result_state=downloaded`
And `resolved_output_path` 与 `saved_artifact_refs` 都存在
And 不会只返回源 URL 冒充成功

### 场景 3：存在部分结果时不能伪装为完整成功

Given 远程资源只完成了部分保存
When 系统返回结果
Then `result_state=partial`
And 仍会明确返回 `saved_artifact_refs`
And 不会被误标为完整下载成功

### 场景 4：下载能力可继续进入验证链路

Given 某个下载能力已经进入候选能力描述
When reviewer 检查与 `FR-0018` 的关系
Then 能明确看到下载能力属于普通 `read|download` trust 域
And 不需要为下载能力另建第二套验证协议

## 异常与边界场景

1. 只返回远程链接，没有本地产物或 `resolved_output_path`：不得视为下载成功。
2. 使用浏览器外异构抓取器作为正式主路径：视为与浏览器内执行边界冲突。
3. `replace_existing` 被默认放行但没有风险对齐说明：视为高风险边界未冻结。
4. 下载结果另起顶层返回壳：视为与 `FR-0017` 冲突。
5. 下载能力被排除在 `FR-0018` 普通 trust 域之外：视为与既有验证模型冲突。

## 验收标准

1. FR-0021 套件完整，至少包含 `spec.md`、`plan.md`、`TODO.md`、`contracts/`、`data-model.md`、`research.md`、`risks.md`。
2. 下载请求、结果、产物引用与最小落盘边界已冻结。
3. 已明确与 `FR-0017/0018/0004/0006` 的继承关系。
4. 已明确下载能力不再是模型外特例。
5. 本 PR 只冻结规约，不混入实现代码。

## 依赖与前置条件

- GitHub 事项：
  - `#153` canonical FR 容器
- 上游 FR：
  - `FR-0017`
  - `FR-0018`
  - `FR-0004`
  - `FR-0006`
