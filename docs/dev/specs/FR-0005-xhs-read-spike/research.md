# FR-0005 研究记录（正式输入）

## 研究问题

1. 小红书核心读链路的最小稳定端点集合是什么。
2. 页面签名函数最小调用路径是否可稳定复现。
3. 关键追踪字段在请求级/会话级/刷新级的变化规律是什么。

## 证据分层与结论口径

本文件把证据分为两层，避免把历史调研与本轮浏览器内实测混写：

1. 仓库内既有调研证据（历史基线）
  - `docs/research/ref/MediaCrawlerPro_analysis.md`
  - `docs/archive/tech-selection-preresearch.md`
  - `docs/dev/architecture/system-design/reference.md`
2. 浏览器内第一手复核证据（本轮新增）
  - 在真实浏览器页面内观察函数、Cookie、XHR、DOM、手动 fetch 回包

口径约束：

- 第一手证据优先用于描述“本轮已发生事实”。
- 历史基线仅作为候选参考，不能覆盖第一手失败证据。
- 本轮已触发风控/账号异常，浏览器内 live 复核已暂停；本文件不是“实现就绪”结论。
- 作者本机 `.webenvoy/profiles/**` 的恢复状态属于执行现场事实；只有在 WebEnvoy-managed profile 下的同口径复核结论正式收口后，才会改变 formal spec 的当前状态。

## 1. 浏览器内第一手复核证据（新增）

### 1.1 环境与会话前提

- 登录态来源：`Claw profile` 的隔离 clone。
- 浏览器启动方式：手动启动 Chrome，并开启 remote debugging `9222`。
- 本轮状态：出现账号/风控异常后，停止继续 live 交互，避免扩大账号风险。

### 1.2 签名入口页面分流实测

- 页面：`https://www.xiaohongshu.com/explore`
  - `window._webmsxyw` 为 `function`。
  - `toString()` 预览为混淆函数。
  - 调用样例：`window._webmsxyw('/api/sns/web/v1/search/notes', payload)` 返回对象，键至少包含 `X-s`、`X-t`。
- 页面：`/explore/<noteId>?xsec_token=...`
  - `window._webmsxyw` 为 `function`。
  - `window.__INITIAL_STATE__` 为 `object`，且 `note.noteDetailMap` 中可直接拿到当前 `noteId`。
- 页面：`/user/profile/<userId>?xsec_token=...&xsec_source=pc_search`
  - 曾在一次访问中出现 `window._webmsxyw is not a function`。
  - 但后续直接打开同类 profile URL 时，`window._webmsxyw` 又为 `function`，且 `window.__INITIAL_STATE__` 为 `object`，顶层包含 `user`、`board`、`note` 等 store。
- 页面：`search_result` 的一个页面变体
  - 曾出现 `window._webmsxyw` 为 `undefined`。

最小可冻结输入/输出边界：

- 当前可冻结的主调用样例：
  - `uri`: `/api/sns/web/v1/search/notes`
  - `payload`: 至少可按搜索请求体形状传入对象，当前仓库内可复核的最小字段集为：
    - `keyword`
    - `page`
    - `page_size`
    - `search_id`
    - `sort`
    - `note_type`
- 当前已观测输出：
  - `X-s`
  - `X-t`
- 当前前置条件：
  - 已登录浏览器会话
  - 页面已进入可执行平台脚本的主世界上下文
  - `window._webmsxyw` 已挂载为 `function`

失败分流（本轮可冻结）：

- `signature_entry_missing`
  - 现象：`window._webmsxyw === undefined` 或不是 `function`
  - 已见页面：`search_result` 某变体、profile 页早期样本
- `runtime_throw`
  - 现象：调用 `window._webmsxyw(uri, data)` 时抛异常
  - 本轮未主动放大实验，保留为正式失败分流
- `invalid_output`
  - 现象：返回值缺少 `X-s` 或 `X-t`
  - 本轮未见该样本，但作为输出校验失败分支冻结

结论（受限于本轮样本）：签名入口至少存在页面、加载时机或版本分流，不能写成全局稳定入口；当前只冻结“搜索主路径可用的最小调用样例”，detail/user_home 仍保留为同入口的候选复用场景。

### 1.3 Cookie 与存储观测

- 在 `/explore` 页面，`document.cookie` 可直接读到：`a1`、`webId`、`gid`、`xsecappid`。
- 结合此前已落盘证据：`webId` / `gid` 不在 `localStorage` / `sessionStorage`。

### 1.4 单次搜索交互的成功 XHR 样本（HTTP 200）

以下请求在单次搜索交互中实际观察为成功 `200`：

- `GET //edith.xiaohongshu.com/api/sns/web/v1/search/recommend?keyword=AI`
- `GET //edith.xiaohongshu.com/api/sns/web/v1/search/filter?keyword=AI&search_id=...`
- `POST //edith.xiaohongshu.com/api/sns/web/v1/search/onebox`
- `POST //edith.xiaohongshu.com/api/sns/web/v1/search/notes`
- `GET //edith.xiaohongshu.com/api/sns/web/v1/board/user?user_id=...&num=15&page=1`

