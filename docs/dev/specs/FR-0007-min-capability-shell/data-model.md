# FR-0007 数据模型（最小能力封装壳）

## 模型边界

本模型只描述 Phase 1 最小能力封装壳中的共享输入 / 输出 / 错误实体。

它不覆盖：

- 平台私有业务字段
- 持久化表结构
- 能力分享、导入或版本仓库模型

## 核心实体

### 1. `AbilityRef`

用途：

- 描述一次能力调用的稳定身份与执行层信息。

关键字段：

- `id` TEXT / string NOT NULL
- `layer` ENUM NOT NULL (`L3` | `L2` | `L1`)
- `action` ENUM NOT NULL (`read` | `write` | `download`)

约束：

- `id` 必须跨运行稳定。
- 同一主版本内，`id` 不得跨命令漂移。
- `layer` 与 `action` 必须属于冻结枚举。

### 2. `AbilityInputEnvelope`

用途：

- 描述能力调用的最小输入壳。

关键字段：

- `ability` `AbilityRef` NOT NULL
- `input` OBJECT NOT NULL
- `options` OBJECT NULL

约束：

- `ability` 必须存在且为对象。
- `input` 必须存在且为对象，不可为数组、标量或 `null`。
- `options` 缺失时按空对象处理。
- 平台私有字段只能位于 `input` 下，不得与 `ability/options` 同级混写。

### 3. `CapabilityResult`

用途：

- 描述能力成功输出的最小摘要壳，位于 `summary.capability_result`。

关键字段：

- `ability_id` string NOT NULL
- `layer` ENUM NOT NULL
- `action` ENUM NOT NULL
- `outcome` ENUM NOT NULL (`success` | `partial`)
- `data_ref` OBJECT NULL
- `metrics` OBJECT NULL

约束：

- `ability_id/layer/action/outcome` 为最小必填字段。
- 不允许直接承载大体量原始业务结果。
- `data_ref` 只承载引用型摘要，不承载原文载荷。

### 4. `CapabilityErrorDetails`

用途：

- 描述能力失败时的最小结构化细节，位于 `error.details`。

关键字段：

- `ability_id` string NOT NULL
- `stage` ENUM NOT NULL (`input_validation` | `execution` | `output_mapping`)
- `reason` string NOT NULL

约束：

- 不得替代 FR-0001 外层 `error.code`。
- 必须与同一次运行的 `run_id` 一起出现，供诊断链路串联。
- `reason` 可细分，但不得变成无结构自由文本堆砌。

## 生命周期

1. CLI 解析 `--params` 后，首先生成并校验 `AbilityInputEnvelope`。
2. 执行成功时，在 FR-0001 成功壳的 `summary.capability_result` 中生成 `CapabilityResult`。
3. 执行失败时，在 FR-0001 错误壳的 `error.details` 中生成 `CapabilityErrorDetails`。
4. 上层调用方通过 `run_id + ability_id` 串联一次能力执行的成功、失败与诊断信息。

## 与其他 FR 的模型关系

- 与 `FR-0001`：复用 `run_id`、外层成功壳、外层错误壳和退出码。
- 与 `FR-0004`：复用 `run_id` 串联 `observability/diagnosis`，但不重定义其结构。
- 与 `FR-0005`：首个平台样本能力必须将业务输出映射到 `CapabilityResult`。
- 与 `FR-0006`：若后续需要落持久层，应复用 `run_id` 和能力壳关键字段，而不是重建标识体系。
