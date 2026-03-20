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

- 每条证据显式包含 `route_role`、`path_kind`、`evidence_status`。
- `route_role=fallback` 且 `path_kind=page` 的证据统一标记为 `fallback-only`，只作为降级路径证据，不构成实现准入。
- 仅 `route_role=primary` + `evidence_status=success` 且补齐最小必要请求上下文实验矩阵，才可进入实现准入；当前轮次尚未满足。

### 2.1 search

| evidence_id | route_role | path_kind | evidence_status | method | path | 证据摘要 | 准入作用 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `search-primary-01` | `primary` | `api` | `success` | `POST` | `/api/sns/web/v1/search/notes` | 真实搜索交互中观测到 `HTTP 200` 成功样本 | 主路径强证据，但仍缺最小必要 headers/cookie/origin 矩阵 |
| `search-primary-02` | `primary` | `api` | `failed` | `POST` | `/api/sns/web/v1/search/notes` | 手动仅补 `X-s/X-t` 得到 `HTTP 500` + `create invoker failed` | 阻断“仅双字段签名可复现”的假设 |
| `search-fallback-01` | `fallback` | `api` | `candidate` | `GET/POST` | `/api/sns/web/v1/search/recommend` / `/api/sns/web/v1/search/filter` / `/api/sns/web/v1/search/onebox` | 同批次可见成功请求，但未证明可替代主读链路 | `fallback-only`（不构成实现准入） |

当前结论：

- `search/notes` 仍是 `primary` 候选主路径，但未达“实现准入”。
- `search` 场景当前无可冻结的 `page` fallback 成功证据；现有 `fallback` 证据均按 `fallback-only` 处理，不构成实现准入。
- 当前已观测头族：`Accept`、`Content-Type`（POST）、`x-b3-traceid`、`x-xray-traceid`、`X-s`、`X-t`、`X-S-Common`；Cookie/Origin/Referer/UA-CH 仍为候选必要项。

### 2.2 detail

| evidence_id | route_role | path_kind | evidence_status | method | path | 证据摘要 | 准入作用 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `detail-fallback-01` | `fallback` | `page` | `success` | `GET` | `/explore/<noteId>?xsec_token=...&xsec_source=...` | 页面命中后 `window.__INITIAL_STATE__` 为 `object`，`note.noteDetailMap` 可读到当前 `noteId` | `fallback-only`（不构成实现准入） |
| `detail-primary-01` | `primary` | `api` | `candidate` | `POST` | `/api/sns/web/v1/feed` | 存在端点与参数形态（`source_note_id`）证据，但无成功闭环 | 主路径候选，未准入 |
| `detail-primary-02` | `primary` | `api` | `failed` | `POST` | `/api/sns/web/v1/feed` | 手动请求返回 `HTTP 461` + `code=300011`（账号异常） | 风控阻断证据 |

`detail-fallback-01` 对应 `page_state_fallback` 冻结快照：

```json
{
  "url_params_observed": [
    { "name": "noteId", "source": "path_segment", "required": true },
    { "name": "xsec_token", "source": "query", "required": true },
    { "name": "xsec_source", "source": "query", "required": false }
  ],
  "state_probe": {
    "root_path": "window.__INITIAL_STATE__",
    "root_expect": "object",
    "key_paths_observed": ["note.noteDetailMap", "note.noteDetailMap.<noteId>"]
  },
  "replay_actions": [
    { "step": "open_url", "target": "/explore/<noteId>?xsec_token=...&xsec_source=...", "expect": "page_loaded" },
    { "step": "eval_js", "target": "typeof window.__INITIAL_STATE__", "expect": "object" },
    { "step": "eval_js", "target": "window.__INITIAL_STATE__.note.noteDetailMap", "expect": "contains current noteId" }
  ]
}
```

当前结论：

- detail 的 `page` 路径只有 `fallback-only` 价值。
- detail 的 `api primary` 未获得成功样本，不构成实现准入。

### 2.3 user_home

| evidence_id | route_role | path_kind | evidence_status | method | path | 证据摘要 | 准入作用 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `user-home-fallback-01` | `fallback` | `page` | `success` | `GET` | `/user/profile/<userId>?xsec_token=...&xsec_source=pc_search` | 页面命中后 `window.__INITIAL_STATE__` 为 `object`，顶层可见 `user`/`board`/`note` | `fallback-only`（不构成实现准入） |
| `user-home-primary-01` | `primary` | `api` | `success` | `GET` | `/api/sns/web/v1/board/user?user_id=...&num=15&page=1` | 搜索交互同批次观测到 `HTTP 200` | 单点成功证据，尚不足以形成主路径准入 |
| `user-home-primary-02` | `primary` | `api` | `failed` | `GET` | `/api/sns/web/v1/user/otherinfo?...` | 手动仅补 `X-s/X-t` 返回 `HTTP 200 + code=300015`（环境异常） | 阻断“低上下文请求可复现”假设 |
| `user-home-primary-03` | `primary` | `api` | `candidate` | `GET` | `/api/sns/web/v1/user/otherinfo?...` | 端点语义相关，但本轮无成功闭环 | 候选，不准入 |

`user-home-fallback-01` 对应 `page_state_fallback` 冻结快照：