同批次可见的请求头族（观测值，不等于最小必要集）：

- 通用：`Accept`
- POST 额外：`Content-Type: application/json;charset=utf-8`
- 追踪/签名相关：`x-b3-traceid`、`x-xray-traceid`、`X-s`、`X-t`、`X-S-Common`

### 1.5 DOM 抽样证据

- 在 `/explore` 页 DOM 可直接抽到：
  - 笔记 URL 形态：`/explore/<noteId>?xsec_token=...&xsec_source=...`
  - 用户 URL 形态：`/user/profile/<userId>?xsec_token=...&xsec_source=pc_search`
- 在直接打开的 detail / profile 页面：
  - `window.__INITIAL_STATE__` 均为 `object`
  - detail 页可从 `note.noteDetailMap` 直接取到当前 `noteId`
  - profile 页顶层可见 `user`、`board`、`note` 等 store

### 1.6 手动 fetch 失败/风控样本

- `fetch('/api/sns/web/v1/search/notes')` 仅补 `X-s/X-t`：
  - `HTTP 500`
  - body 含 `create invoker failed / jarvis-gateway-default`
- `fetch('https://edith.xiaohongshu.com/api/sns/web/v1/user/otherinfo?...')` 仅补 `X-s/X-t`：
  - `HTTP 200`
  - 业务 `code=300015`，`msg=Browser environment abnormal ...`
- 手动 `POST https://edith.xiaohongshu.com/api/sns/web/v1/feed`，补 `Accept/Content-Type/x-b3-traceid/x-xray-traceid/X-s/X-t/X-S-Common`：
  - `HTTP 461`
  - body `code=300011`，`msg=Account abnormal. Switch account and retry.`

## 2. 场景化端点结论（按新契约字段标注）

标注口径（对齐 `contracts/xhs-read-spike.md`）：

- 每条证据显式包含 `route_role`、`path_kind`、`evidence_status`、`evidence_maturity`。
- `route_role=fallback` 且 `path_kind=page` 的证据统一标记为 `fallback-only`，只作为降级路径证据，不构成实现准入。
- 仅 `route_role=primary` + `evidence_status=success` 且补齐最小必要请求上下文实验矩阵，才可进入实现准入；当前轮次尚未满足。

### 2.1 search

| evidence_id | route_role | path_kind | evidence_status | evidence_maturity | evidence_tier | method | path | 证据摘要 | 准入作用 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `search-primary-01` | `primary` | `api` | `success` | `observed_once` | `browser_first_hand` | `POST` | `/api/sns/web/v1/search/notes` | 真实搜索交互中观测到 `HTTP 200` 成功样本 | 主路径强证据，但仍缺最小必要 headers/cookie/origin 矩阵 |
| `search-primary-02` | `primary` | `api` | `failed` | `observed_once` | `browser_first_hand` | `POST` | `/api/sns/web/v1/search/notes` | 手动仅补 `X-s/X-t` 得到 `HTTP 500` + `create invoker failed` | 阻断“仅双字段签名可复现”的假设 |

`search` 端点补充字段：

- `search-primary-01`
  - `required_headers_observed`: `Accept`, `Content-Type`, `x-b3-traceid`, `x-xray-traceid`, `X-s`, `X-t`, `X-S-Common`
  - `required_headers_candidate`: `Cookie`, `Origin`, `Referer`, `UA-CH`
  - `required_params`: `keyword`, `page`, `page_size`, `search_id`, `sort`, `note_type`
  - `success_signal`: `HTTP 200 + 搜索结果正常返回`
  - `failure_signals`: `browser_env_abnormal`, `account_abnormal`, `gateway_invoker_failed`, `invalid_sign`
  - `page_state_fallback`: `null`
- `search-primary-02`
  - `required_headers_observed`: `X-s`, `X-t`
  - `required_headers_candidate`: `Cookie`, `Origin`, `Referer`, `X-S-Common`
  - `required_params`: `keyword`, `page`, `page_size`, `search_id`, `sort`, `note_type`
  - `success_signal`: `n/a`
  - `failure_signals`: `gateway_invoker_failed`
  - `page_state_fallback`: `null`
当前结论：

- `search/notes` 仍是 `primary` 候选主路径，但当前只达到 `observed_once`，未达“实现准入”。
- `search` 场景当前无可冻结的 `page` fallback 成功证据；其余辅助 API 证据仅保留为候选，不构成实现准入。
- 当前已观测头族：`Accept`、`Content-Type`（POST）、`x-b3-traceid`、`x-xray-traceid`、`X-s`、`X-t`、`X-S-Common`；Cookie/Origin/Referer/UA-CH 仍为候选必要项。

`search` 辅助 API 证据（不进入正式 `endpoint_catalog`）：

