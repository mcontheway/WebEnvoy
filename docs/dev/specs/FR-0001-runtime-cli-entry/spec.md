# FR-0001 CLI 最小入口与可集成契约骨架

## 背景

Phase 1 要先证明一件事成立：Agent 能通过 CLI 稳定调用 WebEnvoy，拿到机器可读结果，并在失败时知道错误属于哪一类。

当前仓库还没有业务代码骨架，也没有稳定的 CLI 入口、命令命名、输出封装、错误结构和退出码规则。如果在这些契约未冻结前直接推进 `#142`、`#143`、`#145`，后续很容易出现以下问题：

- 不同事项各自定义命令风格、参数模型和错误格式
- 上层 Agent 或脚本无法依赖稳定的 `stdout` JSON
- 运行标识、错误分类和退出码在不同命令之间漂移
- 首个平台读链路变成一次性命令特例，无法承接 Phase 1 的最小能力封装骨架

因此，`#141` 的职责不是“先做一个能跑的脚本”，而是先冻结 CLI 最小调用面，为 Sprint 1 其余事项提供统一承载面。

## 目标

1. 对齐 Phase 1 必需件 `[1. CLI 最小入口与可集成契约]`，先把 WebEnvoy 做成可被稳定调用的工具入口。
2. 建立单一可执行入口 `webenvoy`，并冻结最小命令上下文与命令命名空间规则。
3. 冻结最小 argv 调用约定，避免后续事项各自发明 CLI 语法。
4. 定义统一的 `stdout` 成功/错误响应、`stderr` 日志边界、稳定退出码和 `run_id` 语义。
5. 为 `#142`、`#143`、`#145`、`#154` 提供不需要推翻的 CLI 承载面。
6. 只冻结最小稳定契约，不提前承诺完整命令面、SDK、API 或 daemon 形态。

## 非目标

- 不在本 FR 内完成 Native Messaging 通道本身。
- 不在本 FR 内完成浏览器启动、Profile 恢复、会话并发保护或 SQLite 落库。
- 不在本 FR 内完成任意平台的真实业务读取、写入或下载。
- 不在本 FR 内完成 `webenvoy install` / `uninstall` 之类依赖 Native Messaging Host 的系统能力。
- 不在本 FR 内定义完整的 Phase 2 L2 通用原语或能力封装格式。
- 不在本 FR 内实现 SDK / API / 常驻服务。

## 功能需求

### 1. 单一 CLI 入口与标准化命令上下文

- 仓库必须提供单一可执行入口 `webenvoy`。
- CLI 在进入命令处理层前，必须把输入标准化为统一上下文：
  - `run_id`
  - `command`
  - `profile`（如适用）
  - `params`
  - `cwd`
- `run_id` 可由调用方显式传入；未传入时由 CLI 自动生成。
- `command` 必须是稳定的逻辑命令标识，而不是临时脚本文件名。

### 2. 最小 CLI 调用约定

- CLI 最小调用形态冻结为：
  - `webenvoy <command> [--params '<json>'] [--profile <profile>] [--run-id <run_id>]`
- `<command>` 是必填位置参数，位于 `webenvoy` 之后的第一个参数位置。
- `--params` 是结构化参数的唯一正式入口：
  - 值必须是 JSON 对象字符串
  - 未传入时，处理层接收空对象 `{}`
- `--profile` 为可选参数：
  - 只有声明依赖身份 / 会话的命令才强制要求
- `--run-id` 为可选参数：
  - 未传入时由 CLI 自动生成
- Phase 1 只冻结最小帮助 / 诊断调用，不扩张成完整命令面：
  - `webenvoy runtime.help`
  - `webenvoy runtime.ping`
- 本 FR 不冻结短参数别名，不冻结多种等价 argv 语法，不允许后续事项绕开 `<command> + --params` 这一最小模式。

### 3. 最小命令命名空间与路由状态

- Phase 1 只冻结最小命名空间规则，不要求一次性铺满全部命令。
- 逻辑命令标识至少允许两类：
  - `runtime.<verb>`：运行时 / 系统命令
  - `<platform>.<verb>`：平台能力命令
- 命令路由必须显式区分以下状态：
  - 未知命令
  - 已注册但未实现
  - 已实现并执行成功
  - 已实现但执行失败

