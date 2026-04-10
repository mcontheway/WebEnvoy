# FR-0018 能力最小验证、重放与可信判断

## 背景

Phase 2 的目标不是“把一次成功路径存下来就结束”，而是让用户知道这条能力现在是否仍然可用、失败时属于哪类问题、以及至少能做一次最小重放。当前 FR-0018 owning Work Item 正在承接这一闭环，但当前仓库还没有一套正式冻结的验证、重放与可信判断对象。

`FR-0017` 将解决“能力如何被描述和保存”，而本 FR 要解决的是“能力保存后如何被再次验证和判断当前可信度”。如果继续缺少这层正式规约，后续实现很容易把：

- 运行成功/失败日志
- 单次调试结果
- 长期健康判断
- 回放与再运行入口

混成一团，无法形成稳定的用户心智和统一实现。

因此，本 FR 作为 FR-0018 owning Work Item 的正式规约入口，负责冻结最小验证、最小重放与最小可信判断的对象边界，并为后续实现 PR 提供 implementation-ready 输入。

## 目标

1. 冻结能力最小验证请求、最小重放请求与最小可信判断结果对象。
2. 定义能力最近一次验证结果、失败大类、用户可读健康状态与验证覆盖度的最小边界。
3. 明确候选能力、验证结果和运行证据之间的关系，避免后续实现各自拼装。
4. 明确 `FR-0018` 与 `FR-0017`、`FR-0004`、`FR-0006` 的继承边界。
5. 为后续“保存 -> 验证 -> 重放 -> 判断是否可信”的最小闭环提供正式输入。

## 非目标

- 不实现最终导入/安装与版本治理。
- 不实现自动修复、自动重新学习或自愈。
- 不把验证结果直接升级成分享/交付可信声明。
- 不在本 FR 内定义完整历史版本矩阵。
- 不重定义 `FR-0017` 的候选能力描述对象。
- 不在本 FR 内混入实现代码。

## 功能需求

### 1. Phase 2 定位与继承边界

- 本 FR 归属 Phase 2 主树中的 `FR-0018` 节点，对应 owning Work Item 为最小验证、重放与可信判断闭环，承接本 FR 的实现落点。
- 本 FR 必须显式继承以下既有对象，而不是并行重定义：
  - `FR-0017` 的 `candidate_ability_descriptor`
  - `FR-0004` 的最小诊断与结构化错误边界
  - `FR-0006` 的运行证据与最小持久化边界
- 本 FR 只冻结最小验证与可信判断，不承担版本治理、导入/安装或自动修复。
- 当前 formal trust domain 只覆盖 `candidate_ability_descriptor.ability_kind=read|download`；`write` descriptor 当前停留在 FR-0017 的 capture evidence 域，不在本 FR 的普通 health/trust 视图内。

### 2. 最小验证请求对象

- 必须冻结稳定的 `ability_validation_request` 对象，至少包含：
  - `ability_ref`
  - `validation_mode`
  - `profile_ref`
  - `requested_execution_layer`
  - `expected_capability_kind`
  - `smoke_input`
- `validation_mode` 在本 FR 中至少支持：
  - `smoke_validation`
- 必须明确：
  - `smoke_validation` 用于证明能力至少还能走通最小路径
  - `validation_mode=smoke_validation` 时，请求必须显式给出满足 `input_contract_ref` 的 `smoke_input`
  - `validation_mode=smoke_validation` 在当前 formal baseline 下只允许用于 `expected_capability_kind=read|download`；`ability_kind=write` 不得通过该请求面被 rerun、写入 latest 或标记为 `healthy`
  - `ability_ref` 在本 FR 中必须直接等于 `FR-0017.candidate_ability_descriptor.ability_id`
  - `requested_execution_layer` 必须显式给出，且必须落在目标 `candidate_ability_descriptor.execution_layer_support` 之内；验证层不得在未指定执行层时宣称“当前可用”
  - 当前 formal baseline 下，`ability_validation_request` 不得跨 layer 自动降级、升级或 fallback；若 `requested_execution_layer` 无法执行，结果必须在该 layer 视图内失败或失效，不得静默改走其他 execution layer
  - `expected_capability_kind` 如保留在请求面，必须直接等于该 descriptor 的 `ability_kind`；若不一致，验证层必须按结构化输入错误拒绝请求
  - `smoke_validation` 不要求预先存在 replay snapshot；同一 `ability_ref + profile_ref + requested_execution_layer` 下首次成功的 `smoke_validation` 可以产出首个 `ReplayInputSnapshotRef`
  - 若目标 `candidate_ability_descriptor.ability_kind=write`，验证层必须在请求阶段拒绝 `smoke_validation`；如未来要支持状态变更能力的最小验证，必须先在独立 FR 中冻结显式 `requested_execution_mode`、`effective_execution_mode` 与 gate / audit 元数据
  - `ability_validation_request` 是唯一的 smoke 请求契约；replay 不得复用或平行复制到该对象中

