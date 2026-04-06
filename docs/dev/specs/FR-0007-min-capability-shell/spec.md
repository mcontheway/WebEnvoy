# FR-0007 建立最小能力封装骨架

## 背景

Phase 1 的首个平台闭环（`#145`）不能停留在一次性命令。若没有统一能力壳，后续 L2/L1 与能力交付链路会被迫从临时脚本重做，导致入口、参数、输出、错误和运行标识漂移。

`#354` 已收口 FR-0001 的 CLI 外层契约（命令调用、`stdout`/`stderr` 边界、统一错误壳与 `run_id`）。历史 issue `#159` 只保留为“能力壳方向最早来源”的引用，不再承接当前 formal closeout；当前 formal 承接 issue 为 `#360`。同样，issue `#360` 中保留的 `Refs #154` 只代表历史链路引用，FR-0007 当前对接的最小诊断正式边界以 FR-0004 套件为准，证据层映射边界以 FR-0006 套件为准。FR-0007 的职责是在不破坏 FR-0001 的前提下，补齐“能力层最小封装骨架”，让首个 L3 样本从一开始就具备可复用壳，而不是孤例命令。

## 目标

1. 定义能力调用的最小入口语义，明确“命令执行”和“能力执行”的最小映射关系。
2. 定义最小参数输入结构，冻结通用字段和能力私有字段边界。
3. 定义最小结果输出结构，保证上层可稳定读取能力级摘要结果。
4. 定义最小错误表达与运行标识承接规则，统一失败可观测口径。
5. 让 Phase 1 首个 L3 样本具备可复用能力外壳，并能为 Phase 2 的统一封装演进保留兼容空间。

## 非目标

- 不在本 FR 内交付任何平台实现代码、适配器代码或浏览器执行逻辑。
- 不在本 FR 内定义能力分享、导入、版本分发或兼容治理系统。
- 不在本 FR 内引入 SDK / API / daemon 形态，仍保持 CLI-first。
- 不在本 FR 内定义完整 L2 通用原语与 L1 兜底策略细节。
- 不在本 FR 内变更 FR-0001 的外层 CLI 调用语法、`stdout` 单 JSON 规则和最小退出码语义。

## 功能需求

### 0. 与相邻 FR 的边界

- FR-0001 负责 CLI 外层调用语法、`stdout` / `stderr` 边界、外层成功 / 错误壳、退出码与 `run_id` 基线；FR-0007 只在该外层壳内部冻结能力字段，不另起第二套 CLI 契约。
- FR-0004 负责 `observability.*` 与 `error.diagnosis` 的最小诊断语义；FR-0007 只要求能力错误在 `error.details` 中补齐 `ability_id` / `stage` / `reason`，不重定义诊断对象结构，也不把 `summary.capability_result` 混写为观测对象。
- FR-0006 负责 SQLite 运行记录、证据留存与字段映射；FR-0007 只冻结响应级能力壳与如需落库时的最小映射键，不要求能力响应以持久化成功作为返回前置，也不把 SQLite 提升为能力层真相源。

### 1. 最小能力入口

- 能力调用沿用 FR-0001 的外层命令入口：`webenvoy <command> --params '<json>' ...`。
- 在不新增第二套 CLI 入口的前提下，能力执行必须通过 `params.ability` 显式声明能力元信息。
- `params.ability` 最小必填字段：
  - `id`：能力标识，字符串，跨运行稳定
  - `layer`：`L3` / `L2` / `L1`
  - `action`：`read` / `write` / `download`

### 2. 最小参数输入结构

- `--params` 必须是对象，且最小结构固定为：
  - `ability`：能力元信息（必填）
  - `input`：能力私有输入（必填，对象）
  - `options`：能力执行选项（可选，对象）
- `input` 的字段命名和业务语义由具体能力决定，但不得与 `ability`、`options` 同级混写。
- 若 `ability` 或 `input` 缺失/类型错误，必须返回结构化参数错误，不允许隐式补全。

### 3. 最小结果输出结构

- 成功路径必须复用 FR-0001 成功外壳，不新增平行返回壳。
- 在 `summary` 内冻结最小能力结果对象 `summary.capability_result`，必填字段：
  - `ability_id`
  - `layer`
  - `action`
  - `outcome`（`success` / `partial`）
- `summary.capability_result` 可选字段：
  - `data_ref`（如 `batch_id`、`biz_ids`）
  - `metrics`（如计数、耗时）
- 不返回大体量原始数据；仍遵守“摘要返回 + 引用型结果占位”的信息披露原则。

### 4. 最小错误表达与运行标识

- 失败路径必须复用 FR-0001 错误外壳（`status=error` + `error.*`）。
- 能力相关失败细节统一放入 `error.details`，最小字段：
  - `ability_id`
  - `stage`（`input_validation` / `execution` / `output_mapping`）
  - `reason`
- `run_id` 沿用 FR-0001 语义并在成功/失败路径必填，不得在能力层另起标识体系。
- FR-0001 的最小错误码集合仍是保底语义；能力层可以补充 `error.details.reason` 细分原因，但不能破坏外层错误分类。
- 若同一响应同时携带 FR-0004 的 `error.diagnosis` 或 `observability` 字段，二者必须与能力壳并存，不得互相覆盖或改写字段语义。

### 5. 最小命令映射规则

