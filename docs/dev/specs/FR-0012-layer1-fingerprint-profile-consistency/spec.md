# FR-0012 Layer 1 JS 指纹补全与 profile 一致性

## 背景

`docs/dev/architecture/anti-detection.md` 已冻结 Layer 1 的目标能力与 profile 级一致性约束，但当前 roadmap 与正式 FR 只覆盖了最小门禁与最小反风控执行前置：Sprint 2 的 `FR-0010` 负责门禁、审批与审计，Sprint 3 的 `FR-0011` 负责插件层门禁主落点、最小节律与三态状态机。

当前 Layer 1 owning Work Item 不是重开一套反风控体系，而是 Phase 2 主树下、由 `FR-0012` 承接的 Layer 1 scope：在最小前置已经具备后，优先把 Layer 1 中仍缺失、但会直接影响 live 扩展与能力封装安全性的 JS 指纹补丁和 profile 一致性固化下来，形成后续实现 PR 的正式输入。

本 FR 只定义 Layer 1 正式规约，不重定义以下既有对象语义：

- `FR-0010` 的 `gate_input`、`gate_outcome`、`approval_record`、`audit_record`、`consumer_gate_result`
- `FR-0011` 的 `risk_state_machine`、`session_rhythm_policy`、`issue_action_matrix`
- Sprint 2 / Sprint 3 已冻结的门禁、审批、审计、状态机前置

## 目标

1. 冻结 Layer 1 JS 指纹补全的正式能力边界，至少覆盖 `AudioContext`、Battery API、`navigator.plugins`、`navigator.mimeTypes`、硬件参数与权限相关补丁。
2. 冻结 profile 级指纹承载模型，明确哪些字段必须固化到 `__webenvoy_meta.json`，以及这些字段如何在启动时注入到页面补丁。
3. 明确 profile 与运行环境的强绑定约束，避免跨 OS / 架构迁移导致指纹突变。
4. 明确 Layer 1 实现与 `FR-0010/0011` 的衔接方式：它只能消费现有门禁与状态机前置，不新增并行风控对象。
5. 为后续仅实现 Layer 1 的实现 PR 提供 implementation-ready 输入，使实现不再依赖从架构文档手工捞字段和边界。

## 非目标

- 不实现 Layer 2 事件级拟人模拟增强。
- 不实现 Layer 3 完整 session 行为节律引擎。
- 不实现 Layer 4 平台行为模型或长期画像。
- 不交付完整写闭环、平台业务动作或新的 live 放行逻辑。
- 不修改 `FR-0010` / `FR-0011` 的门禁、审批、审计、状态机对象语义。
- 不承诺解决 Worker 线程中的 JS hook 硬上限，也不在本 FR 引入 Camoufox/C++ 内核改造。

## 功能需求

### 1. Phase 2 定位与继承边界

- 本 FR 明确归属 Phase 2 主树中的 `FR-0012` 节点，对应 Layer 1 owning Work Item；它不是独立 phase，也不表示“反风控建设重新从 Layer 1 开始”。
- 本 FR 的所有 live 进入条件必须继续服从 `FR-0010` 与 `FR-0011`，包括但不限于：
  - `gate_input.risk_state`
  - `gate_outcome.gate_decision`
  - `approval_record`
  - `audit_record`
  - `issue_action_matrix`
- Layer 1 的实现只能作为既有门禁通过后的执行能力增强，不得新增绕过门禁的 profile 预热、后台 patch 或隐式 live 通道。

### 2. Layer 1 补丁范围冻结

- 本 FR 内的正式 Layer 1 范围只包括浏览器主线程可通过 JS/Main World 注入处理的指纹补全与一致性约束。
- 必须冻结以下 P0 实现范围：
  - `AudioContext` 指纹扰动
  - Battery API 伪造
  - `navigator.plugins` 注入
  - `navigator.mimeTypes` 注入
  - profile 级指纹种子与一致性字段持久化
- 必须冻结以下 P1 实现范围：
  - `navigator.hardwareConcurrency`
  - `navigator.deviceMemory`
  - `screen.colorDepth`
  - `screen.pixelDepth`
  - `window.performance.memory`
- 必须冻结以下 P2 范围，但允许在后续实现切片中单独落地：
  - `Permissions API`
  - `navigator.connection`
- 任一实现 PR 必须在 PR 描述中明确本次覆盖的优先级切片，不得宣称“已完成 #235 全量范围”却只交付部分补丁。

### 3. Profile 一致性承载模型

- 每个 profile 必须承载一个稳定的 `fingerprint_profile_bundle`，并固化到 `__webenvoy_meta.json`。
- `fingerprint_profile_bundle` 至少包含：
  - `ua`
  - `hardwareConcurrency`
  - `deviceMemory`
  - `screen.width`
  - `screen.height`
  - `screen.colorDepth`
  - `screen.pixelDepth`
  - `battery.level`
  - `battery.charging`
  - `timezone`
  - `audioNoiseSeed`
  - `canvasNoiseSeed`
- 其中 `audioNoiseSeed`、`canvasNoiseSeed` 和硬件/显示/电量字段属于稳定机器边界；具体 patch 函数实现、内部 helper 命名和注入代码组织方式不属于正式契约。
- Profile 创建后，上述字段默认稳定；实现不得把这些字段设计成每次运行重新随机生成。

### 4. 启动加载与注入契约

- 启动时必须存在一个稳定的 `fingerprint_patch_manifest`，用于声明当前 run 将加载哪些 Layer 1 补丁，以及它们读取 `fingerprint_profile_bundle` 的哪些字段。
- `fingerprint_patch_manifest` 必须区分：
  - `required_patches`
  - `optional_patches`
  - `unsupported_reason_codes`