- `search-supporting-01`
  - 观测路径：`/api/sns/web/v1/search/recommend` / `/api/sns/web/v1/search/filter` / `/api/sns/web/v1/search/onebox`
  - `required_headers_observed`: `Accept`, `X-s`, `X-t`, `X-S-Common`
  - `required_headers_candidate`: `Cookie`, `Origin`, `Referer`
  - `required_params`: `keyword`, `search_id`
  - `success_signal`: `请求可见但未证明可替代主读链路`
  - `failure_signals`: `candidate_only`
  - 作用：仅保留为 supporting/candidate 线索，不冻结 `route_role`

### 2.2 detail

| evidence_id | route_role | path_kind | evidence_status | evidence_maturity | evidence_tier | method | path | 证据摘要 | 准入作用 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `detail-fallback-01` | `fallback` | `page` | `success` | `observed_once` | `browser_first_hand` | `N/A` | `N/A` | 页面命中后 `window.__INITIAL_STATE__` 为 `object`，`note.noteDetailMap` 可读到当前 `noteId`；具体页面模板见 `page_state_fallback.path_template` | `fallback-only`（不构成实现准入） |
| `detail-primary-01` | `primary` | `api` | `candidate` | `observed_once` | `repo_baseline` | `POST` | `/api/sns/web/v1/feed` | 存在端点与参数形态（`source_note_id`）证据，但无成功闭环 | 主路径候选，未准入 |
| `detail-primary-02` | `primary` | `api` | `failed` | `observed_once` | `browser_first_hand` | `POST` | `/api/sns/web/v1/feed` | 手动请求返回 `HTTP 461` + `code=300011`（账号异常） | 风控阻断证据 |

`detail` 端点补充字段：

- `detail-primary-01`
  - `required_headers_observed`: `[]`
  - `required_headers_candidate`: `Accept`, `Content-Type`, `Cookie`, `Origin`, `Referer`, `X-s`, `X-t`, `X-S-Common`
  - `required_params`: `source_note_id`
  - `success_signal`: `HTTP 200 + 详情内容正常返回`
  - `failure_signals`: `candidate_only`
  - `page_state_fallback`: `null`
- `detail-primary-02`
  - `required_headers_observed`: `Accept`, `Content-Type`, `x-b3-traceid`, `x-xray-traceid`, `X-s`, `X-t`, `X-S-Common`
  - `required_headers_candidate`: `Cookie`, `Origin`, `Referer`
  - `required_params`: `source_note_id`
  - `success_signal`: `n/a`
  - `failure_signals`: `account_abnormal`
  - `page_state_fallback`: `null`

`detail-fallback-01` 对应 `page_state_fallback` 冻结快照：

```json
{
  "freeze_scope": "minimal_only",
  "path_template": "GET /explore/<noteId>?xsec_token=...&xsec_source=...",
  "url_params_observed": [
    { "name": "noteId", "source": "path_segment", "required": true, "status": "success" },
    { "name": "xsec_token", "source": "query", "required": true, "status": "success" },
    { "name": "xsec_source", "source": "query", "required": false, "status": "candidate" }
  ],
  "state_probe": {
    "root_path": "window.__INITIAL_STATE__",
    "root_expect": "object",
    "root_status": "success",
    "key_paths_observed": [
      { "path": "note.noteDetailMap", "status": "success" },
      { "path": "note.noteDetailMap.<noteId>", "status": "success" }
    ]
  },
  "replay_actions": [
    { "step": "open_url", "target": "/explore/<noteId>?xsec_token=...&xsec_source=...", "expect": "page_loaded", "result_status": "success" },
    { "step": "eval_js", "target": "typeof window.__INITIAL_STATE__", "expect": "object", "result_status": "success" },
    { "step": "eval_js", "target": "window.__INITIAL_STATE__.note.noteDetailMap", "expect": "contains current noteId", "result_status": "success" }
  ]
}
```

当前结论：

- detail 的 `page` 路径只有 `fallback-only` 价值。
- detail 的 `api primary` 未获得成功样本，不构成实现准入。

### 2.3 user_home

| evidence_id | route_role | path_kind | evidence_status | evidence_maturity | evidence_tier | method | path | 证据摘要 | 准入作用 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `user-home-fallback-01` | `fallback` | `page` | `success` | `observed_once` | `browser_first_hand` | `N/A` | `N/A` | 页面命中后 `window.__INITIAL_STATE__` 为 `object`，顶层可见 `user`/`board`/`note`；具体页面模板见 `page_state_fallback.path_template` | `fallback-only`（不构成实现准入） |
| `user-home-primary-02` | `primary` | `api` | `failed` | `observed_once` | `browser_first_hand` | `GET` | `/api/sns/web/v1/user/otherinfo?...` | 手动仅补 `X-s/X-t` 返回 `HTTP 200 + code=300015`（环境异常） | 阻断“低上下文请求可复现”假设 |
| `user-home-primary-03` | `primary` | `api` | `candidate` | `observed_once` | `repo_baseline` | `GET` | `/api/sns/web/v1/user/otherinfo?...` | 端点语义相关，但本轮无成功闭环 | 候选，不准入 |

