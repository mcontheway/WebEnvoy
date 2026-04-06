# 运行时观测与诊断契约

## 边界名称与适用范围

本契约定义 FR-0004 为 Phase 1 最小闭环补充的结构化观测与诊断字段。

适用范围：

- Phase 1 首个平台读闭环
- 成功响应中的最小页面状态与关键请求摘要
- 错误响应中的失败位置与结构化诊断
- 复用 FR-0001 冻结的外层成功 / 错误壳

不适用范围：

- 完整 trace 系统
- 会话回放系统
- 暂停 / 恢复状态机
- 长期观测仓库或分析服务

## 生产者 / 消费者

- 生产者：CLI 结果格式化层、运行时执行层、页面观察层
- 直接消费者：AI Agent、测试程序、后续 Phase 1 / Phase 2 FR
- 间接消费者：需要复用最小诊断结构的后续能力封装逻辑

## 输入

输入不是用户直接提供的数据，而是运行时在一次命令执行窗口中采集到的观测信号：

- 页面状态信号
- 关键请求信号
- 失败位置信号
- 运行时连接与执行中断信号

这些输入必须在进入最终响应前被裁剪、归一化和脱敏。

URL 类字段必须默认做净化处理：

- 页面 URL 只保留 `scheme://host/path`
- 关键请求 URL 在同源场景下只保留 origin-less path（例如 `/api/feed`）；仅当请求不是同源目标时才保留 `scheme://host/path`
- 默认移除全部 `query` 与 `fragment`
- Phase 1 不保留任何查询参数白名单；若后续 FR 需要保留参数，必须单独扩展本契约

进入最终响应前必须先执行以下脱敏规则：

- 删除或替换 Cookie、`Authorization`、`Set-Cookie`、Bearer Token、一次性验证码、签名串与 OAuth code
- 把疑似密钥、JWT、长随机串或高熵标识替换为统一占位符 `[redacted]`
- 不得把原始请求体、原始响应体、完整 DOM、完整 HTML 片段或页面截图文字直接拼进证据字段

进入最终响应前必须执行以下 Phase 1 截断规则：

- `observability.key_requests` 最多保留 5 条
- `error.diagnosis.evidence` 最多保留 5 条
- `page_state.title`、`failure_site.target`、`failure_site.summary`、`key_requests[*].failure_reason`、`diagnosis.evidence[*]` 每项最多 160 个字符
- `page_state.url` 与 `key_requests[*].url` 在净化后仍最多保留 200 个字符
- `observability + error.diagnosis` 的总序列化预算默认不超过 8 KB

若发生裁剪，必须显式返回截断标记，而不是静默吞掉字段。

## 输出

### 成功响应中的观测对象

示例中的 `url` 已按净化规则处理，仅保留用于定位问题的稳定地址主干；真实实现返回时不得包含 query 或 fragment。

```json
{
  "run_id": "run-20260319-0001",
  "command": "xhs.search",
  "status": "success",
  "summary": {
    "message": "ok"
  },
  "observability": {
    "page_state": {
      "page_kind": "feed",
      "url": "https://example.com/feed",
      "title": "Example Feed",
      "ready_state": "complete",
      "observation_status": "complete"
    },
    "key_requests": [
      {
        "request_id": "req-1",
        "stage": "request",
        "method": "GET",
        "url": "/api/feed",
        "outcome": "completed",
        "status_code": 200
      }
    ],
    "failure_site": null,
    "truncated": false
  },
  "timestamp": "2026-03-19T12:00:00.000Z"
}
```

### 错误响应中的观测对象

