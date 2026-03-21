# FR-0008 数据模型（写链路 Spike 输入）

## 模型边界

本模型只描述 FR-0008 作为侦察输入 FR 时，需要稳定交付给 `#208` 与后续写能力实现 FR 的共享结构化对象。

它不覆盖：

- FR-0001 CLI 外层输入输出壳
- FR-0002 / FR-0003 的通信与会话状态机
- 真实 `publish` / `interact` / 上传实现时的运行时 payload
- 持久化表结构或数据库 schema

## 核心实体

### 1. `EditorPathEvidence`

用途：

- 描述富文本编辑器路径的入口、焦点、输入事件链与成功/失败信号。

关键字段：

- `scenario` string NOT NULL，固定为 `rich_text_editor`
- `route_role` ENUM NOT NULL（`primary` | `fallback`）
- `path_kind` ENUM NOT NULL（`page` | `api`）
- `entry_locator` string NOT NULL
- `focus_strategy` ENUM NOT NULL（`physical_click` | `programmatic_focus` | `candidate`）
- `event_chain` ARRAY<string> NULL
- `success_signals` ARRAY<string> NOT NULL
- `failure_signals` ARRAY<string> NOT NULL
- `evidence_status` ENUM NOT NULL（`success` | `failed` | `candidate`）
- `evidence_maturity` ENUM NOT NULL（`observed_once` | `reproduced_multi_round` | `admission_ready`）
- `notes` string NULL

约束：

- `path_kind=page` 时，`focus_strategy` 与 `event_chain` 必须填写。
- `path_kind=api` 只能表示页面路径失败后的降级候选，不得等价表述为“页面输入已验证”。
- `admission_ready` 仅在多轮复现、成功/失败信号稳定且风险边界明确时允许出现。

### 2. `UploadPathEvidence`

用途：

- 描述图片上传的页面主路径、降级候选路径与上传过程信号。

关键字段：

- `scenario` string NOT NULL，固定为 `image_upload`
- `route_role` ENUM NOT NULL（`primary` | `fallback`）
- `path_kind` ENUM NOT NULL（`page` | `api`）
- `entry_type` ENUM NOT NULL（`file_input` | `dropzone` | `upload_api`）
- `file_injection` ENUM NOT NULL（`data_transfer` | `native_picker_bridge` | `api_direct` | `candidate`）
- `trigger_events` ARRAY<string> NOT NULL
- `progress_signals` ARRAY<string> NOT NULL
- `failure_signals` ARRAY<string> NOT NULL
- `evidence_status` ENUM NOT NULL（`success` | `failed` | `candidate`）
- `evidence_maturity` ENUM NOT NULL（`observed_once` | `reproduced_multi_round` | `admission_ready`）
- `notes` string NULL

约束：

- 页面失败样本必须保留，不得用成功路径覆盖。
- `entry_type=upload_api` 默认只允许作为 `fallback` 或 `candidate` 输入。
- `admission_ready` 只允许用于后续实现准备采用的真实主路径证据。

### 3. `MinimalActionCandidate`

用途：

- 向 `#208` 输出“可供正式验证选择的最小页面交互动作候选”。

关键字段：

- `action_id` string NOT NULL
- `goal` string NOT NULL
- `preconditions` ARRAY<string> NOT NULL
- `steps` ARRAY<string> NOT NULL
- `success_signals` ARRAY<string> NOT NULL
- `failure_signals` ARRAY<string> NOT NULL
- `minimum_replay` ARRAY<string> NOT NULL
- `handoff_status` ENUM NOT NULL（`candidate_input` | `recommended_input` | `blocked`）
- `evidence_maturity` ENUM NOT NULL（`observed_once` | `reproduced_multi_round` | `admission_ready`）
- `notes` string NULL

约束：

- `recommended_input` 不等于 `#208` 已完成，只代表当前更适合作为其正式验证候选。
- 依赖多步骤发布、上传后提交或不可逆写入的动作，默认不得标为 `recommended_input`。
- `#208` 只允许消费此对象中明确输出的候选，不得自行扩张为完整写链路范围。

### 4. `GateStatus`

用途：

- 分别记录 FR-0008 对 fallback viability 与 implementation readiness 的门禁结论。

关键字段：

- `fallback_viability` ENUM NOT NULL（`PASS` | `BLOCKED`）
- `implementation_readiness` ENUM NOT NULL（`PASS` | `BLOCKED`）
- `rationale.fallback` string NOT NULL
- `rationale.implementation` string NOT NULL

约束：

- `fallback_viability=PASS` 仅在连续性输入已被第一手证据验证时允许出现。
- 若只有规约定义、没有 live 证据，`fallback_viability` 必须保持 `BLOCKED`。
- `implementation_readiness` 不得被 fallback-only 证据推动为 `PASS`。

## 生命周期

1. FR-0008 在规约阶段先冻结上述对象的字段语义与消费边界。
2. 后续 live 侦察把页面第一手证据映射到这些对象，但不会在本 FR 中直接升级为 Phase 1 blocker 结论。
3. `#208` 只消费 `MinimalActionCandidate` 中的候选动作，用于选择正式验证对象。
4. 后续写能力实现 FR 复用 `EditorPathEvidence`、`UploadPathEvidence` 与 `GateStatus`，但需根据 live 证据重新判断是否达到实现准入。

## 与其他 FR 的模型关系

- 与 `FR-0004`：复用最小观察与失败归类方向，但不重定义其诊断结构。
- 与 `FR-0007`：共享“结构化对象必须稳定、可被后续 FR 消费”的建模原则，但本 FR 不产出运行时能力壳。
- 与 `#208`：`MinimalActionCandidate` 是它唯一允许直接消费的 handoff 输入。
- 与后续小红书写能力实现 FR：本模型提供侦察输入边界，不直接代表实现 payload 已冻结。