`user_home` 端点补充字段：

- `user-home-primary-02`
  - `required_headers_observed`: `X-s`, `X-t`
  - `required_headers_candidate`: `Cookie`, `Origin`, `Referer`, `X-S-Common`
  - `required_params`: `user_id`
  - `success_signal`: `n/a`
  - `failure_signals`: `browser_env_abnormal`
  - `page_state_fallback`: `null`
- `user-home-primary-03`
  - `required_headers_observed`: `[]`
  - `required_headers_candidate`: `Accept`, `Cookie`, `Origin`, `Referer`, `X-s`, `X-t`, `X-S-Common`
  - `required_params`: `user_id`
  - `success_signal`: `HTTP 200 + 用户主页核心字段稳定返回`
  - `failure_signals`: `candidate_only`
  - `page_state_fallback`: `null`

`user-home-fallback-01` 对应 `page_state_fallback` 冻结快照：

```json
{
  "freeze_scope": "minimal_only",
  "path_template": "GET /user/profile/<userId>?xsec_token=...&xsec_source=pc_search",
  "url_params_observed": [
    { "name": "userId", "source": "path_segment", "required": true, "status": "success" },
    { "name": "xsec_token", "source": "query", "required": true, "status": "success" },
    { "name": "xsec_source", "source": "query", "required": false, "status": "candidate" }
  ],
  "state_probe": {
    "root_path": "window.__INITIAL_STATE__",
    "root_expect": "object",
    "root_status": "success",
    "key_paths_observed": [
      { "path": "user", "status": "success" },
      { "path": "board", "status": "success" },
      { "path": "note", "status": "success" }
    ]
  },
  "replay_actions": [
    { "step": "open_url", "target": "/user/profile/<userId>?xsec_token=...&xsec_source=pc_search", "expect": "page_loaded", "result_status": "success" },
    { "step": "eval_js", "target": "typeof window.__INITIAL_STATE__", "expect": "object", "result_status": "success" },
    { "step": "eval_js", "target": "window.__INITIAL_STATE__.user", "expect": "object", "result_status": "success" }
  ]
}
```

当前结论：

- user_home 的 `page` 路径仅为 `fallback-only`。
- `/api/sns/web/v1/board/user` 当前只保留为辅助 API 证据，不冻结为 `primary`。
- user_home 的 `primary api` 仍缺“可稳定读取核心字段 + 最小必要请求上下文”的闭环证据，不构成实现准入。

`user_home` 辅助 API 证据（不进入正式 `endpoint_catalog`）：

- `user-home-supporting-01`
  - 观测路径：`/api/sns/web/v1/board/user?user_id=...&num=15&page=1`
  - `required_headers_observed`: `Accept`, `x-b3-traceid`, `x-xray-traceid`, `X-s`, `X-t`, `X-S-Common`
  - `required_headers_candidate`: `Cookie`, `Origin`, `Referer`
  - `required_params`: `user_id`, `num`, `page`
  - `success_signal`: `HTTP 200`
  - `failure_signals`: `candidate_only`
  - 作用：仅保留为 supporting/candidate 线索，不冻结 `route_role`

## 3. 签名链路与字段生命周期（本轮可保守冻结）

### 3.1 签名链路

- 当前可确认入口仍是浏览器内 `window._webmsxyw(uri, data)`。
- 但入口存在页面/加载时机/版本分流（`/explore`、detail 页可用；`search_result` 某变体与 profile 页的早期样本出现过不可用）。
- 因此只能冻结为“候选主入口 + 分流风险”，不能冻结为“全局稳定唯一入口”。

`signature_path` 正式输出（对齐 `contracts/xhs-read-spike.md` 最小结构，按当前证据保守填写）：

```json
{
  "entry": "window._webmsxyw(uri, data)",
  "entry_status": "variant",
  "entry_scope": ["explore", "detail_page", "profile_page", "search_result_variant"],
  "input_shape": {
    "path": "string (uri, observed_once)",
    "payload": "object|string (data, observed_once)",
    "timestamp": "number|string (not_observed_in_this_round)"
  },
  "output_shape": {
    "X-s": "string (observed_once)",
    "X-t": "string|number (observed_once)"
  },
  "request_headers_observed": ["X-S-Common"],
  "preconditions": ["logged_in", "page_context_ready", "signature_entry_present_on_current_page_variant"],
  "failure_signals": ["signature_entry_missing", "runtime_throw", "invalid_output", "gateway_invoker_failed", "browser_env_abnormal", "account_abnormal", "invalid_sign"]
}
```

### 3.2 生命周期矩阵（已确认 vs 候选）


