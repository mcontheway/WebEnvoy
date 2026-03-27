# FR-0015 实施计划

## 实施目标

本 FR 的实施目标不是交付 runtime 迁移代码，而是为 `#281` 输出 implementation-ready 输入。该输入必须让后续实现 PR 可以直接围绕 identity preflight、bootstrap contract、runtime readiness 状态和最小回滚边界开展工作，而不再回到 `#280/#279` 重新讨论方向。

## 分阶段拆分

### 阶段 1：冻结继承边界与 implementation-prep 范围

- 产出：
  - `spec.md`
  - `implementation-prep.md`
  - `research.md`
- 目标：
  - 把 `#280` 的证据输入与 `#279` 的 architecture freeze 显式转成 `#281` 的正式前置。
  - 明确 `#281` 当前承接什么、不承接什么。

### 阶段 2：冻结共享契约与 readiness 边界

- 产出：
  - `contracts/runtime-bootstrap.md`
  - `contracts/runtime-readiness-status.md`
  - `data-model.md`
  - `risks.md`
- 目标：
  - 冻结 `runtime_bootstrap_envelope` 的独立 transport contract。
  - 冻结 identity binding、bootstrap ack、`runtime.status` readiness 的最小状态、兼容关系与失败面。

### 阶段 3：冻结推荐实现切片与状态型 runtime 收口要求

- 产出：
  - `TODO.md`
  - implementation-prep 中的代码路径、切片顺序、验证矩阵与回滚边界
- 目标：
  - 给后续实现 PR 明确第一刀切片与 stop-ship 边界。
  - 避免实现阶段把安装器、candidate 分发、验证体系混进 runtime migration。

## 实现约束

1. 不得回改 `#279/PR #283` 已冻结的 official Chrome 主路径方向。
2. 不得把 `developer mode / unpacked`、External Extensions JSON、Windows 外部安装/注册表或 Chrome Web Store 升格为当前正式主方案。
3. 不得重写 FR-0002 的 link-layer handshake、heartbeat、relay 基线。
4. 不得把 FR-0003 的最小 profile/session 边界扩成完整账号系统或安装资产仓库。
5. 不得把 `runtime_bootstrap_envelope` 写回 profile 永久元数据，或继续通过 staged extension 文件承载。
6. 不得把 `#239` 的验证体系、baseline 框架与 live/recon/dry_run 分层混入本 FR。

## 测试与验证策略

本次 spec-only PR 的验证应包括：

1. 文档与套件门禁：
  - `git diff --check`
  - `bash scripts/docs-guard.sh`
  - `bash scripts/spec-guard.sh`
2. 套件完整性检查：
  - formal spec 是否补齐 `spec.md`、`plan.md`、`TODO.md`
  - 高风险 runtime 套件是否补齐 `contracts/`、`data-model.md` 与 `risks.md`
3. 后续实现 PR 最小验证矩阵要求：
  - identity preflight 成功 / 失败
  - Native Messaging ready 但 bootstrap pending
  - bootstrap ack 成功 / 超时 / stale ack / identity mismatch
  - 断连后同 run 重试与幂等 bootstrap
  - `runtime.status` 对 identity / bootstrap readiness 的状态回读
  - 控制进程死 / 浏览器活
  - 锁仍持有但控制链断开
  - ready marker 陈旧
  - 同一 profile 的并发争抢

### 状态型 runtime 健康矩阵

- `healthy`
  - `lockHeld=true`
  - `identityBindingState=bound`
  - `transportState=ready`
  - `bootstrapState=ready`
- `recoverable`
  - identity 仍正确
  - transport 暂时断开或 bootstrap timeout
  - 允许同 run 幂等重试或显式 stop/start 恢复
- `blocked`
  - 锁被抢占或锁归属不可确认
  - identity mismatch
  - stale ack / ready marker
  - 任何不允许继续执行业务命令的 stop-ship 情况
- `unknown`
  - 多信号冲突，无法确认当前 run readiness 归属

### 恢复路径

- 控制进程死 / 浏览器活：
  - 不得沿用旧控制面 ready 判定
  - 必须重新验证 lock、transport 与 bootstrap ack 归属
- 锁仍持有但控制链断开：
  - 必须先判定为 `recoverable` 或 `blocked`
  - 不得直接放行业务命令
- 失锁或锁被抢占：
  - 即使 transport / bootstrap 仍显示成功，也必须退出 `ready`
  - 只能进入 `blocked` 或 `recoverable`
- ready marker 陈旧：
  - 直接判为 `blocked`
  - 必须重新 bootstrap，不得复用旧 marker
- 并发争抢同一 profile：
  - 必须保持 FR-0003 独占锁基线
  - 第二个竞争者不得以 bootstrap 成功绕过锁约束

## TDD 范围

后续实现默认先写测试的模块：

- identity preflight 纯逻辑
- `runtime_bootstrap_envelope` 解析、校验与幂等处理
- runtime readiness 状态机
- bootstrap ack 与错误分类映射
- `runtime.status` 的读模型与状态聚合逻辑

后续实现暂不强制先写测试的部分：

- 最终安装器 UI / 引导流程
- candidate 分发路径产品化
- Chrome Web Store / 合规上架流程
- `#239` 的 live / recon / dry_run 验证框架

## 并行 / 串行关系

- 可并行：
  - runtime bootstrap contract 起草
  - readiness 状态机与错误模型设计
  - 后续实现代码路径梳理
- 串行：
  - 必须先完成本 FR 的 spec review，才能进入 `#281` 的实现 PR。
  - 必须先冻结 bootstrap contract 与 readiness 边界，才能开始 runtime.start / runtime.login 的迁移实现。
  - 必须先明确 identity preflight 失败面的 stop-ship 规则，才能做写路径或更大范围的 live 验证。
- 明确拆开：
  - `#281` 的实现 PR 与 `#239` 的验证 PR 必须分开推进。
  - candidate 安装/分发路径若要产品化，必须另开后续事项，不挂在本 FR 的第一刀实现中。

## 进入实现前条件

1. FR-0015 的 spec review 通过，且 reviewer 明确认可其足以支撑 `#281` implementation-prep。
2. `contracts/runtime-bootstrap.md`、`contracts/runtime-readiness-status.md`、`data-model.md` 与 `risks.md` 被 reviewer 认可，能解释 bootstrap / identity / readiness 的共享边界。
3. 后续实现 PR 明确只围绕 runtime migration 第一刀切片，使用 `Refs #281`，不混入 `#239`、安装器产品化或 candidate 分发产品化。
4. 后续实现 PR 预先声明 stop-ship 条件、回滚入口与最小验证矩阵。
5. 在这些条件满足前，禁止把 `#281` 视为已闭环，也禁止使用 `Fixes #281`。
