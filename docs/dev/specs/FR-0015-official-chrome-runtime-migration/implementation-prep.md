# FR-0015 Implementation Prep

## 文档定位

本文档用于把 `#281` 收口到 implementation-ready 输入，不修改 `spec.md` 的正式语义，也不混入运行时代码。

本文档冻结的是：

- `#281` 当前 implementation-prep 应先承接哪些真实代码路径
- 哪些边界继续沿用 `#279/PR #283`、FR-0002、FR-0003
- 后续实现第一刀应怎么切，哪些范围必须继续排除
- 最小验证矩阵、stop-ship 条件与回滚边界

本文档不是功能实现承诺，也不代表 `#281` 已实现闭环。

GitHub backlog 由 `#361` 承接本文件对应的 implementation-prep 第一刀停点，但 `#281` 继续是 FR-0015 runtime migration 的主线约束 issue。本文档继续负责冻结实现输入；下游实现 issue / PR 可以显式挂接 `#361`，但不得把它写成对 `#281` 的替代，也不得把 `#361` 升格为 formal 契约来源。

## 1. 现状收口

### 1.1 已冻结且不得重定义的基线

`#279/PR #283` 已冻结以下正式边界：

- official Chrome 137+ 的 stealth 主路径不再依赖 `--load-extension` 的 per-run staged extension
- branded Chrome 主链是 `profile` 内持久安装扩展 + runtime bootstrap/context 解耦
- `stable extension_id + Native Messaging allowed_origins + profile` 是持久 identity 边界
- Chromium / Chrome for Testing 只保留为开发、调试和验证 fallback
- candidate 安装/分发路径不能替代上述正式 runtime / identity / bootstrap 边界

FR-0002 / FR-0003 已冻结以下基线：

- FR-0002 只承接 link-layer handshake / relay / heartbeat / disconnect
- FR-0003 只承接 Named Profile、lock、最小 lifecycle、最小元数据

`FR-0015` 只能在这些基线之上补 implementation-prep 输入，不能回头重定义。

### 1.2 当前真实缺口

当前上位文档已经承认：

- `runtime_bootstrap_envelope` 属于 run/session 级输入
- 它不属于静态扩展资产
- 它也不属于 profile 永久元数据

但实现前仍缺三类正式输入：

1. 独立 bootstrap contract：谁下发、谁确认、何时失败、如何幂等。
2. readiness 分层：identity ready、transport ready、bootstrap ready 之间如何组合成可执行状态，以及如何映射到 `runtime.status`。
3. 推荐切片：后续代码第一刀先改哪里，哪些不应混入。

## 2. 推荐实现顺序

### 2.1 第 1 层：identity preflight

先实现 official Chrome persistent extension 主路径的 identity preflight，而不是直接推进业务命令。

第一刀应至少回答：

- 当前 profile 是否具备稳定 `extension_id`
- Native Messaging manifest 的 `allowed_origins` 是否与该 identity 一致
- 当前 profile 是否处于“已安装扩展且可进入运行阶段”的身份前提

在当前 formal 冻结下，identity preflight 第一刀允许把最小 identity 绑定子集持久化进 `__webenvoy_meta.json.persistentExtensionBinding`，但边界必须保持收敛：

- 只允许 `extensionId`、`nativeHostName`、`browserChannel`、`manifestPath`
- `allowedOrigins`、`bindingState` 与 bootstrap/readiness 事实继续在运行时推导
- 非法或冲突的持久字段必须阻断执行，不得作为“自动修复”的输入
- 当前 formal 只冻结“identity 输入缺省时允许回读最小持久 binding”的行为，不把任何临时命令参数名升级为正式 machine contract
- `manifestPath` 只作为定位提示使用；实现必须先把它归一化为绝对路径，再基于 manifest 内容重新校验 `nativeHostName/allowed_origins/extensionId`，缺失、不可读、内容不匹配或无法证明当前 identity 时一律阻断

若 identity preflight 失败：

- 立即 stop-ship
- 不继续进入 bootstrap 或业务执行
- 不把失败伪装成“稍后自动修复”

### 2.2 第 2 层：bootstrap contract 与 ack

identity preflight 通过后，再建立 `runtime_bootstrap_envelope` 的下发与 ack。

