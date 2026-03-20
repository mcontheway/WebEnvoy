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

结论（受限于本轮样本）：签名入口至少存在页面、加载时机或版本分流，不能写成全局稳定入口。

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

## 2. 场景化端点结论（按证据强度拆分）

### 2.1 search

第一手成功证据：

- 在真实搜索交互中，`search/recommend`、`search/filter`、`search/onebox`、`search/notes` 出现成功 `HTTP 200`。

候选或失败证据：

- 手动直调 `search/notes` 且仅补 `X-s/X-t`，得到 `HTTP 500`（`create invoker failed`），说明“仅两字段签名”不足以稳定复现。

`required_headers` 已观测（基于成功/失败样本抓到的头族）：

- `Accept`
- `Content-Type: application/json;charset=utf-8`（POST）
- `x-b3-traceid`
- `x-xray-traceid`
- `X-s`
- `X-t`
- `X-S-Common`

`required_headers` 候选（本轮未实锤“最小必要”）：

- 浏览器自动附加上下文头与会话上下文（如 Cookie、Origin、Referer、UA Client Hints）。

### 2.2 detail

第一手成功证据：

- 直接打开笔记页 `https://www.xiaohongshu.com/explore/<noteId>?xsec_token=...&xsec_source=...` 可稳定进入详情页。
- 当前 detail 页 `window.__INITIAL_STATE__` 为 `object`，且 `note.noteDetailMap` 中可直接提取当前 `noteId`。
- 因此“详情页 HTML / `__INITIAL_STATE__` 读取”这条备用读路径已得到第一手页面级证据。

候选或失败证据：

- `POST /api/sns/web/v1/feed` 手动构造请求后得到 `HTTP 461` + `code=300011`（账号异常）。
- 现阶段仍没有 `feed` 端点的成功 `HTTP 200 + 业务成功` 样本，不能把 API 详情读路径冻结为已确认。

`required_headers` 已观测：

- 在失败样本中显式使用了：
  - `Accept`
  - `Content-Type: application/json;charset=utf-8`
  - `x-b3-traceid`
  - `x-xray-traceid`
  - `X-s`
  - `X-t`
  - `X-S-Common`

`required_headers` 候选（未被成功样本验证）：

- Cookie/页面上下文相关头可能仍为必要条件。

### 2.3 user_home

第一手成功证据：

- 在搜索交互同批次里观察到 `GET /api/sns/web/v1/board/user?...` 成功 `HTTP 200`。
- 直接打开 `user/profile/<userId>?xsec_token=...&xsec_source=pc_search` 可稳定进入用户主页。
- 该 profile 页 `window.__INITIAL_STATE__` 为 `object`，顶层包含 `user`、`board`、`note` 等 store。
- 该证据当前仅能标记为“用户域相关成功请求”，尚不能直接冻结为 `user_home` 主端点契约。

候选或失败证据：

- `GET /api/sns/web/v1/user/otherinfo?...` 手动请求（仅 `X-s/X-t`）返回 `HTTP 200 + code=300015`（浏览器环境异常）。
- 因账号异常，未完成“可稳定读取用户主页核心字段”的闭环复核。

`required_headers` 已观测：

- `board/user` 成功样本可见头族：`Accept`、`x-b3-traceid`、`x-xray-traceid`、`X-s`、`X-t`、`X-S-Common`。

`required_headers` 候选（未实锤）：

- `user/otherinfo` 可能需要完整浏览器上下文头、Cookie 和页面上下文一致性；本轮无成功样本，不做更强断言。

## 3. 签名链路与字段生命周期（本轮可保守冻结）

### 3.1 签名链路

- 当前可确认入口仍是浏览器内 `window._webmsxyw(uri, data)`。
- 但入口存在页面/加载时机/版本分流（`/explore`、detail 页可用；`search_result` 某变体与 profile 页的早期样本出现过不可用）。
- 因此只能冻结为“候选主入口 + 分流风险”，不能冻结为“全局稳定唯一入口”。

### 3.2 生命周期矩阵（已确认 vs 候选）


| 字段               | 本轮状态            | 生命周期判断                                      | 依赖等级                | 说明                              |
| ---------------- | --------------- | ------------------------------------------- | ------------------- | ------------------------------- |
| `X-s`            | 第一手已观测          | `request_scoped` 候选                         | `hard`              | 签名调用返回键                         |
| `X-t`            | 第一手已观测          | `request_scoped` 候选                         | `hard`              | 签名调用返回键                         |
| `X-S-Common`     | 第一手已观测（请求头）     | `session_scoped` 或 `page_refresh_scoped` 候选 | `required_optional` | 仅确认出现在请求头，稳定性未实锤                |
| `x-b3-traceid`   | 第一手已观测（请求头）     | `request_scoped` 候选                         | `required_optional` | 来源/生成机制未复核                      |
| `x-xray-traceid` | 第一手已观测（请求头）     | `request_scoped` 候选                         | `required_optional` | 来源/生成机制未复核                      |
| `a1`             | 第一手已观测（Cookie）  | `session_scoped` 候选                         | `hard`              | 仅确认可读到，未做跨刷新对比                  |
| `webId`          | 第一手已观测（Cookie）  | `session_scoped` 或 `page_refresh_scoped` 候选 | `required_optional` | 且已有证据表明不在 local/session storage |
| `gid`            | 第一手已观测（Cookie）  | `session_scoped` 或 `page_refresh_scoped` 候选 | `required_optional` | 且已有证据表明不在 local/session storage |
| `xsecappid`      | 第一手已观测（Cookie）  | `session_scoped` 候选                         | `required_optional` | 仅确认可读                           |
| `xsec_token`     | 第一手已观测（DOM URL） | `page_refresh_scoped` 候选                    | `required_optional` | 由 URL 抽样获得                      |
| `xsec_source`    | 第一手已观测（DOM URL） | `page_refresh_scoped` 候选                    | `required_optional` | 由 URL 抽样获得                      |


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
