# XHS Read Spike 契约

## 边界与适用范围

本契约定义 FR-0005 侦察阶段的结构化输出边界，用于把 Spike 结论稳定交付给后续小红书 L3 读适配 FR。

本契约不定义：

- FR-0001 CLI 外层 argv/output 契约
- FR-0002 通信层握手与转发协议
- 具体平台实现代码与运行时调度

## 输出对象

Spike 输出必须包含以下三个对象：

1. `endpoint_catalog`
2. `signature_path`
3. `field_lifecycle_matrix`

## endpoint_catalog

### 语义

记录核心读场景可复现端点信息。

### 最小结构

```json
{
  "scenario": "search|detail|user_home",
  "method": "GET|POST",
  "path": "/api/...",
  "required_headers": ["x-s", "x-t"],
  "required_params": ["keyword", "note_id"],
  "success_signal": "HTTP 200 + business code success",
  "failure_signals": ["captcha", "session_expired", "invalid_sign"]
}
```

## signature_path

### 语义

记录签名最小调用链与输入输出边界。

### 最小结构

```json
{
  "entry": "window.<fn>|module.<fn>",
  "input_shape": {
    "path": "string",
    "payload": "object|string",
    "timestamp": "number|string"
  },
  "output_shape": {
    "sign": "string",
    "extra": "object|null"
  },
  "preconditions": ["logged_in", "page_context_ready"],
  "failure_signals": ["entry_missing", "runtime_throw", "invalid_output"]
}
```

## field_lifecycle_matrix

### 语义

记录关键字段来源、生命周期与实现依赖等级。

### 最小结构

```json
{
  "field": "x-s|x-t|trace_id",
  "source": "page_state|runtime_generated|static",
  "lifecycle": "request_scoped|session_scoped|page_refresh_scoped",
  "required_level": "hard|required_optional",
  "notes": "简述约束与已知变化条件"
}
```

## 兼容性约束

1. 新增场景或字段时允许追加，不允许破坏既有字段语义。
2. `required_level=hard` 的字段定义变化必须触发后续实现 FR 的显式评审。
3. 任何未识别失败信号必须追加到 `failure_signals`，不得静默忽略。
