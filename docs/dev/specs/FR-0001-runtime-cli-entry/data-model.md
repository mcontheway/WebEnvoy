# FR-0001 数据模型

## 建模范围

FR-0001 不引入 SQLite schema、表结构迁移或其他持久化实体。

本 FR 只冻结 CLI 外层会被调用方依赖的三类共享数据模型：

- CLI 标准化运行上下文
- 成功响应壳
- 错误响应壳

这些模型都属于单次进程内瞬时数据，不构成持久化账本。

## 实体 1：CliInvocationContext

`CliInvocationContext` 是 CLI 在进入命令处理器前形成的标准化调用上下文。

最小字段：

```json
{
  "run_id": "run-20260319-0001",
  "command": "runtime.ping",
  "profile": null,
  "params": {},
  "cwd": "/workspace/WebEnvoy"
}
```

关键字段：

- `run_id`：单次 CLI 调用的稳定运行标识
- `command`：逻辑命令标识
- `profile`：可选的 Profile 标识
- `params`：结构化命令参数对象
- `cwd`：调用发生时的工作目录

约束：

- `run_id` 必须在单次调用内稳定，且不能缺失。
- `command` 必须对应逻辑命令名，不能回退为脚本路径或自由文本。
- `profile` 允许为 `null`；只有声明依赖身份 / 会话的命令才可要求非空。
- `params` 必须是 JSON 对象；未传 `--params` 时标准化为 `{}`。
- `cwd` 必须是可解析的绝对目录路径。

生命周期：

- `received`：CLI 已接收到原始 argv
- `normalized`：参数已标准化并形成统一上下文
- `dispatched`：上下文已交给命令路由或处理器
- `closed`：命令已完成并生成最终响应

## 实体 2：CliSuccessEnvelope

`CliSuccessEnvelope` 表示成功路径写入 `stdout` 的唯一 JSON 对象。

最小字段：

```json
{
  "run_id": "run-20260319-0001",
  "command": "runtime.ping",
  "status": "success",
  "summary": {
    "message": "ok"
  },
  "timestamp": "2026-03-19T12:00:00.000Z"
}
```

关键字段：

- `run_id`
- `command`
- `status`
- `summary`
- `timestamp`

约束：

- `status` 在成功响应中固定为 `success`。
- `summary` 必须是对象，不能退化为自由文本或数组。
- `timestamp` 必须为可稳定解析的时间字符串。
- 同一次调用只允许输出一个成功响应对象，不得拆分为多段 JSON。

## 实体 3：CliErrorEnvelope

`CliErrorEnvelope` 表示失败路径写入 `stdout` 的唯一 JSON 对象。

最小字段：

```json
{
  "run_id": "run-20260319-0002",
  "command": "runtime.unknown",
  "status": "error",
  "error": {
    "code": "ERR_CLI_UNKNOWN_COMMAND",
    "message": "未知命令",
    "retryable": false
  },
  "timestamp": "2026-03-19T12:00:01.000Z"
}
```

关键字段：

- `run_id`
- `command`
- `status`
- `error.code`
- `error.message`
- `error.retryable`
- `timestamp`

约束：

- `status` 在失败响应中固定为 `error`。
- `error.code` 必须来自 WebEnvoy 已冻结的结构化错误码集合；FR-0001 基线至少覆盖本 FR 定义的五类错误码，后续 FR 只能以加性方式新增错误码，不能改写这五类基线语义。
- `error.retryable` 必须显式给出，不能省略。
- 错误响应不得把堆栈、人类帮助或多余日志混入 `stdout`。

## 枚举 1：CliErrorCode

FR-0001 冻结的最小错误码集合如下：

- `ERR_CLI_INVALID_ARGS`
- `ERR_CLI_UNKNOWN_COMMAND`
- `ERR_CLI_NOT_IMPLEMENTED`
- `ERR_RUNTIME_UNAVAILABLE`
- `ERR_EXECUTION_FAILED`

约束：

- 后续 FR 可以新增错误码，但不能改写本集合中既有错误码的语义。
- 同一错误码必须映射到稳定退出码，不能按命令漂移。

## 枚举 2：CliExitCode

FR-0001 冻结的最小退出码集合如下：

- `0`：成功
- `2`：参数错误
- `3`：未知命令
- `4`：已注册但未实现
- `5`：运行时不可用
- `6`：执行失败

约束：

- 单次 CLI 调用只能返回一个最终退出码。
- 同一类错误在不同命令下必须复用同一退出码。

## 持久化边界说明

- FR-0001 不写入 SQLite，也不创建文件型运行账本。
- `run_id` 只属于单次调用的瞬时上下文，不在本 FR 内要求持久保存。
- 如后续 FR 需要把运行记录落库或写入诊断产物，必须以加性方式复用这里冻结的字段语义，不能重定义 `run_id`、`command`、`status` 或错误壳结构。
