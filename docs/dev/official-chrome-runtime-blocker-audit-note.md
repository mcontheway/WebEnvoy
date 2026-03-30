# official Chrome runtime blocker 审计说明

## 基本信息

- 关联 Issue：#301
- 关联 PR：待创建
- 负责人：Codex

## 背景

`#300` 当前围绕 `#208` 的 `editor_input` 最小真实交互验证已经完成实现、合同测试与本地验证，但在继续向 official Chrome 真实现场推进时，暴露出了一个更底层的运行时闭环缺口。

这个缺口不属于 `editor_input` 单动作实现本身，而属于 official Chrome persistent extension 主路径的运行时前置条件。因此需要把它从 `#300` 单独拆出，作为新的前置事项收口。

## 目标

- 记录当前仓库现场下已观察到的 official Chrome runtime blocker
- 说明为什么它不应继续塞进 `#300`
- 为后续独立 issue/PR 留下可复核的审计证据
- 列出除主 blocker 外仍需二次核查的 close-readiness 风险点

## 非目标

- 不在本说明内直接实现 Native Messaging host/broker
- 不在本说明内推进 `#208` 的真实页面执行
- 不修改 `FR-0011` 对 `editor_input` 的正式验证口径
- 不把 `xhs.editor_input` / `xhs.interact` 升级为正式 machine contract
- 不扩张到上传、提交、发布确认或完整写链路

## 范围

- 受影响模块 / 文件
  - `src/runtime/native-messaging/host.ts`
  - `src/runtime/native-messaging/bridge.ts`
  - `extension/background.ts`
  - `src/runtime/persistent-extension-identity.ts`
  - `docs/dev/architecture/system-design/communication.md`
  - `docs/dev/specs/FR-0015-official-chrome-runtime-migration/spec.md`
- 受影响命令 / 页面 / 流程
  - `runtime.start`
  - `runtime.login`
  - `runtime.status`
  - official Chrome persistent extension 主路径
  - `#208` 的 `editor_input` 真实页面验证链路

## 方案摘要

- 已确认主 blocker：
  - 当前仓库没有生产可用的 Chrome Native Messaging host 可执行入口。
  - 现有 `src/runtime/native-messaging/host.ts` 是 CLI 侧 transport/client，只会读取 `WEBENVOY_NATIVE_HOST_CMD` 后 `spawn` 外部进程并通过 stdio 收发消息。
  - 仓库里唯一具备 host server 形态的脚本是测试 mock `tests/fixtures/native-host-mock.mjs`。
- 为什么必须单独拆出：
  - `#300` 的目标是 `editor_input` 最小真实交互验证，不应承接 official Chrome runtime 主路径缺口。
  - 即使人工把 unpacked extension 装进 official Chrome，也仍无法形成满足 `FR-0011` 的 `CLI <-> host <-> background <-> content-script` 真实正式闭环。
  - 该缺口属于 runtime 前置能力，应由独立前置 issue/PR 承接。
- 后续独立实现 PR 的候选检查维度：
  - 是否补上可注册到 Chrome 的正式 Native Messaging host/broker 入口
  - 是否定义清楚 host manifest 的生成/注册方式
  - 是否打通 `identity -> transport -> bootstrap readiness` 最小闭环
  - 是否仍把 `editor_input` live evidence、本地登录态迁移、最终安装器产品化留在独立后续事项

## 主 blocker 证据

- official Chrome persistent path 要求持久 identity 边界与 Native Messaging `allowed_origins` 一致：
  - `docs/dev/architecture/system-design/communication.md`
  - `src/runtime/persistent-extension-identity.ts`
- 当前 CLI 侧只具备 “连接一个外部 native host” 的 transport/client 能力，而不具备“作为 native host 被 Chrome 注册并调用”的正式 server 入口：
  - `src/runtime/native-messaging/host.ts`
  - `src/runtime/native-messaging/bridge.ts`
- 仓库里现成的 host server 形态仅存在于测试 mock：
  - `tests/fixtures/native-host-mock.mjs`

## 证据快照

