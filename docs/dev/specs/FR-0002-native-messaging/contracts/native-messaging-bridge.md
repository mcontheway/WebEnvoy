# Native Messaging Bridge 契约

## 边界名称与适用范围

本契约定义 FR-0002 的最小通信边界，适用于：

- CLI 与 Extension Background 的 Native Messaging 握手
- Background 与 Content Script 的最小消息转发
- 心跳、断连和超时判定
- link-layer 错误分类

本契约不定义：

- FR-0001 的 CLI 外层 argv 契约
- 页面业务命令的具体语义
- SQLite 持久化结构
- 多 tab 广播或消息总线
- 远程 WebSocket 通道

## 生产者 / 消费者

- 生产者：
  - CLI Native Host
  - Extension Background
  - Content Script
- 直接消费者：
  - FR-0001 冻结的 CLI 调用面
  - 后续需要进入页面侧的运行时命令
- 间接消费者：
  - `#145`
  - `#146`
  - `#147`
  - `#148`

## 协议版本

- 协议名：`webenvoy.native-bridge`
- 初始版本：`v1`
- 所有控制消息和转发消息都必须显式携带版本信息或能够从握手中推导版本
- 版本不兼容时必须拒绝进入 `ready`

## 会话握手

### 请求

```json
{
  "type": "bridge.open",
  "protocol": "webenvoy.native-bridge.v1",
  "run_id": "run-20260319-0001",
  "profile": "xhs_account_001",
  "timestamp": "2026-03-19T12:00:00.000Z",
  "capabilities": ["relay", "heartbeat"]
}
```

### 响应

```json
{
  "type": "bridge.opened",
  "protocol": "webenvoy.native-bridge.v1",
  "session_id": "nm-session-001",
  "run_id": "run-20260319-0001",
  "status": "ready",
  "timestamp": "2026-03-19T12:00:00.100Z"
}
```

### 约束

- `run_id` 必须来源于 FR-0001 的标准化命令上下文
- `profile` 透传即可，不在 transport 层重新解释
- 握手成功前，Background 不能宣称会话可用
- 握手失败时，必须返回可区分的失败原因
- 实际连接方向由 Background 主动发起 Native Messaging 连接，CLI 仅在连接建立后完成握手响应

## 最小转发消息

### 请求

```json
{
  "type": "bridge.forward",
  "session_id": "nm-session-001",
  "run_id": "run-20260319-0001",
  "correlation_id": "corr-001",
  "command": "runtime.ping",
  "profile": null,
  "params": {},
  "cwd": "/workspace/WebEnvoy"
}
```

### 响应

```json
{
  "type": "bridge.result",
  "session_id": "nm-session-001",
  "run_id": "run-20260319-0001",
  "correlation_id": "corr-001",
  "status": "success",
  "payload": {
    "message": "pong"
  },
  "timestamp": "2026-03-19T12:00:00.300Z"
}
```

### 约束

- 转发消息必须保留 `run_id` 与 `command`
- `correlation_id` 只用于同一条消息的请求-响应配对
- Background 只能做路由和状态管理，不能重写页面业务 payload
- Content Script 返回的 `payload` 必须视为 opaque object
- 本 FR 不要求多消息并发

## 心跳

### 请求

```json
{
  "type": "__ping__",
  "session_id": "nm-session-001",
  "timestamp": "2026-03-19T12:00:20.000Z"
}
```

### 响应

```json
{
  "type": "__pong__",
  "session_id": "nm-session-001",
  "timestamp": "2026-03-19T12:00:20.010Z"
}
```

### 约束

- Background 侧必须周期性发送心跳
- CLI 必须立即响应心跳
- 心跳丢失必须触发断连判定
- 断连状态下不得继续复用旧会话

## 断连

### 事件

```json
{
  "type": "bridge.closed",
  "session_id": "nm-session-001",
  "reason": "disconnected",
  "detail": {
    "source": "native-messaging"
  },
  "timestamp": "2026-03-19T12:00:30.000Z"
}
```

### 约束

- 断连必须是显式状态，不得默默吞掉
- 断连后，后续消息必须先重新握手
- 正在等待中的转发请求必须失败返回

## 错误分类

### Link-layer 错误码

| 错误码 | 语义 | 典型触发 |
|---|---|---|
| `ERR_TRANSPORT_HANDSHAKE_FAILED` | 握手失败 | host 不可用、版本不兼容、manifest 路径不可解析 |
| `ERR_TRANSPORT_NOT_READY` | 会话未就绪 | 握手未完成就收到转发请求 |
| `ERR_TRANSPORT_FORWARD_FAILED` | 转发失败 | Background 无法把消息送到页面侧 |
| `ERR_TRANSPORT_TIMEOUT` | 等待超时 | 指定时限内没有收到响应 |
| `ERR_TRANSPORT_DISCONNECTED` | 会话断开 | 心跳丢失、native host 退出、连接中断 |

### 兼容策略

- 只能追加新错误码，不能把 link-layer 错误折叠回 FR-0001 的 CLI 外层错误壳
- 页面业务错误必须放在 `payload` 内部，由上层命令语义决定如何解释
- 同一类 link-layer 错误在不同消息类型下必须保持相同语义

## 最小示例

### 示例 1：握手成功

```text
Background -> CLI: bridge.open
CLI -> Background: bridge.opened
```

### 示例 2：最小转发成功

```text
CLI -> Background -> Content Script: bridge.forward(runtime.ping)
Content Script -> Background -> CLI: bridge.result(success)
```

### 示例 3：心跳断连

```text
Background -> CLI: __ping__
CLI -> Background: __pong__
...连续丢失 ...
Background -> CLI: bridge.closed(disconnected)
```