| 字段 | 来源 | verification_status | 本轮状态 | 生命周期判断 | 依赖等级 | 说明 |
| --- | --- | --- | --- | --- | --- | --- |
| `X-s` | `runtime_generated` | `candidate` | 第一手已观测 | `request_scoped` 候选 | `hard` | 由浏览器内签名调用 `window._webmsxyw(uri, data)` 返回 |
| `X-t` | `runtime_generated` | `candidate` | 第一手已观测 | `request_scoped` 候选 | `hard` | 由浏览器内签名调用 `window._webmsxyw(uri, data)` 返回 |
| `X-S-Common` | `page_state` | `candidate` | 第一手已观测（请求头） | `session_scoped` 候选 | `required_optional` | 仅确认出现在请求头，仍需复核是否会退化为 `page_refresh_scoped` |
| `x-b3-traceid` | `runtime_generated` | `candidate` | 第一手已观测（请求头） | `request_scoped` 候选 | `required_optional` | 生成机制未复核，当前先按运行时生成处理 |
| `x-xray-traceid` | `runtime_generated` | `candidate` | 第一手已观测（请求头） | `request_scoped` 候选 | `required_optional` | 生成机制未复核，当前先按运行时生成处理 |
| `a1` | `page_state` | `candidate` | 第一手已观测（Cookie） | `session_scoped` 候选 | `required_optional` | 仅确认可读到，未做跨刷新对比，尚未证明是最小必要条件 |
| `webId` | `page_state` | `candidate` | 第一手已观测（Cookie） | `session_scoped` 候选 | `required_optional` | 且已有证据表明不在 local/session storage，仍需复核是否会退化为 `page_refresh_scoped` |
| `gid` | `page_state` | `candidate` | 第一手已观测（Cookie） | `session_scoped` 候选 | `required_optional` | 且已有证据表明不在 local/session storage，仍需复核是否会退化为 `page_refresh_scoped` |
| `xsecappid` | `page_state` | `candidate` | 第一手已观测（Cookie） | `session_scoped` 候选 | `required_optional` | 仅确认可读 |
| `xsec_token` | `page_state` | `candidate` | 第一手已观测（DOM URL） | `page_refresh_scoped` 候选 | `required_optional` | 由 URL 抽样获得 |
| `xsec_source` | `static` | `candidate` | 第一手已观测（DOM URL） | `page_refresh_scoped` 候选 | `required_optional` | 由 URL 抽样获得，仍需复核是否受页面状态改写 |


## 4. 错误分类更新（含本轮新增）


| 错误码 / 现象                                | 语义             | 建议分类                      |
| --------------------------------------- | -------------- | ------------------------- |
| 登录页 / 缺少有效会话                         | 未登录 / 会话过期     | `session_expired`         |
| `300015` + Browser environment abnormal | 浏览器环境校验失败      | `browser_env_abnormal`    |
| `300011` + Account abnormal             | 账号异常/风控阻断      | `account_abnormal`        |
| `HTTP 500` + create invoker failed      | 网关侧调用失败（上下文不足） | `gateway_invoker_failed`  |
| `HTTP 429` / captcha                    | 额外人机验证阻断       | `captcha_required`        |
| `window._webmsxyw` 缺失                   | 页面脚本分流/漂移      | `signature_entry_missing` |

2026-04-06 代码与 contract test 已对齐最小诊断壳映射：

- `SESSION_EXPIRED` / `ACCOUNT_ABNORMAL` / `BROWSER_ENV_ABNORMAL` / `GATEWAY_INVOKER_FAILED` / `CAPTCHA_REQUIRED` -> `request_failed`
- `SIGNATURE_ENTRY_MISSING` -> `page_changed`


## 5. 当前状态与暂停说明

本轮浏览器内复核为“部分完成”：

- 已有：`search` 相关成功样本、detail/profile 页面级 `__INITIAL_STATE__` 证据、签名入口分流证据、Cookie/DOM 一手样本、多类失败样本。
- 未有：`detail` 与 `user_home` 的稳定成功闭环证据，及每个端点“最小必要 headers”严格证明。

由于已出现 `account abnormal`，本轮 live 复核到此为止。后续需要在账号/环境恢复后继续，当前结论不得直接转写为“实现已就绪”。

### 5.1 2026-04-06 WebEnvoy-managed profile 准入预检

2026-04-06 中午在仓库本地按 `#358` 的正式执行口径复查 `.webenvoy/profiles/**/__webenvoy_meta.json`：

- 当前仅存在 `fr0012_diag_stage` 与 `fr0012_diag_stage2` 两个诊断样本 profile。
- 两个 profile 的 `lastLoginAt` 均为 `null`，且 profile 名称、用途与小红书 live 复核无关。
- 当时仓库内不存在可由 WebEnvoy 接管、且保持有效登录态的小红书 profile，因此无法在 WebEnvoy-managed official runtime 边界内继续执行 `search/detail/user_home` 的同口径 live 复核。

由此得到的正式结论：