- 代码路径核查结果：
  - `rg -n "WEBENVOY_NATIVE_HOST_CMD|connectNative|bridge\\.open|bridge\\.forward" src extension tests`
  - 结果显示 `WEBENVOY_NATIVE_HOST_CMD` 仅出现在 `src/runtime/native-messaging/host.ts` 和测试夹具用法里；`bridge.open` / `bridge.forward` 的大量命中主要分布于 extension 与合同测试。
- `src/runtime/native-messaging/host.ts` 现场结论：
  - 该文件读取 `WEBENVOY_NATIVE_HOST_CMD`。
  - 解析命令后通过 `spawn(...)` 启动外部进程，并以 stdio/native messaging frame 进行通信。
  - 文件内没有“被 Chrome 直接调用并处理 stdin/stdout 协议循环”的 host server 主入口。
- `tests/fixtures/native-host-mock.mjs` 现场结论：
  - 该脚本直接消费 stdin、写回 framed stdout，并处理 `bridge.open` / `bridge.forward` / `__ping__`。
  - 它具备 host server 形态，但位于测试夹具目录，不能作为 production host 入口。
- 本机 official Chrome 现场结论：
  - `find "$HOME/Library/Application Support/Google/Chrome/NativeMessagingHosts" -maxdepth 1 -type f -name 'com.webenvoy*.json' -print`
  - 当前无输出，说明本机用户级 Chrome Native Messaging manifest 尚未注册 WebEnvoy host。
- `#208` 探针现场结论：
  - `./bin/webenvoy runtime.status --profile xhs_208_probe --run-id issue208-status-now`
  - 当前返回 `identityBindingState=missing`、`transportState=not_connected`、`bootstrapState=not_started`、`runtimeReadiness=blocked`，且 `identityPreflight.manifestPath=null`。
  - 这只能证明 live 现场未 ready；它不单独构成正式关闭条件变更。

## 除主 blocker 外仍需二次核查的潜在 blocker

- identity blocker
  - stable `extension_id`
  - `allowed_origins` 与 extension origin 一致性
  - profile 内扩展已安装且启用的正式验证方式
- transport blocker
  - host manifest 注册路径
  - official Chrome 对 host 的实际发现路径
  - `runtime.connectNative` 成功后的心跳与断线恢复
- bootstrap blocker
  - `runtime.bootstrap` ack 与当前 `run_id` / `runtime_context_id` 一致性
  - `runtime.readiness` 在 `transport ready` 后的状态收口
- evidence blocker
  - `editor_input` 成功/失败信号是否已满足 `FR-0011`
  - `minimum_replay` 是否足够 reviewer 复核
  - 是否还能被质疑为一次性偶然成功
- scope blocker
  - 是否存在任何会被 reviewer 视为越界到 upload / submit / publish confirm / full write flow 的实现点
- merge blocker
  - guardian verdict
  - GitHub checks
  - PR closing semantics
  - live evidence 引用是否完整

## 影响面与风险

- 这是高于 `#208 editor_input` 的运行时前置缺口；如果不先拆出，会让 `#300` 越界。
- 它已经触及 runtime、Native Messaging、official Chrome persistent extension 边界，因此后续实现应按正式前置事项处理，而不是继续以“只差登录/安装”描述。
- 本说明本身只记录当前审计证据，不改变正式契约、issue 关闭条件或运行时代码；后续依赖关系仍以对应 Issue / PR / FR 为准。

## 复核方式

- 代码路径核查：
  - `rg "WEBENVOY_NATIVE_HOST_CMD|connectNative|bridge.open|bridge.forward" src extension tests`
- GitHub 状态核查：
  - `gh issue view 208`
  - `gh pr view 300`
- 现场状态核查：
  - `./bin/webenvoy runtime.status --profile xhs_208_probe --run-id issue208-status-now`

## 回滚方式

- 如需撤回本说明，revert 对该说明文件的提交即可
- 不涉及 schema 迁移、运行时代码回滚或 profile 持久化资产清理

## 升级信号

出现以下情况时，不应继续按“审计说明 + 文档 PR”推进，而应升级为正式 FR/实现事项：

- 开始补正式 Native Messaging host/broker 代码
- 引入新的共享契约、host manifest 生成规则或安装命令
- 需要正式冻结 `runtime.status` / readiness 的新共享状态语义
- 范围扩张到 final installer、分发路径产品化或 `#208` live evidence 实现