### 3. 最小重放对象

- 必须冻结 `ability_replay_request` 的最小边界，至少包含：
  - `ability_ref`
  - `profile_ref`
  - `requested_execution_layer`
  - `expected_capability_kind`
  - `replay_source`
  - `replay_reason`
  - `replay_input_ref`（仅在 `replay_source=explicit_input_snapshot` 时出现）
- `replay_source` 至少支持：
  - `last_success_input`
  - `explicit_input_snapshot`
- 必须明确：
  - 重放是“已保存能力的再运行入口”
  - 不等于重新训练、重新学习或自动修复
  - `ability_replay_request` 是唯一的 replay 请求契约；`latest_validations.validation_mode=replay_validation` 只能由 replay 请求结果产出
  - 任何 replay 持久化 / 投影对象都只能作为 `ability_replay_request` 的存储投影，不得额外冻结第二套 replay 请求面或 `ready` 一类独立状态
  - `requested_execution_layer` 必须显式给出，且必须落在目标 `candidate_ability_descriptor.execution_layer_support` 之内；重放资格必须按 execution layer 单独判断
  - 当前 formal baseline 下，`ability_replay_request` 不得跨 layer 自动降级、升级或 fallback；若 `requested_execution_layer` 无法执行，结果必须在该 layer 视图内失败或失效，不得静默改走其他 execution layer
  - replay 必须显式落在目标 `profile_ref` 上，不得跨 profile 复用 `last_success_input`
  - `expected_capability_kind` 在当前 formal baseline 下只允许 `read|download`，并且必须直接等于目标 `candidate_ability_descriptor.ability_kind`
  - 当 `replay_source=explicit_input_snapshot` 时，请求必须显式给出 `replay_input_ref`
  - `replay_source=last_success_input` 时，正式 truth source 是同一 `ability_ref + profile_ref + requested_execution_layer` 视图内的 `last_success_input_ref`
- 必须冻结 `replay_input_ref` 背后的最小输入快照引用对象，至少包含：
  - `snapshot_ref`
  - `ability_ref`
  - `profile_ref`
  - `execution_layer`
  - `captured_input_contract_ref`
  - `source_run_id`
  - `payload_locator`
  - `captured_at`
