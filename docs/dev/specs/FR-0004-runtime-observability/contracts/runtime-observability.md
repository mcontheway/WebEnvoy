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

- 保留用于定位问题所需的稳定主干信息，例如 `scheme://host/path`
- 默认移除 `query` 与 `fragment`
- 若业务场景必须保留部分查询参数，仅允许白名单字段，并且必须对 `token`、`code`、`signature`、`sig`、`auth` 这类敏感参数做替换或删除

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
      "ready_state": "complete"
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
    "failure_site": null
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
      ]
    }
  },
  "observability": {
    "page_state": {
      "page_kind": "login",
      "url": "https://example.com/login",
      "title": "Example Login",
      "ready_state": "complete"
    },
    "key_requests": [],
    "failure_site": {
      "stage": "action",
      "component": "page",
      "target": "selector:#publish-button",
      "summary": "expected selector missing"
    }
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
- `url`：关键请求的规范化 URL 或路径，必须默认仅保留定位问题所需的主干信息；query、fragment 和可能携带 token / signature 的参数必须删除或替换
- `outcome`

可选字段：

- `status_code`
- `failure_reason`
- `request_class`

### `observability.failure_site`

失败位置至少应包含：

- `stage`
- `component`
- `target`
- `summary`

### `error.diagnosis`

诊断对象至少应包含：

- `category`
- `stage`
- `component`
- `failure_site`
- `evidence`

最小分类集合：

- `page_changed`
- `request_failed`
- `execution_interrupted`
- `runtime_unavailable`
- `unknown`

## 兼容策略

- 该契约只允许增量扩展，不允许重定义 FR-0001 外层壳。
- 旧实现若没有 `observability` 或 `error.diagnosis`，消费者必须能降级处理。
- 新字段只允许增加，不允许修改既有字段的语义。
- 诊断证据必须受长度和敏感信息约束，避免因为载荷膨胀破坏 Native Messaging 传输。

## 约束

- 不返回 Cookie、Authorization、Token、完整响应体、完整 HTML 或页面截图原文。
- 不返回长篇自由文本诊断，证据必须是短句或枚举化描述。
- 不依赖稳定的私有实现细节作为契约字段。
