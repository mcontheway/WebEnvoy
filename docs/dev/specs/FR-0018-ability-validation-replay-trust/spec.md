# FR-0018 能力最小验证、重放与可信判断

## 背景

Phase 2 的目标不是“把一次成功路径存下来就结束”，而是让用户知道这条能力现在是否仍然可用、失败时属于哪类问题、以及至少能做一次最小重放。`#155` 正在承接这一主线，但当前仓库还没有一套正式冻结的验证、重放与可信判断对象。

`FR-0017` 将解决“能力如何被描述和保存”，而本 FR 要解决的是“能力保存后如何被再次验证和判断当前可信度”。如果继续缺少这层正式规约，后续实现很容易把：

- 运行成功/失败日志
- 单次调试结果
- 长期健康判断
- 回放与再运行入口

混成一团，无法形成稳定的用户心智和统一实现。

因此，本 FR 作为 `#155` 的正式规约入口，负责冻结最小验证、最小重放与最小可信判断的对象边界，并为后续实现 PR 提供 implementation-ready 输入。

## 目标

1. 冻结能力最小验证请求、最小重放请求与最小可信判断结果对象。
2. 定义能力最近一次验证结果、失败大类与用户可读健康状态的最小边界。
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

- 本 FR 归属 `#368`，承接 `#155` 的最小验证、重放与可信判断主线。
- 本 FR 必须显式继承以下既有对象，而不是并行重定义：
  - `FR-0017` 的 `candidate_ability_descriptor`
  - `FR-0004` 的最小诊断与结构化错误边界
  - `FR-0006` 的运行证据与最小持久化边界
- 本 FR 只冻结最小验证与可信判断，不承担版本治理、导入/安装或自动修复。

### 2. 最小验证请求对象

- 必须冻结稳定的 `ability_validation_request` 对象，至少包含：
  - `ability_ref`
  - `validation_mode`
  - `input_source`
  - `profile_ref`
  - `expected_capability_kind`
- `validation_mode` 在本 FR 中至少支持：
  - `smoke_validation`
  - `replay_validation`
- 必须明确：
  - `smoke_validation` 用于证明能力至少还能走通最小路径
  - `replay_validation` 用于重放上一次成功边界或显式指定的最小输入

### 3. 最小重放对象

- 必须冻结 `ability_replay_request` 的最小边界，至少包含：
  - `ability_ref`
  - `replay_source`
  - `replay_input_ref`
  - `replay_reason`
- `replay_source` 至少支持：
  - `last_success_input`
  - `explicit_input_snapshot`
- 必须明确：
  - 重放是“已保存能力的再运行入口”
  - 不等于重新训练、重新学习或自动修复

### 4. 最小可信判断对象

- 必须冻结 `ability_health_view` 的最小状态集合，至少包含：
  - `unknown`
  - `verified`
  - `degraded`
  - `broken`
  - `stale`
- 每个状态必须具备可直接面向用户的最小解释边界：
  - 是否最近一次验证通过
  - 最近一次失败属于哪类大问题
  - 是否需要重新验证或人工修复
- 最小判定标准：
  - `unknown`：尚不存在任何完成态 latest 记录
  - `verified`：已有 mode latest 记录全部为 `verified`，且不存在分叉
  - `degraded`：至少存在一个 mode latest 记录，但 smoke / replay 结果分叉，或成功/失败并存，能力仍保留有限可用性
  - `broken`：已有 mode latest 记录全部为 `broken`，或唯一 latest 记录为 `broken`
  - `stale`：已有 mode latest 记录全部为 `stale`，且当前没有新的 verified/broken 结果

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

- 每个能力必须能引用“按验证模式分开保存的最近一次验证结果”，每条 mode latest 至少包含：
  - `validation_mode`
  - `validated_at`
  - `result_state`
  - `failure_class`
  - `run_id`
  - `artifact_refs`
- 每个能力还必须提供一个顶层 `ability_health_view` 聚合视图，至少包含：
  - `ability_ref`
  - `profile_ref`
  - `health_state`
  - `latest_validations`
  - `divergence_reason`
