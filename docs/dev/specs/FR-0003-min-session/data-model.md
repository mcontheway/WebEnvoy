# FR-0003 数据模型

## 建模范围

本 FR 的共享实体只有一类：Profile 运行时实体及其最小持久化元数据。

本 FR 不新增 SQLite schema，不引入账号资产总表，也不引入任务仓库。

## 实体 1：ProfileDirectory

ProfileDirectory 是浏览器 UserDataDir 对应的物理目录。

关键字段：

- `profileName`：Profile 的稳定名称
- `profileDir`：Profile 目录绝对路径
- `browserChannel`：浏览器通道标识
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

### 最小字段

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

### 关键约束

- `schemaVersion` 只允许单调递增，不允许向下兼容地改写旧语义。
- `profileState` 必须来自 FR-0003 冻结的状态枚举。
- `proxyBinding.url` 为空表示直连，不代表缺失或待定。
- `updatedAt` 必须在每次状态变更或绑定变更后刷新。
- `fingerprintSeeds` 与 `localStorageSnapshots` 仅承载最小会话恢复所需信息，不得膨胀为账号资产总表。
- 不允许把账号健康、矩阵调度、风控分数写入该文件。

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
