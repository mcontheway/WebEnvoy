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

记录核心读场景端点证据，并区分“已观测事实”与“候选推断”。

### 最小结构

```json
{
  "scenario": "search|detail|user_home",
  "path_kind": "api|page",
  "method": "GET|POST",
  "path": "/api/...|/explore/<noteId>?xsec_token=...|/user/profile/<userId>?xsec_token=...",
  "evidence_tier": "browser_first_hand|repo_baseline",
  "evidence_status": "success|failed|candidate",
  "evidence_notes": "可复现动作与关键回包",
  "required_headers_observed": ["Accept", "X-s", "X-t"],
  "required_headers_candidate": ["Cookie", "Origin"],
  "required_params": ["keyword", "note_id"],
  "success_signal": "HTTP 200 + business code success | 页面命中 + __INITIAL_STATE__ 可读 + 关键 store 存在",
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
  "entry_status": "stable|variant|candidate",
  "entry_scope": ["explore", "detail_page", "profile_page", "search_result_variant"],
  "input_shape": {
    "path": "string",
    "payload": "object|string",
    "timestamp": "number|string"
  },
  "output_shape": {
    "X-s": "string",
    "X-t": "string|number"
  },
  "request_headers_observed": ["X-S-Common"],
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
4. 在没有成功样本前，不允许把 `required_headers_candidate` 直接升级为“已确认必要条件”。