### 4. 成功响应契约

- 成功路径必须只向 `stdout` 输出单个机器可读 JSON 对象。
- 最小成功响应必须包含：
  - `run_id`
  - `command`
  - `status`
  - `summary`
  - `timestamp`
- 其中：
  - `status` 在成功路径固定为 `success`
  - `summary` 为对象，用于返回最小摘要，而不是人类说明文字
  - `timestamp` 使用可稳定解析的时间格式

### 5. 错误响应契约

- 失败路径也必须只向 `stdout` 输出单个机器可读 JSON 对象。
- 最小错误响应必须包含：
  - `run_id`
  - `command`
  - `status`
  - `error.code`
  - `error.message`
  - `error.retryable`
  - `timestamp`
- 其中 `status` 在失败路径固定为 `error`。
- Phase 1 最少区分以下错误类别：
  - `ERR_CLI_INVALID_ARGS`
  - `ERR_CLI_UNKNOWN_COMMAND`
  - `ERR_CLI_NOT_IMPLEMENTED`
  - `ERR_RUNTIME_UNAVAILABLE`
  - `ERR_EXECUTION_FAILED`

### 6. `stdout` / `stderr` 边界

- `stdout` 只允许输出单个成功或失败 JSON 对象。
- 面向人类的帮助文字、调试日志、告警和堆栈只能输出到 `stderr`。
- CLI 不能在 `stdout` 先打印 banner、help 片段或彩色日志，再输出 JSON。

### 7. 稳定退出码

- 同一类错误在不同命令下必须返回同一退出码。
- 本 FR 冻结最小退出码集合：
  - `0`：成功
  - `2`：参数错误
  - `3`：未知命令
  - `4`：已注册但未实现
  - `5`：运行时不可用
  - `6`：执行失败

### 8. 最小工程骨架

- 本 FR 的实现必须为以下职责留出明确模块边界：
  - CLI 启动
  - 命令注册 / 路由
  - 运行上下文
  - 成功 / 错误输出格式化
  - 退出码映射
- 不允许把全部逻辑硬编码在单一入口脚本中。

### 9. 与 Phase 1 其余事项的承接关系

- `#142` 必须能在不改写 CLI 外层契约的前提下挂接 Native Messaging / Extension 相关命令。
- `#143` 必须能在不改写 `run_id`、`profile`、统一错误结构的前提下挂接最小身份 / 会话命令。
- `#145` 必须能在 `<platform>.<verb>` 命名空间下挂接首个平台读命令。
- `#154` 必须在既有 `stdout` 错误壳和退出码治理下补强诊断，而不是重新发明另一套失败返回。

## GWT 验收场景

### 场景 1：已实现命令成功返回机器可读结果

Given 调用方执行一个已注册且已实现的 CLI 命令  
When 命令完成执行  
Then `stdout` 只输出单个 JSON 成功对象  
And 响应包含 `run_id`、`command`、`status=success`、`summary`、`timestamp`  
And 进程退出码为 `0`

### 场景 2：未知命令被稳定拒绝

Given 调用方传入未注册的逻辑命令标识  
When CLI 完成路由  
Then `stdout` 只输出单个 JSON 错误对象  
And `error.code=ERR_CLI_UNKNOWN_COMMAND`  
And 进程退出码为 `3`

### 场景 3：已注册但未实现的命令不会静默失败

Given 调用方传入已注册但当前版本尚未实现的命令  
When CLI 路由到占位处理器  
Then `stdout` 只输出单个 JSON 错误对象  
And `error.code=ERR_CLI_NOT_IMPLEMENTED`  
And 进程退出码为 `4`

### 场景 4：参数错误被结构化返回

Given 调用方传入缺少必需参数或无法解析的结构化参数  
When CLI 完成参数校验  
Then `stdout` 只输出单个 JSON 错误对象  
And `error.code=ERR_CLI_INVALID_ARGS`  
And 进程退出码为 `2`

### 场景 5：命令依赖的运行时不可用

