# FR-0003 数据模型

## 建模范围

本 FR 的共享实体只有一类：Profile 运行时实体及其最小持久化元数据。

本 FR 不新增 SQLite schema，不引入账号资产总表，也不引入任务仓库。

## 实体 1：ProfileDirectory

ProfileDirectory 是浏览器 UserDataDir 对应的物理目录。

关键字段：

- `profileName`：Profile 的稳定名称
- `profileDir`：Profile 目录绝对路径
- `browserChannel`：浏览器通道标识；这里只表示目录 / 运行时上下文属性，不代表它属于 FR-0003 `__webenvoy_meta.json` 基线白名单
- `createdAt`：目录首次稳定初始化时间

约束：

- 同名 Profile 必须映射到同一目录
- 目录必须在启动前可解析为绝对路径
- 目录创建与浏览器启动不能分裂成互相独立的身份来源

生命周期：

- `uninitialized`：目录尚未形成稳定初始化结果
- `active`：目录已被某个浏览器实例使用
- `retired`：目录保留但当前未被占用

## 实体 2：ProfileMeta

`ProfileMeta` 对应 `__webenvoy_meta.json`。

### FR-0003 基线最小字段

```json
{
  "schemaVersion": 1,
  "profileName": "xhs_account_001",
  "profileDir": "/abs/path/to/profiles/xhs_account_001",
  "profileState": "ready",
  "proxyBinding": {
    "url": "http://user:pass@proxy-host:8080",
    "boundAt": "2026-03-19T12:00:00.000Z"
  },
  "fingerprintSeeds": {
    "audioNoiseSeed": "seed-audio-001",
    "canvasNoiseSeed": "seed-canvas-001"
  },
  "localStorageSnapshots": [
    {
      "origin": "https://www.example.com",
      "entries": [
        {
          "key": "session_token",
          "value": "..."
        }
      ]
    }
  ],
  "createdAt": "2026-03-19T11:58:00.000Z",
  "updatedAt": "2026-03-19T12:00:00.000Z",
  "lastStartedAt": "2026-03-19T12:00:00.000Z",
  "lastLoginAt": null,
  "lastStoppedAt": null,
  "lastDisconnectedAt": null
}
```

### FR-0003 顶层字段白名单

FR-0003 基线下，`__webenvoy_meta.json` 只允许以下顶层字段：

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

补充约束：

- 本白名单是 FR-0003 的默认允许集；未被后续 formal spec 明确冻结的额外顶层字段，都视为越界字段。
- 后续 FR 如需新增 profile meta 字段，必须在各自 formal 套件中完成批准并冻结边界；在此之前，这些字段都不属于 FR-0003 原生白名单。
- `run_id`、`session_id`、transport session、bootstrap envelope、账号健康、矩阵调度、代理池状态都不得作为 FR-0003 顶层字段进入 `__webenvoy_meta.json`。

### 嵌套字段最小白名单

- `proxyBinding`
  - `url`
  - `boundAt`
- `fingerprintSeeds`
  - `audioNoiseSeed`
  - `canvasNoiseSeed`
- `localStorageSnapshots[]`
  - `origin`
  - `entries`
- `localStorageSnapshots[].entries[]`
  - `key`
  - `value`

### 关键约束

- `schemaVersion` 只允许单调递增，不允许向下兼容地改写旧语义。
- `profileState` 必须来自 FR-0003 冻结的状态枚举。
- `proxyBinding.url` 为空表示直连，不代表缺失或待定。
- `updatedAt` 必须在每次状态变更或绑定变更后刷新。
- `fingerprintSeeds` 与 `localStorageSnapshots` 仅承载最小会话摘要 / 恢复输入，不得膨胀为账号资产总表。
- `fingerprintSeeds` 只承载稳定 seed，不承载 `runtime_bootstrap_envelope`、`fingerprint_runtime`、`fingerprint_patch_manifest`、`main_world_secret` 等 FR-0015 单次运行 bootstrap 字段。
- 不允许把账号健康、矩阵调度、风控分数写入该文件。
- `run_id` 只属于 FR-0001 定义的单次 CLI 调用上下文；即使实现会把命令级 `run_id` 写入锁文件审计，也不得把它持久化为 `ProfileMeta` 字段。
- 后续 FR 只能以“加性可选字段”方式扩展 `ProfileMeta`；新增字段必须在对应 formal spec / data-model 中冻结字段边界、生命周期、非法值处理与回滚策略，且不得改写 FR-0003 基线字段语义。
- 如后续 FR 需要新增 `persistentExtensionBinding` 等 profile meta 字段，必须先在各自 formal 套件中完成审批并冻结边界；在此之前，这些字段都不属于 FR-0003 原生基线字段。

### `localStorageSnapshots` 语义约束

- FR-0003 只要求在 `runtime.login` 确认后把快照写入 `__webenvoy_meta.json`，并在状态回读中提供摘要可见性。
- FR-0003 不要求把该快照自动回写到后续浏览器会话。
- 自动回写链路属于后续 FR，可在不改变本 FR 状态机与锁语义的前提下增量引入。

### 状态流转

- `uninitialized` -> `starting` -> `ready`
- `uninitialized` -> `logging_in` -> `ready`
- `stopped` -> `logging_in` -> `ready`
- `disconnected` -> `logging_in` -> `ready`
- `ready` -> `logging_in` -> `ready`
- `ready` / `logging_in` -> `disconnected`
- `ready` -> `stopping` -> `stopped`
- `disconnected` / `stopped` -> `starting`

## 实体 3：ProfileLock

ProfileLock 表示同一 Profile 的独占占用关系。

关键字段：

- `profileName`
- `lockPath`
- `ownerPid`
- `ownerRunId`
- `acquiredAt`
- `lastHeartbeatAt`

约束：

- 同一时刻只能有一个有效锁持有者
- `ownerRunId` 只作为锁审计与恢复输入，不替代 FR-0001 的命令级 `run_id`
- 锁必须能在进程异常退出后被识别为陈旧锁
- 锁的存在必须优先于元数据写入，避免并发覆盖

生命周期：

- `free`
- `held`
- `stale`
- `released`

## 实体 4：ProxyBinding

ProxyBinding 表示 Profile 级代理黏性绑定。

关键字段：

- `url`
- `boundAt`
- `source`

约束：

- 同一 Profile 的代理绑定一经确认，不得被后续调用静默改写
- 冲突代理只能通过显式错误暴露
- 直连与代理绑定是互斥的运行形态

## 持久化边界说明

- 浏览器自身会把 Cookie、LocalStorage 和其他原生会话数据保存在 UserDataDir 中。
- WebEnvoy 只负责 `__webenvoy_meta.json` 和 ProfileLock 的最小管理。
- 不要求把浏览器内部会话细节再次导入 SQLite。
- 不要求把平台账号信息复制到独立的持久化仓库。
- `__webenvoy_meta.json` 的默认白名单以 FR-0003 基线字段为准；后续 FR 仅可通过 formal spec review 新增受控加性字段。