- 必须明确：
  - `replay_input_ref` 只允许出现在 `replay_source=explicit_input_snapshot` 分支，且只能引用已存在的输入快照引用对象
  - `last_success_input_ref` 与 `replay_input_ref` 都必须指向同一套输入快照引用对象，而不是带外临时值
  - 输入快照引用对象必须记录自己的 `execution_layer` 与 `captured_input_contract_ref`；当前请求的 `requested_execution_layer` 或当前 descriptor 的 `input_contract_ref` 任一不匹配时，该快照不得继续复用为可执行 replay 输入
  - `payload_locator` 是 replay snapshot 的正式可解析 payload 边界；重放层必须通过它重新取回已保存输入，不得仅靠 `source_run_id`、artifact refs 或带外扫描临时反推
  - `payload_locator` 必须是 FR-0018 replay-store owned 的稳定 locator，而不是临时文件路径、进程内句柄或 run-scoped artifact URL；消费者只能通过该 replay-store resolver 把它解析为唯一的 captured input payload
  - `payload_locator` 的有效期必须至少与其所属 `snapshot_ref` 一致；只要该 snapshot 仍可被 `replay_input_ref` 或 `last_success_input_ref` 引用，locator 就不得被提前删除、覆写或回收
  - `payload_locator` 的清理只能发生在所属 `snapshot_ref` 被正式退休，且不再被任何当前 `replay_input_ref` / `last_success_input_ref` 引用之后；在此之前，实现不得把 cleanup 留给临时目录生命周期或 run artifact 保留策略碰运气
  - 对新进入 `FR-0018` 的能力，若 `FR-0017.candidate_ability_descriptor.seed_replay_input_ref` 已存在，则它必须作为首个输入快照引用对象，并且只允许回写为该 `capture_profile + capture_origin` 对应执行层视图的初始 `last_success_input_ref`
  - 非 `capture_profile` 的其他 profile 视图，或 descriptor 其他受支持 execution layer 视图，都不得继承这条初始 seed；它们只能在各自作用域下首次成功验证/重放后刷新自己的 `last_success_input_ref`
  - `candidate_ability_descriptor.ability_kind=write` 时，当前 formal baseline 不允许把 `seed_replay_input_ref`、`last_success_input_ref`、`replay_source=last_success_input` 或 `replay_source=explicit_input_snapshot` 冻结为可执行 replay 入口；显式 snapshot 也只能作为 capture evidence 保留，不能绕过当前缺失的 `requested_execution_mode`、`effective_execution_mode` 与 gate / audit 元数据
- 若上游未提供 `seed_replay_input_ref`，则同一 `ability_ref + profile_ref + requested_execution_layer` 下首次成功的 `smoke_validation.smoke_input` 必须物化为首个 `ReplayInputSnapshotRef`；仅当 `candidate_ability_descriptor.ability_kind` 属于非状态变更能力时，才允许继续建立同 layer 视图的 `last_success_input_ref`
- 成功 replay 只允许在同一 `ability_ref + profile_ref + requested_execution_layer` 已存在合法 replay source 之后刷新后续 `ReplayInputSnapshotRef`；它不得承担无 seed 场景下的首个 snapshot bootstrap

### 4. 最小可信判断对象

- 必须冻结 `ability_health_view` 的两个正式状态轴：
  - 用户面 `health_state`
  - 验证覆盖度 `validation_coverage_state`
- `health_state` 的最小状态集合固定为：
  - `unknown`
  - `healthy`
  - `degraded`
  - `broken`
  - `stale`
- `validation_coverage_state` 的最小状态集合固定为：
  - `none`
  - `smoke_only`
  - `replay_only`
  - `smoke_plus_replay`
  - `divergent`
- “当前 latest” 继续沿用现有 stale 规则：只有同时满足 7 天 freshness window 且 `baseline_descriptor` 与当前 descriptor/view 基线一致的 mode latest，才可被视为 current latest；其余 latest 必须失效为 `stale`。
- `baseline_descriptor.execution_layer_support` 仍必须作为证据快照被记录，但在当前 layer-scoped health 模型里，current/stale 判定不得因为无关支持层的新增或删除就让既有 layer 视图失效；只有当当前 `execution_layer_support` 已不再覆盖该条 latest 的 `validated_execution_layer` 时，才允许据此将其判为 `stale`。
- `ability_health_view`、`latest_validations` 与 replay eligibility 必须按 `ability_ref + profile_ref + execution_layer` 作用域隔离；不同执行层不得共享同一条 current healthy evidence 或 `last_success_input_ref`。
- 顶层 `health_state` 必须按固定顺序判定，分支互斥且穷尽：
  1. `unknown`：在给定 `ability_ref + profile_ref + execution_layer` 的受支持视图内，不存在任何 mode latest 记录
  2. `stale`：存在 mode latest，且全部现存 latest 都是 `stale`
  3. `healthy`：至少存在一条 current latest 为 `verified`，且不存在任何 current latest 为 `broken`
  4. `degraded`：同时存在 current `verified` latest 与 current `broken` latest
  5. `broken`：不存在任何 current `verified` latest，但至少存在一条 current latest 为 `broken`