```json
{
  "run_id": "run-20260319-0002",
  "command": "xhs.search",
  "status": "error",
  "error": {
    "code": "ERR_EXECUTION_FAILED",
    "message": "命令执行失败",
    "retryable": false,
    "diagnosis": {
      "category": "page_changed",
      "stage": "action",
      "component": "page",
      "failure_site": {
        "stage": "action",
        "component": "page",
        "target": "selector:#publish-button"
      },
      "evidence": [
        "expected selector missing",
        "page kind changed from compose to login"
      ],
      "truncated": false
    }
  },
  "observability": {
    "page_state": {
      "page_kind": "login",
      "url": "https://example.com/login",
      "title": "Example Login",
      "ready_state": "complete",
      "observation_status": "complete"
    },
    "key_requests": [],
    "failure_site": {
      "stage": "action",
      "component": "page",
      "target": "selector:#publish-button",
      "summary": "expected selector missing"
    },
    "truncated": false
  },
  "timestamp": "2026-03-19T12:00:01.000Z"
}
```

## 错误 / 状态返回

### `observability.page_state`

最小字段：

- `page_kind`：当前页面的最小语义分类，例如 `feed`、`detail`、`compose`、`login`、`unknown`
- `url`：当前页面的规范化 URL，必须默认仅保留 `scheme://host/path`；query、fragment 和携带凭据的片段必须删除或替换为脱敏值
- `title`：页面标题
- `ready_state`：文档加载状态
- `observation_status`：观测状态，取值至少包含 `complete`、`partial`、`unavailable`

允许按需扩展的字段：

- `visibility_state`
- `route`
- `active_frame`
- `dialog_present`

### `observability.key_requests`

每条关键请求至少应包含：

- `request_id`
- `stage`
- `method`
- `url`：关键请求的规范化地址；同源请求必须输出 origin-less path，非同源请求才输出 `scheme://host/path`；query、fragment 和可能携带 token / signature 的参数必须删除或替换
- `outcome`

可选字段：

- `status_code`
- `failure_reason`
- `request_class`

枚举与约束：

- `stage` 只允许使用 `page_load`、`request`、`action`、`settle_wait`、`runtime_link`
- `outcome` 只允许使用 `completed`、`failed`、`timeout`、`skipped`
- `failure_reason` 只允许返回脱敏后的短摘要，不得回传原始响应内容

### `observability.failure_site`

失败位置至少应包含：

- `stage`
- `component`
- `target`
- `summary`

约束：

- `component` 只允许返回 `cli`、`extension`、`content_script`、`page`、`network`
- `target` 只允许返回最小定位片段，例如规范化 URL 主干、逻辑动作名或截断后的 selector 摘要
- `summary` 必须在脱敏后输出，不得回传页面原文长片段

### `error.diagnosis`

诊断对象至少应包含：

- `category`
- `stage`
- `component`
- `failure_site`
- `evidence`

可选字段：

- `truncated`

最小分类集合：

- `page_changed`
- `request_failed`
- `execution_interrupted`
- `runtime_unavailable`
- `unknown`

字段处理顺序固定为：

1. 归一化
2. URL 净化
3. 敏感信息脱敏
4. 长度截断
5. 总预算裁剪

若在第 4/5 步发生裁剪：

- `observability.truncated=true` 表示观察字段发生过裁剪
- `error.diagnosis.truncated=true` 表示诊断字段发生过裁剪

## 兼容策略

- 该契约只允许增量扩展，不允许重定义 FR-0001 外层壳。
- 旧实现若没有 `observability` 或 `error.diagnosis`，消费者必须能降级处理。
- 新字段只允许增加，不允许修改既有字段的语义。
- 诊断证据必须受长度和敏感信息约束，避免因为载荷膨胀破坏 FR-0002 已冻结的 Native Messaging 承载边界。

## 约束

- 不返回 Cookie、Authorization、Token、完整响应体、完整 HTML 或页面截图原文。
- 不返回长篇自由文本诊断，证据必须是短句或枚举化描述。
- 不依赖稳定的私有实现细节作为契约字段。
- 不引入新的 transport envelope、额外的 link-layer 握手字段或单独分片协议去承载诊断信息。
