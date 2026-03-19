# 最小身份 / 会话契约

## 边界名称与适用范围

本契约定义 FR-0003 冻结的 Profile 启动与最小会话生命周期，适用于：

- Named Profile 启动
- Profile 状态查询
- Profile 独占锁
- 代理粘性绑定
- `__webenvoy_meta.json` 的最小字段

本契约不定义平台级读写命令，也不定义账号矩阵、健康评分或代理池。

## 生产者 / 消费者

- 生产者：`webenvoy` CLI 进程与其浏览器运行时管理层
- 直接消费者：后续平台读取命令、测试程序、人工 smoke 流程
- 间接消费者：`#145`、`#146`、`#148`

## 状态模型

### Profile 状态

```text
uninitialized -> starting -> ready -> logging_in -> ready
uninitialized -> logging_in -> ready
stopped -> logging_in -> ready
disconnected -> logging_in -> ready
ready -> stopping -> stopped
ready -> disconnected
logging_in -> disconnected
stopped -> starting
disconnected -> starting
```

说明：

- `uninitialized` 表示该 Profile 目录和最小元数据尚未形成稳定初始化结果。
- `starting` 表示浏览器正在启动并绑定该 Profile。
- `ready` 表示浏览器已可用，Profile 可被后续命令复用。
- `logging_in` 表示用户正在通过可见浏览器完成一次手动登录。
- `disconnected` 表示浏览器进程退出、连接断开或异常中止。
- `stopping` 表示正在主动关闭当前浏览器实例。
- `stopped` 表示浏览器已关闭，Profile 仍保留。

### Browser 状态

`runtime.status` 还要返回当前浏览器实例态，取值冻结为：

- `absent`
- `starting`
- `ready`
- `logging_in`
- `stopping`
- `disconnected`

说明：

- `absent` 表示当前没有活动浏览器实例
- `starting` 表示浏览器正在拉起
- `ready` 表示浏览器可用并可接收后续命令
- `logging_in` 表示可见浏览器正处于手动登录流程
- `stopping` 表示浏览器正在主动关闭
- `disconnected` 表示活动浏览器曾存在，但当前已断连或异常退出

### 运行时视图

`runtime.status` 至少要返回以下两类状态：

- `profileState`
- `browserState`

其中：

- `profileState` 描述持久化 Profile 的最后已知状态
- `browserState` 描述当前运行时是否仍有活动浏览器实例

其中 `profileState` 与 `browserState` 的对应关系不是一一相等关系：

- `profileState` 反映可恢复的 Profile 语义
- `browserState` 反映当前是否存在活动浏览器实例
- `runtime.status` 必须同时返回二者，不能只回其中一个

## 命令语义

### `runtime.start`

输入：

- `profile`：必填
- `params.proxyUrl`：可选

语义：

- 解析并定位 Profile 目录
- 获取 Profile 独占锁
- 以该 Named Profile 启动浏览器；若 Profile 尚未初始化，也可以由 `runtime.login` 先行创建最小目录后再进入登录流程
- 若 Profile 已绑定代理，则复用既有绑定
- 若显式传入的代理与既有绑定冲突，则失败

成功结果至少包含：

- `profile`
- `profileState`
- `browserState`
- `profileDir`
- `proxyUrl`
- `startedAt`

### `runtime.login`

输入：

- `profile`：必填
- `params.proxyUrl`：可选，但不得绕过既有绑定冲突检查

语义：

- 打开或保持可见浏览器
- 将 Profile 置入 `logging_in`
- 若 Profile 尚未初始化，则先创建最小目录与最小元数据
- 等待用户手动完成登录
- 确认后回写最小持久化摘要到 `__webenvoy_meta.json` 并回到 `ready`
- 本 FR 不要求把 `localStorageSnapshots` 自动回写到后续浏览器会话

成功结果至少包含：

- `profile`
- `profileState`
- `browserState`
- `lastLoginAt`

### `runtime.status`

输入：

- `profile`：必填

语义：

- 仅读取状态，不触发启动、登录或修复动作
- 返回 Profile 持久化状态与当前浏览器态
- 返回代理绑定是否存在

成功结果至少包含：

- `profile`
- `profileState`
- `browserState`
- `profileDir`
- `proxyUrl`
- `lockHeld`

### `runtime.stop`

输入：

- `profile`：必填

语义：

- 主动关闭该 Profile 的活动浏览器实例
- 释放独占锁
- 将状态收敛到 `stopped`

成功结果至少包含：

- `profile`
- `profileState`
- `browserState`
- `stoppedAt`

## 错误语义

本契约冻结以下最小错误码：

- `ERR_PROFILE_INVALID`
- `ERR_PROFILE_LOCKED`
- `ERR_PROFILE_META_CORRUPT`
- `ERR_PROFILE_PROXY_CONFLICT`
- `ERR_BROWSER_LAUNCH_FAILED`
- `ERR_PROFILE_LOGIN_TIMEOUT`
- `ERR_PROFILE_STATE_CONFLICT`

语义要求：

- `ERR_PROFILE_INVALID`：Profile 名称、路径或参数不合法
- `ERR_PROFILE_LOCKED`：同一 Profile 已被其他 CLI 进程占用
- `ERR_PROFILE_META_CORRUPT`：最小元数据无法解析或恢复
- `ERR_PROFILE_PROXY_CONFLICT`：显式代理与既有绑定不一致
- `ERR_BROWSER_LAUNCH_FAILED`：浏览器拉起失败
- `ERR_PROFILE_LOGIN_TIMEOUT`：等待用户登录确认超时
- `ERR_PROFILE_STATE_CONFLICT`：请求与当前状态不兼容

## 持久化边界

`__webenvoy_meta.json` 只允许保存最小必要字段：

- `schemaVersion`
- `profileName`
- `profileDir`
- `profileState`
- `proxyBinding`
- `fingerprintSeeds`
- `localStorageSnapshots`
- `createdAt`
- `updatedAt`
- `lastStartedAt`
- `lastLoginAt`
- `lastStoppedAt`
- `lastDisconnectedAt`

其中 `proxyBinding` 结构至少包含：

- `url`
- `boundAt`

其中 `fingerprintSeeds` 至少可以包含：

- `audioNoiseSeed`
- `canvasNoiseSeed`

其中 `localStorageSnapshots` 用于保存最小的 SPA 鉴权快照，不要求导出全部浏览器会话细节；在 FR-0003 中它只作为最小会话摘要 / 恢复输入，不要求自动回写到后续浏览器会话。

## 兼容策略

- 本契约冻结后，后续 FR 可以增加可选字段，但不能重定义状态语义
- 后续 FR 可以增加新的运行时命令，但不能改写 Profile 独占锁和代理粘性绑定的核心规则
- 本 FR 不要求把 Profile 生命周期持久化到 SQLite
- 后续 FR 可以在不破坏现有状态机与错误语义的前提下补 `localStorageSnapshots` 的自动回写链路
