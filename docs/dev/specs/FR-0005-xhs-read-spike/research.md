# FR-0005 研究记录（正式输入）

## 研究问题

1. 小红书核心读链路的最小稳定端点集合是什么。
2. 页面签名函数最小调用路径是否可稳定复现。
3. 关键追踪字段在请求级/会话级/刷新级的变化规律是什么。

## 当前证据基线

本轮 Spike 先基于以下已落盘证据收敛正式输入，不把零散调研留在口头层：

1. 仓库内调研：
   - `docs/research/ref/MediaCrawlerPro_analysis.md`
   - `docs/archive/tech-selection-preresearch.md`
   - `docs/dev/architecture/system-design/reference.md`
2. 参考实现源码：
   - `reference/MediaCrawlerPro/Python-main/media_platform/xhs/client.py`
   - `reference/MediaCrawlerPro/Python-main/media_platform/xhs/handlers/search_handler.py`
   - `reference/MediaCrawlerPro/Python-main/media_platform/xhs/help.py`
   - `reference/MediaCrawlerPro/Python-main/media_platform/xhs/extractor.py`
   - `reference/MediaCrawlerPro/Python-main/media_platform/xhs/exception.py`
   - `reference/MediaCrawlerPro/Python-main/pkg/rpc/sign_srv_client/sign_model.py`

> 结论口径：
> - 本文件已经足够作为后续 L3 读适配 FR 的输入基线。
> - 但其中“字段生命周期”仍分为 `已确认` 与 `待浏览器内复核` 两级，不把参考实现观察误写成已在 WebEnvoy 运行时内实锤。

## 1. 端点结论

### 1.1 搜索列表

- 场景：`search`
- 方法：`POST`
- 路径：`/api/sns/web/v1/search/notes`
- 最小请求字段：
  - `keyword`
  - `page`
  - `page_size`
  - `search_id`
  - `sort`
  - `note_type`
- 最小成功信号：
  - `HTTP 200`
  - 业务码成功
  - 返回列表字段与分页信息
- 已知失败信号：
  - `471/461`：验证码
  - `300013`：访问频次异常
  - `300015`：签名失败
  - `-100`：登录过期
- 证据来源：
  - `MediaCrawlerPro_analysis.md` §4.1 / §4.3
  - `media_platform/xhs/client.py`
  - `media_platform/xhs/handlers/search_handler.py`

### 1.2 笔记详情

- 场景：`detail`
- 方法：`POST`
- 路径：`/api/sns/web/v1/feed`
- 最小请求字段：
  - `source_note_id`
- 备用路径：
  - 访问笔记 HTML 后读取 `window.__INITIAL_STATE__`
- 最小成功信号：
  - `HTTP 200`
  - 响应中存在 note 详情结构
- 已知失败信号：
  - `300015`：签名失败
  - `-100`：登录过期
  - 页面结构漂移导致 `__INITIAL_STATE__` 解析失败
- 证据来源：
  - `MediaCrawlerPro_analysis.md` §4.1 / §4.4
  - `media_platform/xhs/client.py`
  - `media_platform/xhs/extractor.py`

### 1.3 用户主页

- 场景：`user_home`
- 当前最小候选端点：`GET /api/sns/web/v1/user_posted`
- 关联会话探针：`GET /api/sns/web/v1/user/selfinfo`
- 最小请求字段：
  - `user_id`
  - `cursor`
  - `num`
- 最小成功信号：
  - `HTTP 200`
  - 返回用户作品列表或用户自身信息
- 已知失败信号：
  - `-100`：登录过期
  - `300015`：签名失败
  - 无作品用户返回空列表
- 说明：
  - 现阶段把 `user_posted` 作为“用户主页读链路”的最小 API 候选，后续若页面自然流量显示存在更贴近主页聚合接口，再进入后续 FR 调整，不在本 Spike 内过度扩张。
- 证据来源：
  - `media_platform/xhs/client.py`
  - `MediaCrawlerPro_analysis.md` §4.1

## 2. 签名结论

### 2.1 最小调用入口

- 当前最小入口：`window._webmsxyw(uri, data)`
- 调用位置：
  - 平台页面已加载后的浏览器内 JS 上下文
  - 对 WebEnvoy 来说，应由 `Content Script -> MAIN World` 触达，而不是浏览器外签名服务
- 前置条件：
  - 页面处于已登录且目标脚本已加载状态
  - 请求 URI 与请求体已确定