- `validation_coverage_state` 必须按固定顺序判定，分支互斥且穷尽：
  1. `none`：不存在任何 current latest
  2. `smoke_only`：只有 `smoke_validation` 的 current latest 为 `verified`
  3. `replay_only`：只有 `replay_validation` 的 current latest 为 `verified`
  4. `smoke_plus_replay`：`smoke_validation` 与 `replay_validation` 的 current latest 都存在，且都为 `verified`
  5. `divergent`：除以上情况外的其余所有 current latest 组合，包括任一 current latest 为 `broken`，或 smoke/replay current latest 结果不一致
- `smoke_validation` 成功可以被下游消费为“当前仍可用”的最小信号；当前 formal baseline 下，这一规则只适用于非状态变更能力。当只有 smoke current latest 为 `verified` 时，顶层必须呈现 `health_state=healthy`，同时把覆盖度落在 `validation_coverage_state=smoke_only`。
- `divergence_reason` 不再承载“缺少模式证据”；它只允许表达真实冲突，当前枚举必须收敛为 `smoke_replay_mismatch`。

### 5. 最小失败分类

- 必须冻结用户可读的失败大类，至少覆盖：
  - `page_changed`
  - `auth_or_session_required`
  - `gate_blocked`
  - `environment_mismatch`
  - `runtime_error`
- 必须明确：
  - 失败大类是“最小可信判断”的稳定输出
  - 不是完整低层错误码替代品

### 6. 最近一次验证结果与证据引用

- 每个 `ability_ref + profile_ref + execution_layer` 组合必须能引用“按验证模式分开保存的最近一次验证结果”，每条 mode latest 至少包含：
  - `validation_mode`
  - `validated_at`
  - `result_state`
  - `failure_class`
  - `run_id`
  - `validated_execution_layer`
  - `baseline_descriptor`
- 每条 mode latest 可在上游 evidence carrier 已冻结时补充：
  - `artifact_refs`
- 每个 `ability_ref + profile_ref + execution_layer` 组合还必须提供一个顶层 `ability_health_view` 聚合视图，至少包含：
  - `ability_ref`
  - `profile_ref`
  - `execution_layer`
  - `health_state`
  - `validation_coverage_state`
  - `latest_validations`
  - `last_success_input_ref`
  - `divergence_reason`