- 一个能力至少绑定一个稳定逻辑命令（如 `<platform>.<verb>`）。
- 同一 `ability.id` 在同一主版本内不能跨命令漂移。
- 命令可升级实现，但不能在未声明兼容策略时重定义已冻结输入/输出字段语义。

### 6. 与 Phase 1 主线事项承接

- `#145` 在落首个平台读闭环时，必须按本 FR 的能力壳输出 `summary.capability_result`。
- FR-0004 的观察与诊断增强必须复用 `run_id` 串联能力执行上下文，不重建另一套运行标识，也不要求其复用 FR-0007 的能力专属字段结构。
- FR-0002 已冻结的通信契约与既有实现链路、`#356` 的身份承载实现可并行承接本 FR，但不得改写能力壳字段语义或引入第二套能力入口。
- FR-0006 如需为能力结果 / 错误建立落库映射，只能复用本 FR 已冻结的最小字段，不得倒逼响应层引入持久化专属字段。

## GWT 验收场景

### 场景 1：首个 L3 能力按统一能力壳成功返回

Given 调用方执行一个已实现的 L3 平台能力命令  
And `--params` 含合法 `ability` 与 `input`  
When 命令执行成功  
Then `stdout` 只输出单个 JSON 成功对象  
And 响应中包含 `run_id` 与 `summary.capability_result`  
And `summary.capability_result` 至少包含 `ability_id`、`layer`、`action`、`outcome`

### 场景 2：缺少能力入口字段被稳定拒绝

Given 调用方执行能力命令  
And `--params` 缺失 `ability` 或 `input`  
When CLI 完成参数校验  
Then 返回结构化错误  
And 错误语义可被归类为参数错误  
And 不会继续进入业务执行阶段

### 场景 3：能力执行失败返回统一外层错误壳

Given 调用方执行一个已实现能力命令  
And 能力执行阶段出现不可继续失败  
When 命令结束  
Then `stdout` 输出单个 JSON 错误对象  
And 外层错误壳仍符合 FR-0001  
And `error.details` 包含 `ability_id`、`stage`、`reason`

### 场景 4：能力输出映射失败可被定位

Given 能力执行返回了不符合约定的结果对象  
When 输出映射层校验失败  
Then 返回结构化错误  
And `error.details.stage=output_mapping`  
And `run_id` 可用于串联诊断链路

### 场景 5：同一能力多次调用保持稳定入口与输出字段

Given 同一 `ability.id` 在同一主版本被重复调用  
When 命令多次运行  
Then 调用方可稳定复用同一输入外壳与输出字段  
And 不需要针对每次调用重写解析逻辑

## 异常与边界场景

### 1. 参数与空值边界

- `ability` 不是对象、`input` 不是对象、`ability.id` 为空字符串时，必须拒绝执行。
- `options` 缺失时应按默认空对象处理，不得触发非预期失败。

### 2. 输出边界

- 成功响应缺失 `summary.capability_result` 必须视为输出映射失败，不可静默降级为普通成功。
- 能力输出不得直接塞入未裁剪的大体量原始数据，避免破坏信息披露与消息体边界。

### 3. 错误分类边界

- 能力私有失败原因允许细分到 `error.details.reason`，但不能绕开外层错误壳直接输出非结构化文本。
- 运行时不可用与能力执行失败必须保持可区分，避免全量归并为单一失败语义。

### 4. 并发与一致性边界

- 并发执行同一 `ability.id` 时，每次调用必须拥有独立 `run_id`。
- 同一主版本能力在并发调用中不能出现字段名漂移或可选变必填的隐式变更。

### 5. 前后兼容边界

- 后续 Phase 可扩展能力字段，但不能移除当前最小必填字段或改写其语义。
- 在未引入正式版本策略前，禁止通过“临时字段替换”方式破坏已冻结最小结构。

## 验收标准

1. 文档层明确冻结了能力入口、参数输入、结果输出、错误表达、运行标识五个最小边界。
2. FR-0001 外层 CLI 契约保持不变，且本 FR 只在其内部补齐能力壳。
3. `spec.md` 提供可执行的 GWT 主路径与关键失败路径，覆盖参数校验、执行失败、输出映射失败。
4. 对 `#145`、FR-0004 与 FR-0006 的承接关系可直接指导实现，不需要再猜字段边界。
5. 没有提前扩张到能力分享、导入、版本分发或 SDK/API 形态。
6. 已补齐对应 `contracts/` 与 `risks.md`，可支撑 spec review 的契约与风险审查。

## 依赖与前置条件

- 硬依赖：
  - FR-0001 已冻结的 CLI 外层契约（formal closeout 由 `#354` 承接）
  - FR-0002 已冻结的最小通信契约与可用执行链路（formal closeout 由 `#355` 承接）
  - `#145`（首个平台核心读闭环）
  - FR-0004 已冻结的最小观察、错误分类与结构化诊断边界
- 并行协同：
  - `#356`
  - FR-0006 formal 套件
- 前置文档：
  - `vision.md`
  - `docs/dev/roadmap.md`
  - `docs/dev/architecture/system-design.md`
  - `docs/dev/architecture/system-design/communication.md`
  - `docs/dev/specs/FR-0001-runtime-cli-entry/`
  - `docs/dev/specs/FR-0004-runtime-observability/`
  - `docs/dev/specs/FR-0006-runtime-sqlite-store/`
- Governing issue：
  - `#360`