### 2.2 最小输入

- `uri`: 请求路径字符串
- `data`: 请求体对象或序列化字符串
- 关联上下文：
  - 当前登录 Cookie
  - 页面环境中已有的会话/设备相关状态

### 2.3 最小输出

- 主签名字段：
  - `X-s`
  - `X-t`
  - `x-s-common`
  - `X-B3-Traceid`
- 对 WebEnvoy 的实施意义：
  - 后续 L3 读适配至少要承载这 4 个字段的观测和错误分类
  - 不应先承诺复刻 SignSrv 或浏览器外离线签名链路

### 2.4 已知失效信号

- `window._webmsxyw` 缺失
- 调用抛异常
- 签名存在但请求返回 `300015`
- 页面脚本版本漂移导致输出字段缺失或形态改变

## 3. 字段生命周期结论

### 3.1 已确认：请求级变化

| 字段 | 来源 | 生命周期 | 依赖等级 | 说明 |
|---|---|---|---|---|
| `search_id` | `runtime_generated` | `request_scoped` | `required_optional` | 由客户端生成的搜索请求标识 |
| `X-s` | `page_state` | `request_scoped` | `hard` | 由签名函数针对本次请求生成 |
| `X-t` | `page_state` | `request_scoped` | `hard` | 与本次签名调用绑定 |
| `X-B3-Traceid` | `runtime_generated/page_state` | `request_scoped` | `required_optional` | 链路追踪字段，后续需在浏览器内复核来源 |

### 3.2 已确认：会话级稳定或偏稳定

| 字段 | 来源 | 生命周期 | 依赖等级 | 说明 |
|---|---|---|---|---|
| Cookie | `page_state` | `session_scoped` | `hard` | 真实登录态强依赖 |
| `x-s-common` | `page_state` | `session_scoped` 候选 | `hard` | 含设备/环境相关信息，具体粒度待浏览器内复核 |

### 3.3 待浏览器内复核：页面刷新级或会话级

| 字段 | 当前候选 | 生命周期候选 | 依赖等级 | 说明 |
|---|---|---|---|---|
| `a1` | `page_state` | `session_scoped` | `hard` | 参考架构文档与调研，需在 WebEnvoy 链路内确认 |
| `webId` | `page_state` | `page_refresh_scoped` 或 `session_scoped` | `required_optional` | 需通过浏览器内多次对比确认 |
| `gid` | `page_state/runtime_generated` | `page_refresh_scoped` 候选 | `required_optional` | 当前仅有调研结论，未在 WebEnvoy 内实锤 |
| `xsec_token` | `page_state` | `page_refresh_scoped` | `required_optional` | 详情页 URL 相关字段 |
| `xsec_source` | `static/page_state` | `page_refresh_scoped` | `required_optional` | 详情页 URL 相关字段 |

## 4. 错误分类结论

本 Spike 可直接冻结给后续实现的最小错误分类：

| 错误码 / 现象 | 语义 | 后续建议分类 |
|---|---|---|
| `471` / `461` | 验证码 / 滑块 | `captcha` |
| `300012` | IP 被封锁 | `ip_blocked` |
| `300013` | 访问频次异常 | `access_frequency` |
| `300015` | 签名失败 | `invalid_sign` |
| `-100` | 登录过期 | `session_expired` |
| `window._webmsxyw` 缺失 | 页面脚本漂移 | `signature_entry_missing` |
| `chrome.runtime` / content-script 不可达 | 运行时链路失败 | `runtime_chain_unavailable` |

## 5. 当前可直接进入后续 FR 的结论

1. 搜索、详情、用户主页三类场景的最小候选端点已经足够明确。
2. 签名链路可以直接以“浏览器内调用平台自有函数”作为后续实现基线，不需要引入外置 SignSrv。
3. 最小错误分类已经足够指导后续适配器实现和 `#154` 诊断对齐。
4. 字段生命周期矩阵已经能支撑后续 TDD 拆分：哪些字段要作为 `hard dependency`，哪些先按候选字段处理。

## 未决项

- [ ] 需要在 WebEnvoy 浏览器内链路中复核 `a1 / webId / gid` 的精确生命周期
- [ ] 需要在浏览器内确认 `window._webmsxyw` 的输入 / 输出对象形态是否有版本分流
- [ ] 需要通过真实会话样本补齐“未登录 / 会话过期 / 风控拦截”在 WebEnvoy 诊断壳中的最终映射