- 2026-04-06 中午这轮不能把外部手工浏览器/Claw clone 会话继续升级为 `admission_ready` 证据。
- `search` 仍停留在 `observed_once` 的 `primary` 成功样本，尚缺 WebEnvoy-managed profile 下的多轮 replay 与 required headers 最小必要集。
- `detail` 与 `user_home` 仍分别停留在 `fallback-only` 与 `candidate/failed` 组合，不满足进入实现 FR 的前提。
- 上述快照支撑了 2026-04-06 中午的 `No-Go/paused` 历史 closeout。
- 截至当前 PR，WebEnvoy-managed profile 下的后续同口径复核尚未作为正式结论收口；因此 formal FR 的当前状态仍保持 blocked。
- 若后续执行现场已恢复受管 XHS profile，应继续补齐 `search/detail/user_home` 的同口径复核，并在结论收口后再更新正式状态。

### 5.2 2026-04-10 WebEnvoy-managed official runtime 再预检（issue #445，中间现场）

2026-04-10 晚间为执行 issue `#445`，先在独立 worktree `/Users/mc/dev/WebEnvoy-445` 建立文档收口现场，再按当前仓库 formal 口径对 `xhs_001` 做 managed-profile official runtime 复核。

本轮先确认到的受管 profile 事实：

- `.webenvoy/profiles/xhs_001/__webenvoy_meta.json` 已存在，且 `lastLoginAt=2026-04-06T14:13:38.670Z`。
- `persistentExtensionBinding` 已存在，字段为：
  - `extensionId=peblekhliiiadkpnelonclgcdhmpgppm`
  - `nativeHostName=com.webenvoy.host`
  - `browserChannel=chrome`
  - `manifestPath=/Users/mc/dev/WebEnvoy/.webenvoy/profiles/xhs_001/NativeMessagingHosts/com.webenvoy.host.json`
- `xhs_001` 已不再是“仓库内完全不存在受管 XHS profile”的状态；但这只证明 profile 元数据存在，不等于本轮已经满足 official runtime live 复核前提。

随后执行的 runtime 预检与启动事实如下：

- 在 worktree 现场执行：
  - `./bin/webenvoy runtime.status --profile xhs_001 --run-id issue445-status-preflight`
  - 结果：`identityBindingState=bound`、`transportState=disconnected`、`bootstrapState=pending`、`runtimeReadiness=recoverable`
  - 同时 `fingerprint_runtime.execution.live_allowed=false`，仅允许 `dry_run/recon`，原因码为 `LEGACY_PROFILE_BUNDLE_MIGRATED`
- 在 worktree 现场执行默认 `runtime.start`：
  - `./bin/webenvoy runtime.start --profile xhs_001 --run-id issue445-start-preflight`
  - 结果：浏览器以 `--headless=new about:blank` 方式被拉起；该执行面不满足 FR-0005 需要的 `real_browser` live 复核前提，不能作为 fresh live evidence
- 停止上述 headless 现场后，在 canonical runtime 根 `/Users/mc/dev/WebEnvoy` 再次执行可见模式启动：
  - `./bin/webenvoy runtime.start --profile xhs_001 --params '{"headless":false,"startUrl":"https://www.xiaohongshu.com/search_result?keyword=AI"}' --run-id issue445-main-start-visible-002`
  - 结果：直接返回 `ERR_RUNTIME_IDENTITY_MISMATCH`
  - 结构化错误明细显示：
    - `reason=IDENTITY_MANIFEST_MISSING`
    - `launcher_profile_root=/Users/mc/dev/WebEnvoy/.webenvoy/profiles`
    - `expected_profile_root=/Users/mc/dev/WebEnvoy-445/.webenvoy/profiles`
    - `profile_root_matches=false`

本轮同时确认到一个新的执行现场事实：

- `xhs_001` 的 `__webenvoy_meta.json.profileDir` 当前已被写成 `/Users/mc/dev/WebEnvoy-445/.webenvoy/profiles/xhs_001`
- 而 native host launcher 固定导出的 `WEBENVOY_NATIVE_BRIDGE_PROFILE_ROOT` 仍是 `/Users/mc/dev/WebEnvoy/.webenvoy/profiles`
- 在当前现场下，这会把 official Chrome persistent extension identity preflight 稳定判成 `mismatch`

由此得到的正式结论：