- 当 profile 缺失必填字段或运行环境不满足一致性前置时，系统不得静默回退为“部分随机 patch 继续 live”。
- 对于 `required_patches` 未能加载的场景，执行层必须返回结构化阻断/降级原因，且该原因应能被 `FR-0010.audit_record` 追溯。

### 5. 环境绑定与迁移约束

- 必须冻结 profile 与运行环境的强绑定要求，至少覆盖：
  - `os_family`
  - `os_version`
  - `arch`
- 运行时若发现 profile 的绑定环境与当前环境不一致，必须视为 Layer 1 一致性失效，不得继续声称该 profile 仍符合稳定指纹要求。
- 本 FR 允许实现层选择“阻断 live”或“仅允许 `dry_run/recon`”，但不得在不记录原因的情况下继续运行高风险 live。

### 6. 与最小 profile/session 能力的衔接

- Layer 1 只能复用当前仓库已有的最小 profile/session 承载能力，不引入账号健康、行为人格、长期冷却或矩阵调度字段。
- 本 FR 可以新增 `__webenvoy_meta.json` 中与指纹一致性直接相关的字段，但不得顺带写入 Layer 3/4 才需要的长期行为元数据。
- 现有 profile 的 proxy 黏性绑定继续继承 `account.md` 约束；FR-0012 不把 proxy 字段升级为新的 Layer 1 正式契约对象，但要求实现不得破坏“同一 profile 保持同一出口”的一致性前提。
- 配置空间独占锁、运行时状态机、登录恢复语义继续继承现有 `account.md` 定义，不在本 FR 内重写。

### 7. Worker 盲区与能力边界显式化

- 本 FR 必须显式写清：Worker 线程中的 JS 指纹采集不在本 FR 承诺范围内。
- 若某平台检测结论依赖 Worker 线程交叉验证，本 FR 的实现只能被视为 Layer 1 主线程补全，不得被表述为“完整 JS 指纹问题已解决”。

## GWT 验收场景

### 场景 1：profile 持有稳定指纹包

Given 某 profile 已创建并进入可执行状态
When reviewer 检查 `__webenvoy_meta.json` 的正式字段要求
Then 能看到稳定的 `fingerprint_profile_bundle`
And 其中包含 Layer 1 补丁所需的最小一致性字段
And 这些字段不会被定义为每次运行重新随机生成

### 场景 2：启动时按 manifest 加载必需补丁

Given 某次执行需要启用 Layer 1 补丁
When 系统加载 profile 元数据并构造补丁清单
Then `fingerprint_patch_manifest` 能明确列出本次必需补丁
And 每个必需补丁都能映射到所需的 profile 字段

### 场景 3：环境不一致时拒绝伪装为稳定 profile

Given 某 profile 在 macOS/arm64 环境创建
When 该 profile 被尝试在不一致的 OS 或架构环境运行
Then 系统会明确报告 Layer 1 一致性失效
And 不会继续把该 profile 当作稳定指纹 profile 用于高风险 live

### 场景 4：Layer 1 继续服从既有门禁与状态机

Given 请求命中 `FR-0010` 或 `FR-0011` 的阻断条件
When Layer 1 补丁已可用
Then Layer 1 不会自行放行 live
And 它只能作为既有门禁通过后的执行增强能力

### 场景 5：Worker 盲区被显式保留

Given reviewer 检查本 FR 对 Layer 1 完成度的描述
When 对照 `anti-detection.md` 中的 Worker 盲区说明
Then 能明确看到 Worker 指纹采集仍不在本 FR 承诺范围内
And 不会把本 FR 表述成完整 JS 指纹闭环

## 异常与边界场景

1. profile 缺少 `audioNoiseSeed`、`battery` 或硬件字段：不得静默生成临时随机值继续 live。
2. `required_patches` 中任一补丁未加载：必须返回结构化原因，并由上层按既有门禁/审计链路处理。
3. profile 绑定环境与当前环境不一致：必须标记为一致性失效，不得继续宣称稳定指纹。
4. 只实现 P0 补丁但未实现 P1/P2：允许分阶段交付，但实现 PR 必须明确范围，且不能宣称 #235 全量完成。
5. Worker 线程暴露真实值：属于已知硬边界，不得在验收中伪装为本 FR 失败或遗漏。
6. 新增字段超出最小 profile 元数据边界，例如行为人格、健康评分、长期冷却：视为范围漂移。

## 验收标准

1. FR-0012 套件完整，至少包含 `spec.md`、`plan.md`、`TODO.md`、`research.md`、`risks.md`、`data-model.md` 与非空 `contracts/`。
2. Layer 1 的正式范围、优先级切片、非目标与 Worker 盲区已冻结，后续实现不再依赖手工从架构文档捞需求。
3. `fingerprint_profile_bundle` 与 `fingerprint_patch_manifest` 的稳定机器边界已冻结，并明确哪些字段属于稳定契约、哪些只是实现细节。
4. Profile 与运行环境强绑定约束已冻结，并给出失配时的正式处理方向。
5. FR-0012 已明确继承 `FR-0010/0011` 的门禁、审批、审计、状态机前置，而不是并行重定义。
6. 本 PR 仅冻结规约，不混入任何实现代码。

## 依赖与前置条件

- GitHub 事项：
  - `#427` Phase 2
  - `#265` Canonical FR issue: FR-0012
  - `#235` Owning Work Item: Layer 1 scope
- 上游 FR：
  - `FR-0010-xhs-risk-gates-hardening`
  - `FR-0011-xhs-min-anti-detection-execution`
- 架构依据：
  - `vision.md`
  - `docs/dev/roadmap.md`
  - `docs/dev/architecture/anti-detection.md`
  - `docs/dev/architecture/system-design/account.md`
  - `docs/dev/architecture/system-design/execution.md`
