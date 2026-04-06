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
  "route_role": "primary|fallback",
  "path_kind": "api|page",
  "method": "GET|POST|null",
  "path": "/api/...|null",
  "evidence_tier": "browser_first_hand|repo_baseline",
  "evidence_status": "success|failed|candidate",
  "evidence_maturity": "observed_once|reproduced_multi_round|admission_ready",
  "evidence_notes": "可复现动作与关键回包",
  "required_headers_observed": ["Accept", "X-s", "X-t"],
  "required_headers_candidate": ["Cookie", "Origin"],
  "required_params": ["keyword", "note_id"],
  "page_state_fallback": {
    "freeze_scope": "minimal_only",
    "path_template": "GET /explore/<noteId>?xsec_token=...&xsec_source=... | GET /user/profile/<userId>?xsec_token=...",
    "url_params_observed": [
      { "name": "noteId", "source": "path_segment", "required": true, "status": "success|candidate" },
      { "name": "userId", "source": "path_segment", "required": true, "status": "success|candidate" },
      { "name": "xsec_token", "source": "query", "required": true, "status": "success|candidate" },
      { "name": "xsec_source", "source": "query", "required": false, "status": "candidate" }
    ],
    "state_probe": {
      "root_path": "window.__INITIAL_STATE__",
      "root_expect": "object",
      "root_status": "success|failed|candidate",
      "key_paths_observed": [
        { "path": "note.noteDetailMap", "status": "success|candidate" },
        { "path": "user", "status": "success|candidate" },
        { "path": "board", "status": "success|candidate" },
        { "path": "note", "status": "success|candidate" }
      ]
    },
    "replay_actions": [
      { "step": "open_url", "target": "/explore/<noteId>?xsec_token=...&xsec_source=...", "expect": "page_loaded", "result_status": "success|failed|candidate" },
      { "step": "eval_js", "target": "typeof window.__INITIAL_STATE__", "expect": "object", "result_status": "success|failed|candidate" },
      { "step": "eval_js", "target": "window.__INITIAL_STATE__.note.noteDetailMap", "expect": "contains current noteId", "result_status": "success|failed|candidate" }
    ]
  },
  "success_signal": "HTTP 200 + business code success | 页面命中 + __INITIAL_STATE__ 可读 + 关键 store 存在",
  "failure_signals": ["browser_env_abnormal", "account_abnormal", "gateway_invoker_failed", "signature_entry_missing", "captcha_required", "session_expired", "invalid_sign"]
}
```

补充约束：

1. `route_role=primary` 表示当前场景优先交付给后续实现 FR 的主读取路径；`route_role=fallback` 仅用于 `page-state fallback`，表示在 API primary 受阻时保留的页面级备用读路径。
2. `path_kind=page` 只能在 `route_role=fallback` 或明确修订 FR 范围后出现；`path_kind=api` 不得使用 `route_role=fallback` 兜底表达未定性的辅助候选。
3. `evidence_maturity` 用于表达证据成熟度：
   - `observed_once`：单次样本或单轮观测，不能直接支撑实现准入
   - `reproduced_multi_round`：已满足多轮复现，但仍可能缺少实现前置（如 headers/cookie 实验矩阵）
   - `admission_ready`：仅允许用于 `route_role=primary` 且 `path_kind=api` 的成功证据，并且必须满足 `plan.md`「进入实现前条件」与本 FR「fallback 非准入」约束；该证据还必须绑定 WebEnvoy-managed profile、official runtime 边界和仓库内可复核 replay，方可作为实现 FR 的直接准入输入
   - `route_role=fallback` 或 `path_kind=page` 的记录不得标注为 `admission_ready`
4. `path_kind=page` 时，`endpoint_catalog` 仅用于冻结 page fallback 最小内容；不得把 fallback 重新建模为完整 API 端点。该场景下字段约束如下：
   - `page_state_fallback` 必填，并且必须至少包含：
   - `freeze_scope=minimal_only`
   - 1 个路径模板（`path_template`，仅允许路径模板与方法）
   - 1 个 URL 关键参数（`url_params_observed`）
   - 1 个页面状态根探针（`state_probe.root_path`）
   - 1 个已观测键路径（`state_probe.key_paths_observed`）
   - 2 个以上可执行复现动作（`replay_actions`，每步必须含 `step/target/expect`）
   - `url_params_observed`、`state_probe.root_status`、`state_probe.key_paths_observed[*].status`、`replay_actions[*].result_status` 仅允许 `success|failed|candidate`
   - `method`、`path`、`required_headers_observed`、`required_headers_candidate`、`required_params` 必须为 `null`、空数组、可省略或明确标注 `N/A`，不得填写 API 端点语义内容
5. `path_kind=api` 时，`page_state_fallback` 必须为 `null`，且 `method/path/required_headers_*/required_params` 必须按 API 语义填写，不得混入页面探针字段。

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
  "failure_signals": ["signature_entry_missing", "runtime_throw", "invalid_output"]
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
  "verification_status": "confirmed|candidate",
  "required_level": "hard|required_optional",
  "notes": "简述约束与已知变化条件"
}
```

## 兼容性约束

1. 新增场景或字段时允许追加，不允许破坏既有字段语义。
2. `required_level=hard` 的字段定义变化必须触发后续实现 FR 的显式评审。
3. 任何未识别失败信号必须追加到 `failure_signals`，不得静默忽略。
4. 在没有成功样本前，不允许把 `required_headers_candidate` 直接升级为“已确认必要条件”。
5. `verification_status=candidate` 的字段不得被后续实现 FR 直接当作冻结事实消费；进入实现前需先在对应 FR 中完成复核或显式承接为待决项。