- 2026-04-10 这轮与 2026-04-06 不同，阻断点已不再是“没有受管 XHS profile”，而是“受管 profile 的 official runtime identity preflight 不满足当前 live 复核前提”。
- 在 `ERR_RUNTIME_IDENTITY_MISMATCH / IDENTITY_MANIFEST_MISSING` 未解除前，本轮不能合法进入 `search/detail/user_home` 的 managed-profile fresh live rerun。
- 因为合法的 `real_browser` official runtime rerun 根本没有开始，本轮没有新增 `search/detail/user_home` 的 API primary 成功样本，也没有新增 `required_headers` 最小必要集矩阵证据。
- 因此 `search` 仍停留在 `observed_once` 的 `primary` 成功样本；`detail` 与 `user_home` 仍分别停留在 `fallback-only` 与 `candidate/failed` 组合。
- issue `#445` 本轮已按同一 formal 口径重做 Go/No-Go 判定，结论维持 `No-Go/paused`，formal FR 当前状态继续保持 blocked。
- 在修复 `xhs_001` 的 official runtime identity mismatch、并恢复合法的 `real_browser` 执行面之前，不得把外部手工浏览器、旧 head、旧 artifact 或 headless `about:blank` 现场补写成 managed-profile live 复核结论。

### 5.3 2026-04-11 main 目录恢复后再复核（issue #445 正式收口）

2026-04-11 在 canonical runtime 根 `/Users/mc/dev/WebEnvoy` 继续复核。与 5.2 的中间现场不同，本轮先把受污染的本地 runtime 资产恢复到 main 目录口径，然后只在 `main` 目录执行 fresh rerun；worktree 现场不再作为 formal 结论依据。

#### 5.3.1 准入预检结果

本轮先确认并恢复的执行现场事实：

- `.webenvoy/profiles/xhs_001/__webenvoy_meta.json.profileDir` 已恢复为 `/Users/mc/dev/WebEnvoy/.webenvoy/profiles/xhs_001`，不再指向 worktree。
- `persistentExtensionBinding` 仍指向：
  - `extensionId=peblekhliiiadkpnelonclgcdhmpgppm`
  - `nativeHostName=com.webenvoy.host`
  - `browserChannel=chrome`
  - `manifestPath=/Users/mc/dev/WebEnvoy/.webenvoy/profiles/xhs_001/NativeMessagingHosts/com.webenvoy.host.json`
- profile 元数据中补入了非 legacy 的 `fingerprintProfileBundle`，因此 `fingerprint_runtime.execution.live_allowed=true`，允许 `dry_run/recon/live_read_limited/live_read_high_risk/live_write`。

只读预检与启动结果：

- `run_id=issue445-main-verify-status-restore-001`
  - `command=runtime.status`
  - 结果：`identityBindingState=bound`、`profileRootMatches=true`、`failureReason=IDENTITY_PREFLIGHT_PASSED`
- `run_id=issue445-main-start-visible-clean-001`
  - `command=runtime.start`
  - `profile=xhs_001`
  - `browser_channel=chrome`
  - `execution_surface=real_browser`
  - `page_url=https://www.xiaohongshu.com/search_result?keyword=AI`
  - 结果：`browserState=ready`、`transportState=ready`、`bootstrapState=ready`、`runtimeReadiness=ready`
- `run_id=issue445-main-ping-clean-001`
  - `command=runtime.ping`
  - 结果：`relay_path=host>background>content-script>background>host`

由此可确认：issue `#445` 在 main 目录恢复后的正式阻断点，已不再是 `profileDir/profile_root` 污染，也不再是 legacy 指纹 bundle 拒绝 live。

#### 5.3.2 fresh rerun 事实

本轮 fresh rerun 统一执行口径：

- `profile=xhs_001`
- `browser_channel=chrome`
- `execution_surface=real_browser`
- `tested_head_sha=e8e686d3ecc5924770131264671bc4da5713ef57`
- Chrome 页面：`https://www.xiaohongshu.com/search_result?keyword=AI&type=51`

运行时 tab 诊断：

- `run_id=issue445-main-runtime-tabs-001`
- 桥接命令：`runtime.tabs`
- `page_url=https://www.xiaohongshu.com/search_result?keyword=AI&type=51`
- `target_tab_id=1230416592`
- `relay_path=host>background`
- 结果：成功回读当前 XHS 搜索页 tab，说明本轮不再是“猜错 tab id”导致的转发失败

#### 5.3.3 三场景 endpoint 证据更新

`search`

- `run_id=issue445-main-search-dryrun-001`
- `evidence_collected_at=2026-04-10T16:18:22Z`
- `profile=xhs_001`
- `browser_channel=chrome`
- `execution_surface=real_browser`
- `page_url=https://www.xiaohongshu.com/search_result?keyword=AI&type=51`
- `target_tab_id=1230416592`
- `relay_path=host>background>content-script>background>host`（由同会话 `runtime.ping` 与 `runtime.start`/`runtime.tabs` 成功链路共同确认）
- `interaction_locator=search_result_tab + query=AI`
- 最小 replay：
  - `runtime.start --profile xhs_001 --params {"headless":false,"startUrl":"https://www.xiaohongshu.com/search_result?keyword=AI"}`
  - `runtime.tabs` 回读当前 XHS tab，确认 `target_tab_id=1230416592`
  - 以 `target_domain=www.xiaohongshu.com`、`target_page=search_result_tab`、`requested_execution_mode=dry_run` 执行 `xhs.search`