- 本 FR 必须明确：
  - `ability_validation_request.profile_ref` 与 `ability_validation_request.requested_execution_layer` 都必须存在，验证结果与健康视图按 `ability_ref + profile_ref + execution_layer` 维度隔离
  - `ability_ref` 在本 FR 的请求、输入快照引用和健康视图里都必须直接等于 `FR-0017.candidate_ability_descriptor.ability_id`
  - `ability_validation_request` 只负责 `smoke_validation`；任何 replay 入口都必须走 `ability_replay_request`，不得冻结第二套 replay 请求面
  - `expected_capability_kind` 只允许作为对 `candidate_ability_descriptor.ability_kind` 的显式断言；不一致时不得写入任何 latest 结果
  - `candidate_ability_descriptor.ability_kind=write` 时，不得生成或消费无门禁 `smoke_validation` latest；当前 formal baseline 下，状态变更能力不得通过普通 smoke 路径被 rerun、标记为 `healthy`，也不得物化普通 `ability_health_view`
  - 结果对象可以引用运行证据，但不重建第二套运行真相源
  - 若缺少 `validated_at` 或 `run_id`，不得声称“最近一次验证已成立”
  - `last_success_input_ref` 是 `replay_source=last_success_input` 的正式 truth source；它只能由同一 `ability_ref + profile_ref + execution_layer` 下最近一次成功验证/重放刷新
  - 若 `last_success_input_ref` 指向的 snapshot 的 `captured_input_contract_ref` 与当前 descriptor 的 `input_contract_ref` 不一致，则该 truth source 必须立即失效，不得继续被 `replay_source=last_success_input` 复用
  - 对新进入 `FR-0018` 的能力，初始 `last_success_input_ref` 可以来自上游提供的 `candidate_ability_descriptor.seed_replay_input_ref`，也可以来自同一 `ability_ref + profile_ref + execution_layer` 下首次成功的 `smoke_validation` 输入；不得靠带外默认值、人工口头输入、跨 profile 或跨 execution layer 复制补齐
  - `candidate_ability_descriptor.ability_kind=write` 时，`seed_replay_input_ref` 与输入快照引用对象最多只承担 capture evidence 角色，不得自动初始化 `last_success_input_ref`，也不得形成无门禁 replay 入口
  - `replay_input_ref` 只能解析到同一 `ability_ref + profile_ref + execution_layer` 下的输入快照引用对象；引用不存在、owner 不符、profile 不符、execution layer 不符，或 `captured_input_contract_ref` 与当前 descriptor 的 `input_contract_ref` 不一致时，请求必须视为无效并要求 fresh capture
  - `failure_class` 在 mode `result_state=broken` 场景必须存在；在 mode `result_state=verified` 场景必须为空；在 mode `result_state=stale` 场景可选但需与状态解释一致
  - `artifact_refs` 只作为 run-scoped 补充 evidence refs；在上游等价 evidence carrier 正式冻结前，不得把它设为 latest 记录成立的强制前置
  - `validated_execution_layer` 必须记录该次验证实际走通的执行层；它来自实际 invocation layer，而不是 descriptor 的支持层集合，并且必须直接等于所在 `ability_health_view.execution_layer`
  - 当前 formal baseline 下，`validated_execution_layer` 还必须直接等于触发本次验证或重放的 `requested_execution_layer`；FR-0018 当前不允许通过静默跨 layer fallback 把结果写到其他 execution layer
  - `baseline_descriptor` 必须至少冻结 `entrypoint`、`input_contract_ref`、`output_contract_ref`、`error_contract_ref`、`profile_ref`、`execution_layer_support`；其中 `entrypoint` / contract refs / `profile_ref` 仍属于 current/stale 的正式基线，而 `execution_layer_support` 在 layer-scoped 视图里只承担证据快照与“当前是否仍覆盖 `validated_execution_layer`”的判断输入
  - 当需要判断当前 `execution_layer_support` 是否仍覆盖 `validated_execution_layer` 时，比较必须按归一化集合语义完成，而不是按数组顺序比较
  - 若当前 `candidate_ability_descriptor.execution_layer_support` 不再覆盖该条 latest 的 `validated_execution_layer`，该条 latest 结果也必须失效为 `stale`
  - 若当前 `candidate_ability_descriptor.execution_layer_support` 只是新增或删除了与该视图 `execution_layer` 无关的其他支持层，而 `validated_execution_layer` 仍被覆盖，则该条 latest 不得仅因支持层集合变化而失效为 `stale`
  - 每条 latest 只证明自己的 `validated_execution_layer` 曾经被验证成功或失败；不得把同一条 latest 自动外推为 descriptor 其他支持层也已被验证
  - `ability_health_view` 是每个 `ability_ref + profile_ref + execution_layer` 的唯一聚合健康视图；消费者必须读取目标 layer 对应的视图判断顶层 `health_state` 与 `validation_coverage_state`
  - 在同一 `ability_ref + profile_ref + execution_layer` 视图内，`latest_validations` 按 `validation_mode` 最多各保留一条 latest 记录；FR-0006 只作为输入证据层，不负责表达 smoke/replay 分叉

### 7. 与候选能力和 L2 首次可用的衔接

- 本 FR 必须明确：
  - `FR-0017` 先定义能力，`FR-0018` 再定义验证与可信判断
  - `FR-0019` 的首次可用样本只有先进入 `FR-0017` 的候选能力描述，才能继续被 `FR-0018` 验证
- 本 FR 不得让验证对象绕开候选能力描述，直接挂到一次性运行日志上。

## GWT 验收场景

### 场景 1：已保存能力可以发起最小验证