```json
{
  "url_params_observed": [
    { "name": "userId", "source": "path_segment", "required": true },
    { "name": "xsec_token", "source": "query", "required": true },
    { "name": "xsec_source", "source": "query", "required": false }
  ],
  "state_probe": {
    "root_path": "window.__INITIAL_STATE__",
    "root_expect": "object",
    "key_paths_observed": ["user", "board", "note"]
  },
  "replay_actions": [
    { "step": "open_url", "target": "/user/profile/<userId>?xsec_token=...&xsec_source=pc_search", "expect": "page_loaded" },
    { "step": "eval_js", "target": "typeof window.__INITIAL_STATE__", "expect": "object" },
    { "step": "eval_js", "target": "window.__INITIAL_STATE__.user", "expect": "object" }
  ]
}
```

当前结论：

- user_home 的 `page` 路径仅为 `fallback-only`。
- user_home 的 `primary api` 仍缺“可稳定读取核心字段 + 最小必要请求上下文”的闭环证据，不构成实现准入。

## 3. 签名链路与字段生命周期（本轮可保守冻结）

### 3.1 签名链路

- 当前可确认入口仍是浏览器内 `window._webmsxyw(uri, data)`。
- 但入口存在页面/加载时机/版本分流（`/explore`、detail 页可用；`search_result` 某变体与 profile 页的早期样本出现过不可用）。
- 因此只能冻结为“候选主入口 + 分流风险”，不能冻结为“全局稳定唯一入口”。

### 3.2 生命周期矩阵（已确认 vs 候选）


| 字段 | 来源 | 本轮状态 | 生命周期判断 | 依赖等级 | 说明 |
| --- | --- | --- | --- | --- | --- |
| `X-s` | `runtime_generated` | 第一手已观测 | `request_scoped` 候选 | `hard` | 由浏览器内签名调用 `window._webmsxyw(uri, data)` 返回 |
| `X-t` | `runtime_generated` | 第一手已观测 | `request_scoped` 候选 | `hard` | 由浏览器内签名调用 `window._webmsxyw(uri, data)` 返回 |
| `X-S-Common` | `page_state` | 第一手已观测（请求头） | `session_scoped` 候选 | `required_optional` | 仅确认出现在请求头，仍需复核是否会退化为 `page_refresh_scoped` |
| `x-b3-traceid` | `runtime_generated` | 第一手已观测（请求头） | `request_scoped` 候选 | `required_optional` | 生成机制未复核，当前先按运行时生成处理 |
| `x-xray-traceid` | `runtime_generated` | 第一手已观测（请求头） | `request_scoped` 候选 | `required_optional` | 生成机制未复核，当前先按运行时生成处理 |
| `a1` | `page_state` | 第一手已观测（Cookie） | `session_scoped` 候选 | `required_optional` | 仅确认可读到，未做跨刷新对比，尚未证明是最小必要条件 |
| `webId` | `page_state` | 第一手已观测（Cookie） | `session_scoped` 候选 | `required_optional` | 且已有证据表明不在 local/session storage，仍需复核是否会退化为 `page_refresh_scoped` |
| `gid` | `page_state` | 第一手已观测（Cookie） | `session_scoped` 候选 | `required_optional` | 且已有证据表明不在 local/session storage，仍需复核是否会退化为 `page_refresh_scoped` |
| `xsecappid` | `page_state` | 第一手已观测（Cookie） | `session_scoped` 候选 | `required_optional` | 仅确认可读 |
| `xsec_token` | `page_state` | 第一手已观测（DOM URL） | `page_refresh_scoped` 候选 | `required_optional` | 由 URL 抽样获得 |
| `xsec_source` | `static` | 第一手已观测（DOM URL） | `page_refresh_scoped` 候选 | `required_optional` | 由 URL 抽样获得，仍需复核是否受页面状态改写 |


## 4. 错误分类更新（含本轮新增）


| 错误码 / 现象                                | 语义             | 建议分类                      |
| --------------------------------------- | -------------- | ------------------------- |
| `300015` + Browser environment abnormal | 浏览器环境校验失败      | `browser_env_abnormal`    |
| `300011` + Account abnormal             | 账号异常/风控阻断      | `account_abnormal`        |
| `HTTP 500` + create invoker failed      | 网关侧调用失败（上下文不足） | `gateway_invoker_failed`  |
| `window._webmsxyw` 缺失                   | 页面脚本分流/漂移      | `signature_entry_missing` |


## 5. 当前状态与暂停说明

本轮浏览器内复核为“部分完成”：

- 已有：`search` 相关成功样本、detail/profile 页面级 `__INITIAL_STATE__` 证据、签名入口分流证据、Cookie/DOM 一手样本、多类失败样本。
- 未有：`detail` 与 `user_home` 的稳定成功闭环证据，及每个端点“最小必要 headers”严格证明。

由于已出现 `account abnormal`，本轮 live 复核到此为止。后续需要在账号/环境恢复后继续，当前结论不得直接转写为“实现已就绪”。

## 未决项（进入下一轮复核前保留）

- 在新会话样本中复核 `detail` 的成功路径与最小必要请求上下文
- 在新会话样本中复核 `user_home` 主端点（含 `otherinfo` 与候选聚合端点）的成功路径
- 对 `search/detail/user_home` 分别完成“required_headers 最小必要集”实验矩阵
- 复核 `a1 / webId / gid` 的跨刷新与跨会话生命周期
- 复核 `window._webmsxyw` 的页面/版本分流条件，并补统一降级策略