- 成功信号：
  - `consumer_gate_result.gate_decision=allowed`
  - `requested_execution_mode=dry_run`
  - `effective_execution_mode=dry_run`
  - `target_tab_id` / `target_domain` / `target_page` 均被 background 接受
- 失败事实：
  - 执行层返回 `ERR_EXECUTION_FAILED`
  - 失败原文：`executeXhsSearchImpl is not defined`
  - `blocker_level=repo_latest_head_execution_bundle`
- 成熟度结论：
  - 本轮只证明 managed-profile + official runtime + real browser + explicit target gate 已恢复
  - 但 `tested_head_sha=e8e686d3ecc5924770131264671bc4da5713ef57` 的执行 bundle 在 fresh rerun 首次进入 content script 时即失败，`search` 不能升级为 `reproduced_multi_round`，也不能补齐 required headers 矩阵

`detail`

- 本轮未获得合法 fresh rerun 样本
- 阻断原因不是 profile 不存在，而是 `tested_head_sha=e8e686d3ecc5924770131264671bc4da5713ef57` 在共享执行 bundle 层已出现 `executeXhsSearchImpl is not defined`
- 由于 `search` 的同口径 fresh rerun 尚未通过，`detail` 无法在同一 managed-profile official runtime 边界内继续补做 API primary 复核
- 需与早期 `#306` 语义区分：此前“详情页可读取”的成功，指向的是 `detail-fallback-01` 这类 page-state/fallback 证据（`window.__INITIAL_STATE__.note.noteDetailMap` 可读），不是 `detail primary api` 已成功，更不是 `search` 主路径已成功
- 当前维持既有结论：`fallback-only + candidate/failed`，未新增 primary success 样本

`user_home`

- 本轮未获得合法 fresh rerun 样本
- 阻断原因同上：`tested_head_sha=e8e686d3ecc5924770131264671bc4da5713ef57` 的共享执行 bundle 已在最早的 XHS read fresh rerun 中失败
- 当前维持既有结论：`fallback-only + candidate/failed`，未新增 `/api/sns/web/v1/user/otherinfo` 或候选聚合端点的 primary success 样本

#### 5.3.4 required headers / 关键字段矩阵是否提升

- `search`：未提升。虽然本轮重新确认了 explicit target gate 与 real-browser relay 可达，但由于执行 bundle 在 `dry_run` 即失败，本轮没有新增 API 请求成功样本，仍不能把 `required_headers_observed/candidate` 从 `observed_once` 升级到 `reproduced_multi_round`。
- `detail`：未提升。无新增 API primary success 样本。
- `user_home`：未提升。无新增 API primary success 样本。

#### 5.3.5 本轮正式结论

2026-04-11 的 main 目录恢复后复核，已经推翻了“当前唯一阻断是 worktree/main profile root mismatch”的中间判断；但没有推翻 FR-0005 的正式 `No-Go/paused` 结论，原因如下：

- `xhs_001` 现在可被认定为可启动的 WebEnvoy-managed official runtime profile。
- `real_browser` fresh rerun 已成功达到 `runtime.start ready`、`runtime.tabs` 成功回读真实 tab、`runtime.ping` 成功回读真实 relay path。
- 但是 `tested_head_sha=e8e686d3ecc5924770131264671bc4da5713ef57` 的 XHS read 执行 bundle 在 `search` 首次 fresh rerun 就失败，错误为 `executeXhsSearchImpl is not defined`；这属于当前仓库该提交的执行层阻断，不是外部 profile 根目录问题。
- 同时，`risk_state_output.current_state=paused` 仍未解除，本轮也没有新增 approval / headers matrix / API primary success 样本。
- 因此 `search/detail/user_home` 三类场景都没有达到 `route_role=primary + path_kind=api + evidence_status=success + reproduced_multi_round`。
- issue `#445` 本轮正式 Go/No-Go 结论继续维持：`No-Go/paused`。
- 当前唯一允许写入 formal FR 的停点应是：`仍缺某些场景的 API primary 成功/矩阵证据，继续 No-Go/paused`。

## 未决项（进入下一轮复核前保留）

- 保持 `xhs_001` 的 main 目录绑定不再回写到 worktree 路径
- 修复 latest head 的 XHS read 执行 bundle 缺陷（当前 fresh rerun 失败原文：`executeXhsSearchImpl is not defined`）
- 在修复 latest head 的执行 bundle 缺陷后，再重新执行 `search/detail/user_home` 的 managed-profile `real_browser` fresh live rerun
- 在新会话样本中复核 `detail` 的成功路径与最小必要请求上下文
- 在新会话样本中复核 `user_home` 主端点（含 `otherinfo` 与候选聚合端点）的成功路径
- 对 `search/detail/user_home` 分别完成“required_headers 最小必要集”实验矩阵
- 复核 `a1 / webId / gid` 的跨刷新与跨会话生命周期
- 复核 `window._webmsxyw` 的页面/版本分流条件，并补统一降级策略