Given 调用方执行一个需要底层运行时支持的已实现命令  
And 当前底层运行时尚未就绪或不可连接  
When 命令被执行  
Then `stdout` 只输出单个 JSON 错误对象  
And `error.code=ERR_RUNTIME_UNAVAILABLE`  
And `error.retryable` 可根据运行时状态为 `true`  
And 进程退出码为 `5`

### 场景 6：已实现命令执行失败时返回统一失败语义

Given 调用方执行一个已注册且已实现的 CLI 命令  
And 当前运行时可用，参数也已通过校验  
And 命令处理器在执行业务逻辑时返回不可继续的失败  
When 命令结束  
Then `stdout` 只输出单个 JSON 错误对象  
And `error.code=ERR_EXECUTION_FAILED`  
And `error.retryable` 可根据失败性质为 `false`  
And 进程退出码为 `6`

## 异常与边界场景

### 1. 参数与输入边界

- 调用方传入非法 JSON、空 `params`、错误类型参数时，必须落到 `ERR_CLI_INVALID_ARGS`，而不是抛出未处理异常。
- 调用方显式传入非法 `run_id` 格式时，必须返回参数错误。
- 不要求所有命令都必须带 `profile`；只有声明依赖 `profile` 的命令才校验该字段。
- `<command>` 缺失时，必须返回参数错误，而不是默认落入某个隐式命令。

### 2. 输出边界

- 任意失败路径都不能让人类日志污染 `stdout`。
- 不能输出多个 JSON 对象供上层自己拼接。
- 帮助文本、调试模式、警告提示都必须走 `stderr`。

### 3. 路由与命名边界

- 未知命令与未实现命令必须是两类不同错误，不能共用同一错误码。
- 平台命令命名空间允许增加新命令，但不能改写已冻结的外层错误壳与退出码语义。
- 本 FR 不要求冻结全部平台命令列表，只冻结命名规则和最小外层契约。
- 后续事项不得自行引入另一套 `argv` 入口，例如把 `command` 改成 `--command` 或把结构化参数改成自由文本位置参数。

### 4. 运行时异常

- 运行时不可用与业务执行失败必须分开表达，避免把所有失败都压成 `ERR_EXECUTION_FAILED`。
- 处理器内部抛出的未捕获异常，必须被 CLI 外层包装成结构化错误，而不是直接把堆栈写到 `stdout`。

### 5. 并发与可追踪性

- 同一时刻多个 CLI 进程并发运行时，每次调用都必须拥有独立 `run_id`。
- 后续 FR 若引入运行记录或诊断，也必须复用这里定义的 `run_id`，而不是各自再生成一套运行标识。

## 验收标准

1. FR-0001 的契约文档能明确回答 Phase 1 的 CLI 稳定调用面是什么，以及后续 FR 该如何承接。
2. `spec.md` 中存在足以指导 QA 与实现对齐的 GWT 主路径和关键失败路径。
3. 未知命令、未实现命令、参数错误、运行时不可用、执行失败这五类最小失败语义已经被清楚区分。
4. `stdout` 只输出单个 JSON、`stderr` 承载人类日志、退出码稳定映射，这三件事已经被写成正式契约。
5. 最小 argv 调用约定已经冻结，调用方能明确知道如何传入 `<command>`、`--params`、`--profile`、`--run-id`。
6. 本 FR 没有提前承诺 SDK / API、完整命令面、L2 原语或平台读写实现。
7. 至少存在与本 FR 风险相匹配的最小验证方向：
   - CLI 入口可调用
   - 帮助 / 诊断命令调用
   - 已实现命令成功输出
   - 未知命令输出
   - 未实现命令输出
   - 参数错误输出
   - 执行失败输出
   - 退出码断言
   - `stdout` 污染断言

## 依赖与前置条件

- 前置文档：
  - `vision.md`
  - `docs/dev/roadmap.md`
  - `docs/dev/architecture/system-design.md`
  - `docs/dev/architecture/system-design/communication.md`
  - `docs/dev/architecture/system-design/error-handling.md`
  - `docs/dev/architecture/ARCHITECTURE_PRINCIPLES.md`
- Governing issue：
  - `#141`
- 本套件附加文档：
  - `contracts/cli-entry.md`
  - `risks.md`
- 后续承接事项：
  - `#142`
  - `#143`
  - `#145`
  - `#154`