Given 某个候选能力已存在
When 用户请求一次 `smoke_validation`
Then 系统能构造 `ability_validation_request`
And 验证结果会落回稳定的 `ability_health_view`
And 该结果只会写入本次 `profile_ref + requested_execution_layer` 对应的聚合健康视图
And `ability_ref` 会直接复用该候选能力的 `ability_id`
And 在缺少上游 `seed_replay_input_ref` 时，首次 `smoke_validation` 仍可通过显式 `smoke_input` 启动
And 若该 `requested_execution_layer` 无法执行，则请求必须在该 layer 视图内失败或失效，不得静默改走其他 execution layer

### 场景 2：最近一次验证结果可被用户理解

Given 某个能力最近一次验证失败
When 用户查看能力当前状态
Then 可以看到 `health_state`
And 可以看到 `validation_coverage_state`
And 可以看到最小失败大类
And 至少可以看到 `validated_at` 与 `run_id`
And 在存在 run-scoped evidence refs 时可以看到 `artifact_refs`
And 不需要直接阅读原始运行日志才能知道大概问题

### 场景 3：smoke 与 replay 分叉时不会被压扁成单一结果

Given 同一个能力在同一个 `profile_ref + execution_layer` 视图下最近一次 `smoke_validation` 成功而 `replay_validation` 失败
When 用户查看能力当前状态
Then 顶层 `health_state` 必须是 `degraded`
And `validation_coverage_state` 必须是 `divergent`
And `latest_validations` 中必须同时保留 smoke 与 replay 各自的 latest 记录
And `divergence_reason` 必须解释当前是 smoke/replay 分叉

### 场景 4：只有 smoke 成功时仍会呈现当前可用

Given 同一个 `ability_kind=read|download` 的能力在同一个 `profile_ref + execution_layer` 视图下已经成功完成一次 `smoke_validation`
And 当前还没有任何 `replay_validation` current latest
When 用户查看能力当前状态
Then 顶层 `health_state` 必须是 `healthy`
And `validation_coverage_state` 必须是 `smoke_only`
And 该次 smoke 成功仍可作为最小可用证据并建立 `last_success_input_ref`

### 场景 5：状态变更能力不会通过无门禁 smoke_validation 呈现 healthy

Given 某个候选能力的 `ability_kind=write`
When 用户尝试发起一次 `smoke_validation`
Then 验证层必须在请求阶段拒绝该组合
And 不得写入 `smoke_validation` latest
And 不得把该能力标记为 `healthy`
And 不得为该能力物化普通 `ability_health_view` 并压成 `health_state=unknown`
And 若未来要支持状态变更能力的最小验证，必须先冻结显式 `requested_execution_mode`、`effective_execution_mode` 与 gate / audit 元数据

### 场景 6：只有 replay 成功时也能呈现当前可用

Given 同一个 `ability_kind=read|download` 的能力在同一个 `profile_ref + execution_layer` 视图下已经成功完成一次 `smoke_validation`
And 当前 `smoke_validation` latest 不存在或已经 `stale`
And 已存在一个 current `replay_validation` latest 为 `verified`
When 用户查看能力当前状态
Then 顶层 `health_state` 必须是 `healthy`
And `validation_coverage_state` 必须是 `replay_only`

### 场景 7：最小重放不是自动修复

Given 某个能力需要再次运行
When 用户提交一次 `ability_replay_request`
Then 系统只会基于已保存的能力与最小输入快照重放
And 当输入来源是 `explicit_input_snapshot` 时会显式引用 `replay_input_ref`
And 当输入来源是 `last_success_input` 时会读取当前 `last_success_input_ref`
And 不会在同一对象里暗含自动修复或重新学习
And 若该 `requested_execution_layer` 无法执行，则请求必须在该 layer 视图内失败或失效，不得静默改走其他 execution layer

### 场景 8：状态变更能力不会通过无门禁 replay seed 被重放

Given 某个候选能力的 `ability_kind=write`
And 该能力保存了 `seed_replay_input_ref` 或其他输入快照引用
When 用户尝试通过 `replay_source=last_success_input` 或 `replay_source=explicit_input_snapshot` 重新执行该能力
Then 当前 formal baseline 下不得把该请求视为可执行 replay
And 这些输入快照最多只能作为 capture evidence 保留
And 若未来要允许 write replay，必须先补齐专门 gate 元数据或 dry-run 语义