- 本 FR 必须明确：
  - `ability_validation_request.profile_ref` 必须存在，验证结果与健康视图按 `ability_ref + profile_ref` 维度隔离
  - 结果对象可以引用运行证据，但不重建第二套运行真相源
  - 若缺少 `validated_at`、`run_id` 或 `artifact_refs`，不得声称“最近一次验证已成立”
  - `failure_class` 在 mode `result_state=broken` 场景必须存在；在 mode `result_state=verified` 场景必须为空；在 mode `result_state=stale` 场景可选但需与状态解释一致
  - `artifact_refs` 的正式 truth source 是 `run_id` 对应验证运行的 run-scoped 证据载体；FR-0018 只保存引用，不另建 artifact 主数据
  - `ability_health_view` 是每个 `ability_ref + profile_ref` 的唯一聚合健康视图；消费者必须读取该视图判断顶层 `health_state`
  - `latest_validations` 按 `validation_mode` 最多各保留一条 latest 记录；FR-0006 只作为输入证据层，不负责表达 smoke/replay 分叉

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
And 该结果只会写入本次 `profile_ref` 对应的聚合健康视图

### 场景 2：最近一次验证结果可被用户理解

Given 某个能力最近一次验证失败
When 用户查看能力当前状态
Then 可以看到 `health_state`
And 可以看到最小失败大类
And 可以看到 `validated_at`、`run_id` 与 `artifact_refs`
And 不需要直接阅读原始运行日志才能知道大概问题

### 场景 3：smoke 与 replay 分叉时不会被压扁成单一结果

Given 同一个能力最近一次 `smoke_validation` 成功而 `replay_validation` 失败
When 用户查看能力当前状态
Then 顶层 `health_state` 必须是 `degraded`
And `latest_validations` 中必须同时保留 smoke 与 replay 各自的 latest 记录
And `divergence_reason` 必须解释当前是 smoke/replay 分叉
### 场景 4：最小重放不是自动修复

Given 某个能力需要再次运行
When 用户触发 `replay_validation`
Then 系统只会基于已保存的能力与最小输入快照重放
And 不会在同一对象里暗含自动修复或重新学习

### 场景 5：验证结果继续引用运行证据

Given 某次验证已经完成
When reviewer 检查结果对象
Then 能看到 `run_id` 与 `artifact_refs`
And 不会创建第二套运行真相源

### 场景 6：L2 样本也能进入同一验证链路

Given 后续已有一个来自 L2 首次可用的候选能力
When 该能力进入验证链路
Then 会复用与 L3 相同的验证/重放/可信判断对象
And 不会因为来源是 L2 而拆出第二套健康状态模型

## 异常与边界场景

1. 验证结果缺少 `validated_at`、`run_id` 或 `artifact_refs`：不得宣称“最近一次验证已成立”。
2. 同一个 `ability_ref` 在不同 `profile_ref` 下共用一条健康视图：视为跨 profile 污染。
3. 失败大类被写成低层错误码镜像：视为边界漂移。
4. 把 `verified` 误当成“可交付/可分享”：视为越界到 Phase 3/5。
5. 重放对象携带自动修复、自动调参与重新学习语义：视为超出本 FR 范围。
6. 能力尚未进入 `FR-0017` 的候选能力描述，却直接进入验证链路：视为流程违规。

## 验收标准

1. FR-0018 套件完整，至少包含 `spec.md`、`plan.md`、`TODO.md`、`contracts/`、`data-model.md`、`research.md`、`risks.md`。
2. `ability_validation_request`、`ability_replay_request`、`ability_health_view` 的稳定边界已冻结。
3. 最近一次验证结果、失败大类与运行证据引用关系已冻结。
4. 本 FR 已明确继承 `FR-0017`、`FR-0004`、`FR-0006`，而不是并行重定义。
5. 文档明确不承诺版本治理、导入/安装、自动修复或分享网络。
6. 本 PR 只冻结规约，不混入实现代码。

## 依赖与前置条件

- GitHub 事项：
  - `#368`
  - `#155`
- 上游 FR：
  - `FR-0017-unified-candidate-ability-shell`
  - `FR-0004-runtime-observability`
  - `FR-0006-runtime-sqlite-store`
- 相关但不由本 FR 关闭的事项：
  - `#157`
  - `#153`
  - 后续导入/交付类事项
