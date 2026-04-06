# 能力封装壳契约

## 边界名称与适用范围

本契约定义 FR-0007 的“最小能力封装壳”，适用于：

- 能力执行入口（复用 FR-0001 CLI 外层调用）
- 能力输入结构（`ability` / `input` / `options`）
- 能力结果结构（`summary.capability_result`）
- 能力错误细节结构（`error.details`）
- 能力层与 `run_id` 的关联语义

本契约不定义：

- 平台业务字段字典
- 能力分享、导入、分发与版本仓库
- Native Messaging 消息体细节
- `observability` / `error.diagnosis` 诊断结构
- SQLite 持久化 schema 或能力证据表

## 生产者 / 消费者

- 生产者：
  - CLI 命令处理器（能力执行层）
  - 首个平台样本能力处理器（`#145`）
- 直接消费者：
  - 上层 Agent / 自动化脚本
  - CLI 契约测试
- 间接消费者：
  - FR-0004 诊断与观察链路
  - FR-0006 能力证据字段映射链路
  - Phase 2 能力复用与验证机制

## 输入契约

能力执行沿用 FR-0001 的最小 CLI 语法：

```text
webenvoy <command> --params '<json>' [--profile <profile>] [--run-id <run_id>]
```

`--params` 的最小能力壳结构：

```json
{
  "ability": {
    "id": "xhs.note.search.v1",
    "layer": "L3",
    "action": "read"
  },
  "input": {
    "query": "露营装备",
    "limit": 20
  },
  "options": {
    "timeout_ms": 30000
  }
}
```

字段要求：

- `ability`（必填，对象）
  - `id`（必填，字符串，稳定能力标识）
  - `layer`（必填，枚举：`L3` / `L2` / `L1`）
  - `action`（必填，枚举：`read` / `write` / `download`）
- `input`（必填，对象）
  - 能力私有参数容器
  - 不允许为 `null`、数组或标量
- `options`（可选，对象）
  - 执行级可选参数容器
  - 缺失时视为 `{}`，不得影响主流程

## 输出契约（成功）

成功路径复用 FR-0001 外层成功壳，在 `summary` 内补能力壳：

```json
{
  "run_id": "run-20260319-0100",
  "command": "xhs.search",
  "status": "success",
  "summary": {
    "capability_result": {
      "ability_id": "xhs.note.search.v1",
      "layer": "L3",
      "action": "read",
      "outcome": "success",
      "data_ref": {
        "batch_id": "batch-abc123"
      },
      "metrics": {
        "count": 20,
        "duration_ms": 820
      }
    }
  },
  "timestamp": "2026-03-19T12:00:00.000Z"
}
```

`summary.capability_result` 字段约束：

- 必填：
  - `ability_id`
  - `layer`
  - `action`
  - `outcome`（`success` / `partial`）
- 可选：
  - `data_ref`
  - `metrics`

补充规则：

- `data_ref` 只承载 opaque reference，不承诺具体持久化 schema、查询接口或回读能力。
- 若同一成功响应同时携带 FR-0004 的 `observability`，该对象仍位于外层 `observability`，不得并入 `summary.capability_result`。

## 错误 / 状态契约（失败）

失败路径复用 FR-0001 外层错误壳，能力细节在 `error.details`：

```json
{
  "run_id": "run-20260319-0101",
  "command": "xhs.search",
  "status": "error",
  "error": {
    "code": "ERR_EXECUTION_FAILED",
    "message": "能力执行失败",
    "retryable": false,
    "details": {
      "ability_id": "xhs.note.search.v1",
      "stage": "execution",
      "reason": "TARGET_API_RESPONSE_INVALID"
    }
  },
  "timestamp": "2026-03-19T12:00:01.000Z"
}
```

`error.details` 最小字段：

- `ability_id`
- `stage`（`input_validation` / `execution` / `output_mapping`）
- `reason`

补充规则：

- 外层 `error.code` 继续遵循 FR-0001 语义。
- 能力细分原因放在 `error.details.reason`，不新增平行错误壳。
- 成功和失败路径都必须带 `run_id`。
- 若同一失败响应同时携带 FR-0004 的 `error.diagnosis`，其职责仍是诊断分类与证据摘要；`error.details` 只表达能力层上下文，不得替代 `error.diagnosis`。

## 兼容策略

- Phase 1 内，本契约的必填字段视为冻结。
- 后续 FR 允许新增可选字段，但不得删除或重定义必填字段语义。
- 同一 `ability.id` 在同一主版本内，不得更换命令映射或字段语义。
- 若需要破坏性变更，必须进入新的 FR 并提供明确迁移策略。

## 最小示例

### 示例 1：合法能力调用

```text
$ webenvoy xhs.search --profile xhs_account_001 --params '{"ability":{"id":"xhs.note.search.v1","layer":"L3","action":"read"},"input":{"query":"露营装备","limit":20}}'
```

预期：成功返回 `summary.capability_result`，且含 `ability_id/layer/action/outcome`。

### 示例 2：缺失 `ability`

```text
$ webenvoy xhs.search --params '{"input":{"query":"露营装备"}}'
```

预期：参数错误，返回结构化错误，且不进入执行阶段。

### 示例 3：输出映射失败

```text
$ webenvoy xhs.search --params '{"ability":{"id":"xhs.note.search.v1","layer":"L3","action":"read"},"input":{"query":"露营装备","force_bad_output":true}}'
```

预期：`status=error`，`error.details.stage=output_mapping`，并保留 `run_id`。