### 场景 9：验证结果继续引用运行证据

Given 某次验证已经完成
When reviewer 检查结果对象
Then 能看到 `validated_at` 与 `run_id`
And 在存在 run-scoped evidence refs 时能看到 `artifact_refs`
And 不会创建第二套运行真相源

### 场景 10：只有 stale latest 时会退回 stale / none

Given 同一个能力在同一个 `profile_ref + execution_layer` 视图下存在历史 latest
And 这些 latest 全部因 freshness window 或 `baseline_descriptor` 漂移而失效为 `stale`
When 用户查看能力当前状态
Then 顶层 `health_state` 必须是 `stale`
And `validation_coverage_state` 必须是 `none`

### 场景 11：执行层支持变化会使旧验证失效

Given 某个能力在同一个 `profile_ref + execution_layer` 视图下已有一条 `validated_execution_layer=L2` 的 current latest
And 当前视图的 `execution_layer=L2`
When 当前 `candidate_ability_descriptor.execution_layer_support` 发生变化
And 新的执行层支持集合已经不再覆盖 `L2`
Then 该条 latest 必须失效为 `stale`
And 不得继续被当作 current healthy evidence

### 场景 12：无关支持层新增不会使既有分层验证失效

Given 某个能力在同一个 `profile_ref + execution_layer` 视图下已有一条 `validated_execution_layer=L2` 的 current latest
And 当前 `candidate_ability_descriptor.execution_layer_support` 仍覆盖 `L2`
When 该 descriptor 只是新增了另一个无关支持层
Then 这条 `validated_execution_layer=L2` 的 latest 不得仅因支持层集合变化而失效为 `stale`
And 该 layer 视图仍可继续把它视为 current evidence

### 场景 13：输入契约变化会使旧 replay snapshot 失效

Given 某个 `ability_ref + profile_ref + execution_layer` 视图已经保存了 `last_success_input_ref`
And 它指向的 snapshot 记录了旧的 `captured_input_contract_ref`
When 当前 `candidate_ability_descriptor.input_contract_ref` 发生变化
Then 旧 snapshot 只能保留为历史 evidence
And 不得继续作为 `replay_source=last_success_input` 或 `replay_source=explicit_input_snapshot` 的可执行输入
And 当前视图中的 `last_success_input_ref` 必须视为失效或缺省
And 系统必须要求 fresh smoke/replay capture 生成绑定新 contract 的 snapshot

### 场景 14：L2 样本也能进入同一验证链路

Given 后续已有一个来自 L2 首次可用的候选能力
When 该能力进入验证链路
Then 会复用与 L3 相同的验证/重放/可信判断对象
And 不会因为来源是 L2 而拆出第二套健康状态模型

## 异常与边界场景

