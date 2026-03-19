# CLI 入口契约

## 边界名称与适用范围

本契约定义 FR-0001 冻结的 CLI 最小调用面，适用于：

- `webenvoy` 可执行入口
- CLI 外层命令上下文
- `stdout` / `stderr` 输出边界
- 成功 / 错误响应壳
- 退出码语义

本契约不定义真实平台能力、Native Messaging 消息体或数据库结构。

## 生产者 / 消费者

- 生产者：`webenvoy` CLI 进程
- 直接消费者：AI Agent、脚本、工作流、测试程序
- 间接消费者：`#142`、`#143`、`#145`、`#154` 的后续实现

## 标准化命令上下文

CLI 在进入处理器前，必须把输入标准化为：

```json
{
  "run_id": "run-20260319-0001",
  "command": "runtime.ping",
  "profile": null,
  "params": {},
  "cwd": "/workspace/WebEnvoy"
}
```

字段要求：

- `run_id`
  - 字符串
  - 调用方可传入；未传入时由 CLI 自动生成
- `command`
  - 字符串
  - 逻辑命令标识，而不是脚本文件路径
  - 最小命名规则：
    - `runtime.<verb>`
    - `<platform>.<verb>`
- `profile`
  - 可为空
  - 只有声明依赖身份 / 会话的命令才强制要求
- `params`
  - 对象
  - 默认为空对象，不使用自由文本拼接
- `cwd`
  - 字符串
  - 记录调用时工作目录

## 最小调用语法

冻结的最小 argv 形式：

```text
webenvoy <command> [--params '<json>'] [--profile <profile>] [--run-id <run_id>]
```

规则：

- `<command>`
  - 必填位置参数
  - 必须位于 `webenvoy` 之后的第一个参数位置
- `--params`
  - 结构化参数的唯一正式入口
  - 值必须是 JSON 对象字符串
  - 未传入时，标准化上下文中的 `params` 为 `{}`
- `--profile`
  - 可选
  - 仅在命令声明依赖身份 / 会话时才必填
- `--run-id`
  - 可选
  - 未传入时由 CLI 自动生成

本 FR 不冻结：

- 短参数别名
- 其他等价写法
- 自由文本位置参数

后续 FR 不得绕开这套最小调用语法，自行引入另一套外层 argv 契约。

## 最小帮助 / 诊断调用

Phase 1 只冻结最小帮助 / 诊断调用，不扩张成完整命令面：

- `webenvoy runtime.help`
- `webenvoy runtime.ping`

它们仍然复用同一套调用语法，例如：

```text
webenvoy runtime.help
webenvoy runtime.ping --run-id run-20260319-0001
webenvoy runtime.help --params '{}'
```

## 成功响应

成功路径只允许向 `stdout` 输出单个 JSON 对象：

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

要求：

- `status` 固定为 `success`
- `summary` 必须是对象
- `timestamp` 必须可稳定解析

## 错误响应

失败路径也只允许向 `stdout` 输出单个 JSON 对象：

```json
{
  "run_id": "run-20260319-0002",
  "command": "xhs.search",
  "status": "error",
  "error": {
    "code": "ERR_CLI_NOT_IMPLEMENTED",
    "message": "命令已注册但当前版本尚未实现",
    "retryable": false
  },
  "timestamp": "2026-03-19T12:00:01.000Z"
}
```

最小错误码集合：

- `ERR_CLI_INVALID_ARGS`
- `ERR_CLI_UNKNOWN_COMMAND`
- `ERR_CLI_NOT_IMPLEMENTED`
- `ERR_RUNTIME_UNAVAILABLE`
- `ERR_EXECUTION_FAILED`

## `stderr` 边界

- 帮助信息、调试日志、警告、堆栈只允许输出到 `stderr`
- 不允许在 `stdout` 先打印 banner 或帮助文本，再输出 JSON
- 每次 CLI 调用的 `stdout` 只能有一个 JSON 对象

## 退出码

最小退出码映射：

| 退出码 | 语义 | 对应错误 |
|---|---|---|
| `0` | 成功 | 无 |
| `2` | 参数错误 | `ERR_CLI_INVALID_ARGS` |
| `3` | 未知命令 | `ERR_CLI_UNKNOWN_COMMAND` |
| `4` | 已注册但未实现 | `ERR_CLI_NOT_IMPLEMENTED` |
| `5` | 运行时不可用 | `ERR_RUNTIME_UNAVAILABLE` |
| `6` | 执行失败 | `ERR_EXECUTION_FAILED` |

## 兼容策略

- Phase 1 内，以上必填字段与退出码语义视为冻结
- 后续 FR 可以新增可选字段，但不能删除或重定义既有字段语义
- 后续 FR 可以增加新命令，但不能改写命令上下文和外层成功 / 错误壳

## 最小示例

### 示例 1：成功

```text
$ webenvoy runtime.ping
stdout: {"run_id":"run-20260319-0001","command":"runtime.ping","status":"success","summary":{"message":"ok"},"timestamp":"2026-03-19T12:00:00.000Z"}
stderr: <empty>
exit: 0
```

### 示例 2：未知命令

```text
$ webenvoy runtime.unknown
stdout: {"run_id":"run-20260319-0002","command":"runtime.unknown","status":"error","error":{"code":"ERR_CLI_UNKNOWN_COMMAND","message":"未知命令","retryable":false},"timestamp":"2026-03-19T12:00:01.000Z"}
stderr: <optional human hint>
exit: 3
```

### 示例 3：参数错误

```text
$ webenvoy runtime.ping --params 'not-json'
stdout: {"run_id":"run-20260319-0003","command":"runtime.ping","status":"error","error":{"code":"ERR_CLI_INVALID_ARGS","message":"--params 必须是 JSON 对象字符串","retryable":false},"timestamp":"2026-03-19T12:00:02.000Z"}
stderr: <optional human hint>
exit: 2
```

### 示例 4：执行失败

```text
$ webenvoy runtime.ping --params '{"force_fail":true}'
stdout: {"run_id":"run-20260319-0004","command":"runtime.ping","status":"error","error":{"code":"ERR_EXECUTION_FAILED","message":"命令执行失败","retryable":false},"timestamp":"2026-03-19T12:00:03.000Z"}
stderr: <optional human hint>
exit: 6
```