第一刀建议只覆盖：

- envelope 构造
- 向目标扩展实例下发
- ack 收敛
- stale ack / timeout / identity mismatch 的错误分类

不在第一刀混入：

- 最终安装器
- candidate 分发产品化
- 复杂业务命令
- `#239` 的验证框架

### 2.3 第 3 层：runtime readiness 状态收口

在 identity preflight 与 bootstrap ack 打通后，再把 readiness 收敛到正式状态视图。

至少需要新增或补齐的运行时读模型事实：

- `identity_binding_state`
- `transport_state`
- `bootstrap_state`
- `effective_runtime_readiness`

这些字段在 formal 套件里的地位必须明确为：

- `profileState` / `browserState`：继续沿用 FR-0003
- `identityBindingState` / `transportState` / `bootstrapState` / `runtimeReadiness`：FR-0015 新增的 runtime readiness 衍生视图

推荐状态分层：

- `identity_missing`
- `identity_bound`
- `transport_ready`
- `bootstrap_pending`
- `bootstrap_ready`
- `blocked`
- `unknown`

要求：

- 不能再用单一 `ready` 掩盖多信号差异
- 多信号冲突时优先进入保守状态

## 3. 预计优先触达的代码路径

后续实现第一刀建议优先看这些路径：

- `src/commands/runtime.ts`
  - `runtime.start`
  - `runtime.login`
  - `runtime.status`
- `src/runtime/**`
  - runtime controller / lifecycle / status 聚合逻辑
- `extension/background.*`
  - bootstrap 接收、ack、ready 信号
- Native Messaging host 相关运行时桥接路径

第一刀不建议主改造的方向：

- 安装器脚本
- 分发产品化路径
- Chrome Web Store / 合规上架材料
- `#239` 的 baseline / live 验证框架

## 4. stop-ship 与回滚边界

以下情况必须 stop-ship，不进入更深实现或 merge-ready 判定：

- identity preflight 仍需要依赖临时 staged extension 才能成立
- `allowed_origins` 不能稳定绑定正式 `extension_id`
- bootstrap ack 无法区分当前 run 与陈旧 run
- readiness 仍然只依赖单一信号而无冲突收敛策略
- 实现 PR 混入安装器产品化或 `#239` 验证体系

后续实现回滚边界应至少保证：

- 可回退到“identity preflight 阻断 + 不执行业务命令”的保守状态
- `persistentExtensionBinding` 仅作为加性可选字段存在；回滚后可以忽略或显式移除，不要求 schema migration
- 不把 candidate 分发路径误当 fallback 主路径回写进正式契约

## 5. 最小验证矩阵

后续实现 PR 至少应覆盖：

- identity preflight：
  - extension identity 存在
  - extension identity 缺失
  - `allowed_origins` mismatch
- bootstrap：
  - deliver success + current ack
  - deliver success + stale ack
  - ack timeout
  - identity mismatch
- readiness：
  - transport ready + bootstrap pending
  - transport disconnected + stale bootstrap ready
  - identity bound + signal conflict -> `blocked|unknown`
- 恢复：
  - 同 run 幂等重试
  - stop/start 后陈旧 ready marker 不得续用

## 6. 明确仍不属于 #281 的内容

- 最终安装器设计
- Chrome Web Store / 合规上架定稿
- candidate 安装/分发路径产品化
- `#239` 的验证体系

## 7. GitHub backlog 挂接

- `#281` 继续作为 FR-0015 runtime migration 的主线约束 issue；`#361` 只承接当前 implementation-prep 第一刀 backlog 的 GitHub 回写。
- `#361` 只负责 backlog 挂接与关闭元数据；scope、stop-ship、验证入口与恢复边界仍只以本文件、`spec.md`、`plan.md`、`contracts/`、`risks.md` 为准，不要求 issue 正文承担 formal 契约职责。
- 历史实现链路继续以 `#281` 及其已合并 PR 为准；后续若仍需补第一刀 implementation-prep / backlog handoff follow-up，应在不外扩 scope 的前提下同时显式 `Refs #281` 与 `Refs #361`。纯验证 follow-up 继续归属 `#239`，不在 `#361` 下重复挂接。
