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

## 运行标识兼容边界

- 所有 `runtime.start` / `runtime.login` / `runtime.status` / `runtime.stop` 命令都复用 FR-0001 已冻结的外层 `run_id`。
- FR-0003 不另起第二套运行标识体系，也不把 `run_id` 写成 Profile 元数据主键。
- `run_id` 是单次命令调用标识，不是浏览器实例 ID、Profile ID 或长期 session ID。
- 同一 Profile 上的连续 `start/login/status/stop` 调用必须各自拥有独立 `run_id`，即使它们操作的是同一浏览器目录与同一锁文件。
- 唯一例外是 `runtime.login` 的显式确认续调用：当同一手动登录流程通过 `params.confirm=true` 收口时，确认调用必须复用首次 `runtime.login` 的同一个 `run_id`。
- `ProfileLock.ownerRunId` 仅用于锁审计、陈旧锁识别和异常恢复，不对外替代 FR-0001 的命令级 `run_id` 语义。
- FR-0002 的握手字段不承载 `run_id`；FR-0015 的 bootstrap 字段虽然会使用 `run_id`，但它仍属于单次运行上下文，不能回写成 FR-0003 的持久化身份字段。

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
- `ready` 表示浏览器已可用，Profile 可被后续命令复用；它只表达 FR-0003 的本地 lifecycle ready，不等同于 FR-0002 transport ready 或 FR-0015 runtime readiness ready。
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
- `ready` 表示浏览器在本地生命周期层面可用并可接收 FR-0003 范围内的后续命令；它不单独证明 transport/bootstrap/readiness 全部就绪
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
- `params.confirm`：可选；仅在二次确认调用时传入 `true`

语义：

- 打开或保持可见浏览器
- 将 Profile 置入 `logging_in`
- 若 Profile 尚未初始化，则先创建最小目录与最小元数据
- 首次调用返回 `confirmationRequired`，由调用方在用户完成手动登录后再次调用 `runtime.login` 并传入 `params.confirm=true`
- 二次确认调用在 `params.confirm=true` 时回写最小持久化摘要到 `__webenvoy_meta.json` 并回到 `ready`
- 二次确认调用必须复用首次登录调用的同一个 `run_id`
- 本 FR 不要求把 `localStorageSnapshots` 自动回写到后续浏览器会话

首次调用成功结果至少包含：

- `profile`
- `profileState`
- `browserState`
- `confirmationRequired`

说明：

- 实现可以额外返回帮助调用方继续确认流程的提示字段，例如 `confirmPath`。
- 这类提示字段在 FR-0003 中不作为冻结的正式契约字段；调用方不能依赖其独立表达完整的 follow-up 调用。

确认调用成功结果至少包含：

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

本契约冻结以下最小错误码白名单：

- `ERR_PROFILE_INVALID`
- `ERR_PROFILE_LOCKED`
- `ERR_PROFILE_META_CORRUPT`
- `ERR_PROFILE_PROXY_CONFLICT`
- `ERR_BROWSER_LAUNCH_FAILED`
- `ERR_PROFILE_STATE_CONFLICT`

白名单约束：

- FR-0003 只冻结上述六个最小错误码；实现不得在 formal 收口前把其他 Profile / session 错误码当作默认稳定契约。
- 这些错误码属于 FR-0001 CLI 错误响应壳内部的 `error.code` 值扩展，不改写 FR-0001 的 `status/error/timestamp/run_id` 外层结构。
- FR-0002 的 `ERR_TRANSPORT_*` 属于通信层错误码，不纳入本白名单。
- 若后续 FR 需要新增会话相关错误码，必须以加性方式进入对应 formal contract，且不得改写上述六个基线错误的语义。

语义要求：

- `ERR_PROFILE_INVALID`：Profile 名称、路径或参数不合法
- `ERR_PROFILE_LOCKED`：同一 Profile 已被其他 CLI 进程占用
- `ERR_PROFILE_META_CORRUPT`：最小元数据无法解析或恢复
- `ERR_PROFILE_PROXY_CONFLICT`：显式代理与既有绑定不一致
- `ERR_BROWSER_LAUNCH_FAILED`：浏览器拉起失败
- `ERR_PROFILE_STATE_CONFLICT`：请求与当前状态不兼容

登录确认补充约束：

- `runtime.login` 采用显式二次确认模型：首次调用只进入 `logging_in` 并返回 `confirmationRequired`，不会在单次命令内等待用户登录确认直到超时。
- `runtime.login` 在二次调用且 `params.confirm=true` 时承接显式确认收口；若确认时登录浏览器已断开、锁持有状态失效或当前状态不再兼容，统一返回 `ERR_PROFILE_STATE_CONFLICT`。
- `runtime.login` 的二次确认调用必须复用首次登录调用的同一个命令级 `run_id`；当前实现不支持以新的 `run_id` 接管尚未完成的登录确认。
- 如需引入登录确认 deadline / timeout 语义，必须在后续 formal 变更中新增对应状态机、错误码与测试；在该变更落地前，不得把 `ERR_PROFILE_LOGIN_TIMEOUT` 视为稳定契约。

## 持久化边界

`__webenvoy_meta.json` 在 FR-0003 基线下只允许保存最小必要字段：

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

上述字段构成 FR-0003 的默认顶层字段白名单；在未被后续 formal spec 明确新增前，不得额外持久化其他顶层字段。

其中 `proxyBinding` 结构至少包含：

- `url`
- `boundAt`

其中 `fingerprintSeeds` 至少可以包含：

- `audioNoiseSeed`
- `canvasNoiseSeed`

并且 `fingerprintSeeds` 只允许承载稳定 seed，不得承载以下 FR-0015 单次运行 bootstrap 字段：

- `runtime_bootstrap_envelope`
- `fingerprint_runtime`
- `fingerprint_patch_manifest`
- `main_world_secret`

其中 `localStorageSnapshots` 用于保存最小的 SPA 鉴权快照，不要求导出全部浏览器会话细节；在 FR-0003 中它只作为最小会话摘要 / 恢复输入，不要求自动回写到后续浏览器会话。

禁止持久化项：

- `run_id`
- `session_id`
- Native Messaging `session_id`
- bootstrap envelope / ack 字段
- transport readiness 缓存
- 账号健康度、矩阵调度、代理池状态

后续 FR 如需增加新的可选字段，必须满足以下条件：

- 只能作为加性可选字段，不得改写上述基线字段的既有语义
- 必须在对应 formal spec / data-model 中明确字段边界、生命周期、非法值处理与回滚策略
- 未被后续 formal spec 冻结前，不得把新的 profile meta 字段写成默认允许项

后续 FR 如需新增 `__webenvoy_meta.json` 字段，必须先在各自正式套件中完成 formal 审批并冻结最小子集与回读边界；在此之前，不得把新增字段写成默认允许项，也不得外推为更宽的安装/运行时状态仓库。

## 兼容策略

- 本契约冻结后，后续 FR 可以增加可选字段，但不能重定义状态语义
- 后续 FR 可以增加新的运行时命令，但不能改写 Profile 独占锁和代理粘性绑定的核心规则
- 本 FR 不要求把 Profile 生命周期持久化到 SQLite
- 后续 FR 可以在不破坏现有状态机与错误语义的前提下补 `localStorageSnapshots` 的自动回写链路
