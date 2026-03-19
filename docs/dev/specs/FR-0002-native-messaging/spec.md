# FR-0002 Native Messaging 最小通信闭环

## 背景

FR-0001 已冻结 WebEnvoy 的 CLI 外层契约。`#142` 要解决的是这套 CLI 契约到浏览器内执行链路之间的最小通信闭环，而不是重新发明命令壳。

当前需要先把以下链路打通：

- CLI 与 Native Messaging Host 的稳定握手
- Extension Background 与 Content Script 的最小转发
- 心跳与断连的基础处理
- 握手失败、转发失败、超时、断连的基础错误分类

如果没有这层闭环，后续的页面侧执行、适配器接入和能力沉淀都只能停留在本地调用层，无法进入真实浏览器上下文。

## 目标

1. 在 FR-0001 冻结的 CLI 契约之上，打通 CLI -> Background -> Content Script -> Background -> CLI 的最小往返链路。
2. 只建立最小通信闭环，不扩张为完整消息总线、事件总线或多端调度系统。
3. 明确 Native Messaging 握手成功、转发成功、心跳正常、断连和超时的最小状态边界。
4. 明确 link-layer 错误与页面业务错误的分界，避免把页面语义问题混进通信层。
5. 为后续 `#145`、`#146`、`#147`、`#148` 提供稳定的通信承载面，但不预先定义它们的业务语义。

## 非目标

- 不重新定义 FR-0001 的 CLI 外层命令壳、argv 语法、stdout / stderr 边界或退出码。
- 不在本 FR 内实现 `webenvoy install` / `uninstall` 之类系统注册命令。
- 不在本 FR 内实现浏览器启动、Profile 恢复、SQLite 落库或完整账号生命周期。
- 不在本 FR 内实现完整消息总线、广播、订阅、排队调度或多 tab fan-out。
- 不在本 FR 内定义平台业务命令本身，只承接运输与回传。
- 不在本 FR 内把 WebSocket / 远程中继作为主线交付。

## 功能需求

### 1. Native Messaging 最小握手

- Extension Background 必须能通过 Native Messaging 主动连接 CLI 的 native host。
- CLI 侧必须能接受该连接并完成稳定握手。
- 握手必须包含最小协议版本信息，且版本必须可协商或显式拒绝。
- 握手成功后，Background 才能把当前会话标记为可转发。
- 握手失败必须可区分为：
  - host 不可用
  - manifest / 路径不可解析
  - 协议版本不兼容
  - 超时

### 2. 最小消息转发

- CLI 发起的最小消息必须能够经过 Background 转发到 Content Script，再原路返回 CLI。
- 转发必须保留 FR-0001 标准化命令上下文中的关键字段：
  - `run_id`
  - `command`
  - `profile`
  - `params`
  - `cwd`
- Background 只负责路由和会话管理，不解释页面业务 payload。
- Content Script 只负责页面侧执行 / 回传，不重新定义 CLI 外层参数模型。
- 本 FR 的最小往返命令以 `runtime.ping` 作为 smoke path；它必须能被页面侧看到并返回结果。

### 3. 心跳与断连

- Background 必须定期向 CLI 发送心跳。
- CLI 必须立即响应心跳。
- 心跳丢失必须触发断连判定，而不是静默挂死。
- 断连后，当前会话必须进入不可用状态，直到重新握手成功。
- 连接恢复后，新的消息才能再次进入转发链路。

### 4. 基础错误分类

本 FR 只定义 link-layer 的基础错误，不定义页面业务错误。

至少需要区分以下错误：

- `ERR_TRANSPORT_HANDSHAKE_FAILED`
- `ERR_TRANSPORT_NOT_READY`
- `ERR_TRANSPORT_FORWARD_FAILED`
- `ERR_TRANSPORT_TIMEOUT`
- `ERR_TRANSPORT_DISCONNECTED`

错误分类边界：

- 握手不成功，属于 `ERR_TRANSPORT_HANDSHAKE_FAILED`
- Background 无法把消息送到页面侧，属于 `ERR_TRANSPORT_FORWARD_FAILED`
- 指定时限内没有收到响应，属于 `ERR_TRANSPORT_TIMEOUT`
- 心跳丢失或连接中断，属于 `ERR_TRANSPORT_DISCONNECTED`
- 页面业务自己返回失败，但链路仍然通，不能被误判为 transport failure

### 5. 会话状态

会话至少应呈现以下状态：