1. 验证结果缺少 `validated_at` 或 `run_id`：不得宣称“最近一次验证已成立”。
2. 同一个 `ability_ref` 在不同 `profile_ref` 或不同 `execution_layer` 下共用一条健康视图：视为作用域污染。
3. `replay_source=last_success_input` 时缺少 `last_success_input_ref` 真相源：不得视为可执行 replay。
4. `replay_input_ref` 无法解析到正式输入快照引用对象：不得视为可执行 replay。
5. 输入快照引用对象缺少 `payload_locator`，或该 locator 无法解析到对应 payload：不得视为可执行 replay。
6. `payload_locator` 被实现成临时文件路径、进程内句柄、run artifact URL，或其生命周期短于所属 `snapshot_ref`：视为 replay 输入解析边界未冻结。
7. 新能力进入验证链路时，既没有上游 `seed_replay_input_ref`，也没有通过首次成功 `smoke_validation` 建立首个输入快照引用对象：不得宣称该能力已具备 replay-ready 边界。
8. `stale` 判定未检查 7 天 freshness window，或未对比 `baseline_descriptor` 中的 descriptor/profile 基线，或未检查 `validated_execution_layer` 是否仍被当前 `execution_layer_support` 覆盖：视为健康状态计算未冻结。
9. 失败大类被写成低层错误码镜像：视为边界漂移。
10. `expected_capability_kind` 与 `candidate_ability_descriptor.ability_kind` 不一致时仍继续验证或写入 latest：视为共享能力面边界未冻结。
11. 只有 smoke current latest 成功、却仍把顶层 `health_state` 压成 `degraded`，或未把覆盖度标成 `smoke_only`：视为状态轴仍然混用。
12. 把 `healthy` 误当成“可交付/可分享”，或把 `validation_coverage_state` 当成顶层可用性结论：视为越界到 Phase 3/5。
13. 重放对象携带自动修复、自动调参与重新学习语义：视为超出本 FR 范围。
14. 能力尚未进入 `FR-0017` 的候选能力描述，却直接进入验证链路：视为流程违规。
15. `ability_kind=write` 的能力仍允许通过 `seed_replay_input_ref`、`last_success_input_ref` 或 `replay_input_ref` 形成无门禁 replay 入口：视为状态变更 replay 边界未冻结。
16. `ability_kind=write` 仍允许通过普通 `smoke_validation` rerun、写出 `healthy`，或被压成普通 `health_state=unknown`：视为状态变更验证门禁缺失。
17. 当前 `candidate_ability_descriptor.execution_layer_support` 已不再覆盖 `validated_execution_layer`，旧 latest 仍继续被视为 current：视为执行层变更没有进入 stale baseline。
18. 仅因为无关支持层新增或删除，就把当前 layer 视图中的 latest 判成 `stale`：视为分层健康状态被错误地绑到了整组支持层集合。
19. `last_success_input_ref` 指向的 snapshot 在 `captured_input_contract_ref` 与当前 `input_contract_ref` 不一致时仍可执行 replay：视为 replay snapshot 没有按输入契约版本失效。
20. 试图在没有上游 `seed_replay_input_ref` 的情况下，用成功 replay 充当首个 `ReplayInputSnapshotRef` 的 bootstrap：视为 replay bootstrap 依赖矛盾未收口。
21. `ability_validation_request` 或 `ability_replay_request` 在 `requested_execution_layer` 无法执行时静默改走其他 execution layer：视为 cross-layer fallback 边界未冻结。

## 验收标准

1. FR-0018 套件完整，至少包含 `spec.md`、`plan.md`、`TODO.md`、`contracts/`、`data-model.md`、`research.md`、`risks.md`。
2. `ability_validation_request`、`ability_replay_request`、`ability_health_view` 的稳定边界已冻结；当前 health/trust 视图只覆盖 `read|download`，且健康视图按 `ability_ref + profile_ref + execution_layer` 唯一隔离。
3. 最近一次验证结果、失败大类与运行证据引用关系已冻结，且 mode latest 的 `validated_at`、`run_id` 为强制字段。
4. 首个 replay 输入快照必须由可选上游 `seed_replay_input_ref` 或首次成功 `smoke_validation` 输入建立；成功 replay 只允许在已有合法 replay source 后刷新后续 snapshot；仅当 `candidate_ability_descriptor.ability_kind` 属于非状态变更能力时，才允许初始化到对应 `last_success_input_ref`，`write` 只允许作为 capture evidence 保留。
5. 当前 FR-0018 formal baseline 已明确禁止 cross-layer auto-fallback：`requested_execution_layer` 与 `validated_execution_layer` 必须一致，且结果只能写回对应 layer 视图。
6. 本 FR 已明确继承 `FR-0017`、`FR-0004`、`FR-0006`，而不是并行重定义。
7. 文档明确不承诺版本治理、导入/安装、自动修复或分享网络。
8. 本 PR 只冻结规约，不混入实现代码。

## 依赖与前置条件

- GitHub 事项：
  - `#427` Phase 2
  - `#420` Canonical FR issue: FR-0018
  - `#155` Owning Work Item
- 上游 FR：
  - `FR-0017-unified-candidate-ability-shell`
  - `FR-0004-runtime-observability`
  - `FR-0006-runtime-sqlite-store`
- 相关但不由本 FR 关闭的事项：
  - `#157` / `FR-0019`
  - `#153` / `FR-0021`
  - 后续导入/交付类事项
