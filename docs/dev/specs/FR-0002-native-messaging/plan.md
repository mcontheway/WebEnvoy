# FR-0002 实施计划

## 实施目标

这次实现只交付 Native Messaging 最小通信闭环，不交付完整消息总线，也不改写 FR-0001 的 CLI 外层契约。

实现完成后，至少应形成以下能力：

- CLI 与 Extension Background 的最小握手
- Background 与 Content Script 的最小消息转发
- `runtime.ping` 的页面侧往返 smoke path
- 心跳发送、应答和断连判定
- 握手失败、转发失败、超时、断连的基础分类
- 能支撑后续 `#145`、`#146`、`#147`、`#148` 的通信底座

## 分阶段拆分

### 阶段 A：协议边界冻结

产出：

- Native Messaging 最小消息边界
- 握手、转发、心跳、断连的字段定义
- link-layer 错误分类表

依赖：

- FR-0001 已冻结 CLI 外层契约
- `#142` 的范围已明确为最小通信闭环

### 阶段 B：CLI 到 Background 的握手闭环

产出：

- CLI 与 Background 的最小连接建立
- 会话状态机最小转移
- `ready` / `disconnected` / `failed` 的基础判断

依赖：

- 阶段 A 完成

### 阶段 C：Background 到 Content Script 的最小转发

产出：

- 单条消息从 Background 转发到页面侧
- 页面侧结果回传到 Background
- `run_id` 与 `command` 全链路保持一致

依赖：

- 阶段 B 完成

### 阶段 D：心跳、断连与超时

产出：

- 心跳定时器
- 心跳应答
- 断连判定
- 超时错误归类

依赖：

- 阶段 B、C 完成

### 阶段 E：验证、收口与交接

产出：

- handshake smoke test
- `runtime.ping` round-trip smoke test
- 断连 / 超时 / 握手失败的断言
- 对后续 `#145`、`#146`、`#147`、`#148` 的承接说明

依赖：

- 阶段 C、D 完成

## 实现约束

- 必须承接 FR-0001，不得引入另一套 CLI 命令壳或 argv 入口。
- 必须保持浏览器内执行是唯一 HTTP 出口，不在浏览器外另开数据面。
- 不做完整消息总线，不做广播，不做多 tab fan-out，不做远程 WebSocket 主线。
- 不在 transport 层解释页面业务语义；transport 只负责连接、转发、心跳、断连。
- 不在本 FR 内新增 SQLite schema 或持久化实体。
- 不把 handshake / heartbeat / relay 混写在一个不可拆分的黑盒里；会话状态必须可测试。

## 测试与验证策略

单元测试：

- 协议 envelope 的序列化与反序列化
- 会话状态机转移
- 心跳计时与超时判定
- link-layer 错误分类
- `run_id` / `command` 透传一致性

集成 / 契约测试：

- CLI -> Background 握手
- Background -> Content Script 转发
- `runtime.ping` 页面侧往返
- 心跳成功与心跳丢失
- 断连后不再误判为 ready
- 握手失败 / 转发失败 / 超时的可观测输出

人工验证：

- 本地加载扩展后执行最小 smoke path
- 观察页面侧是否实际收到转发消息
- 观察断连后是否需要重新握手才能恢复

完成证据至少包括：

- 契约测试通过
- 断连与超时断言通过
- smoke path 可以重复运行
- `docs-guard` 通过

## TDD 范围

默认先写测试的模块：

- 协议 envelope
- 连接状态机
- 心跳与断连判定
- 错误分类与映射
- 转发结果的 correlation 校验

暂不强制先写测试的部分：

- 扩展安装命令
- 本地调试日志格式
- 帮助文案和 README 示例

原因：

- 协议、状态机和错误分类属于稳定公共边界，后续所有通信与执行事项都会依赖
- 文案和安装细节可以在实现收口后补齐，不应该抢占规约审查的注意力

## 并行 / 串行关系

前绪阻塞：

- FR-0001 spec review 通过后，才能开始 FR-0002 的实现工作
- 在 Native Messaging 外层边界未冻结前，不应推进页面侧转发实现

串行关系：

- 阶段 A -> B -> C -> D -> E 为主串行链路
- 握手未完成前，不应允许转发
- 转发未通前，不应把心跳与断连验证当成完成

可并行事项：

- `#143` 可以继续围绕最小身份 / 会话语义补充规约
- `#145` 可以基于本 FR 的通信边界继续设计首个平台读链路
- `#146`、`#147`、`#148` 可以并行起草各自的业务规约，但实现不得先于本 FR 的闭环完成

## 进入实现前条件

只有在以下条件满足后，才允许进入 `feat/FR-0002-*` 的实现工作：

- 当前 spec-only 变更已经进入 Draft PR 或等价评审上下文
- spec review 结论为 `APPROVE`
- `ready_for_implementation = true`
- 本 FR 的 `contracts/` 与 `risks.md` 已随套件一起评审
- `TODO.md` 中的 spec review 阶段阻断项已清空

在这些条件满足前，明确禁止：

- 编写 FR-0002 的运行时代码
- 把消息总线、页面业务语义或多端调度提前塞进 transport 层
- 在 `#145`、`#146`、`#147`、`#148` 中绕过本 FR 的通信闭环