- `idle`
- `handshaking`
- `ready`
- `forwarding`
- `disconnected`
- `failed`

状态转移必须满足：

- 只有握手成功后才能进入 `ready`
- 只有 `ready` 状态才能接收正常转发
- 心跳失败或 Native Messaging 断开后必须进入 `disconnected`
- 在 `disconnected` 状态下，不能假装链路仍然可用

## GWT 验收场景

### 场景 1：握手成功后可以建立可转发会话

Given CLI 通过 FR-0001 的标准化命令上下文发起一次 `runtime.ping` 调用  
And Native Messaging Host 可用  
When CLI 与 Extension Background 完成最小握手  
Then 会话进入 `ready`  
And Background 可以把最小消息转发到 Content Script  
And Content Script 的返回结果可以原路回到 CLI  

### 场景 2：页面侧最小往返保持上下文一致

Given 会话已经处于 `ready`  
And CLI 发送一条最小转发消息  
When 消息经过 Background 到达 Content Script 再返回  
Then 返回结果必须保留同一 `run_id`  
And 返回结果必须保留同一 `command`  
And Background 不得把页面侧 payload 改写成第二套命令壳  

### 场景 3：握手失败必须可见

Given Native Messaging Host 不可用或协议版本不兼容  
When CLI 发起连接  
Then 会话不能进入 `ready`  
And 系统必须返回握手失败错误  
And 该错误必须能区分为 `ERR_TRANSPORT_HANDSHAKE_FAILED`  

### 场景 4：心跳丢失触发断连

Given 会话已经处于 `ready`  
And 后续连续心跳没有收到响应  
When 超过断连阈值  
Then 会话必须进入 `disconnected`  
And 正在等待的转发请求必须失败返回  
And 该失败必须区分为 `ERR_TRANSPORT_DISCONNECTED` 或 `ERR_TRANSPORT_TIMEOUT`  

### 场景 5：页面侧不可达不会伪装成业务失败

Given 会话握手成功  
And Content Script 未注入或目标页面不可路由  
When CLI 发起最小转发消息  
Then 系统必须返回 link-layer 错误  
And 不得把该错误伪装成页面业务执行失败  

## 异常与边界场景

### 1. 握手边界

- Native Messaging Host 进程存在但没有返回握手确认时，必须按超时处理。
- 协议版本不一致时，必须拒绝进入 `ready`，不能靠猜测回退。
- 握手期间收到普通转发消息时，必须拒绝并返回 `ERR_TRANSPORT_NOT_READY`。

### 2. 转发边界

- Background 不能把同一条消息同时发给多个页面目标。
- Content Script 不可用时，必须返回明确失败，而不是一直等待。
- 本 FR 不要求多 inflight 并发；单条转发闭环即可。

### 3. 心跳边界

- 心跳失败的判定必须先于普通业务超时判定，避免把链路断开误判为业务失败。
- 断连后再次发送的消息必须进入新的握手流程，不能复用旧会话。

### 4. 错误边界

- 页面业务返回的错误 payload 不能被 Transport 层重分类成 `ERR_TRANSPORT_*`。
- Transport 层错误不能混入 FR-0001 的 CLI 外层错误壳语义。
- 任何未识别的 link-layer 失败都应归入最接近的 transport 错误，而不是沉默吞掉。

## 验收标准

1. CLI 能与 Extension Background 建立稳定的 Native Messaging 握手。
2. 最小消息可以从 CLI 经过 Background 到 Content Script，再返回 CLI。
3. 心跳丢失或 Native Messaging 断开可以被稳定识别。
4. 握手失败、转发失败、超时、断连可以被区分。
5. FR-0001 的外层 CLI 契约没有被改写。
6. 规约没有扩张到完整消息总线、远程通道或业务执行总线。

## 依赖与前置条件

- 前置文档：
  - `vision.md`
  - `docs/dev/roadmap.md`
  - `docs/dev/architecture/system-design.md`
  - `docs/dev/architecture/system-design/communication.md`
  - `docs/dev/architecture/system-design/error-handling.md`
  - `docs/dev/architecture/system-design/account.md`
  - `docs/dev/specs/FR-0001-runtime-cli-entry/spec.md`
  - `docs/dev/specs/FR-0001-runtime-cli-entry/contracts/cli-entry.md`
- 硬依赖：
  - `#141` / FR-0001
- 直接对应 issue：
  - `#142`
- 依赖本 FR 的后续事项：
  - `#145`
  - `#146`
  - `#147`
  - `#148`
