# FR-0017 统一候选能力描述与能力壳

## 背景

`FR-0007` 已冻结 Phase 1 的最小能力壳：能力入口、输入、输出与错误的最小统一骨架已经存在。但 Phase 2 / Sprint 4 的目标不再只是“命令能跑”，而是把一次成功路径留下来，让它可以被重复调用、验证、重放，并能同时承载现有 L3 样本与新的 L2 样本。

FR-0017 对应的缺口正在这里：当前仓库还没有一套正式冻结的“候选能力描述”对象来回答以下问题：

- 一次成功路径如何被命名、保存和再次调用
- 同一套描述如何同时承载 L3 样本与 L2 首次可用样本
- 能力的输入、输出、错误、来源证据和执行层支持如何被稳定表达
- 后续 `FR-0018` 的验证/重放和 `FR-0019` 的 L2 首次可用如何消费同一套能力描述

因此，本 FR 作为 Phase 2 主树中能力封装链的正式规约输入，负责把“候选能力描述与能力壳”收敛为可供后续实现 PR、验证链路和 L2/L3 统一封装直接消费的正式契约；对应的 owning Work Item 为统一候选能力描述与能力壳。

## 目标

1. 冻结候选能力的正式描述对象，使一次成功路径不再停留在临时脚本或操作者记忆里。
2. 冻结候选能力与最小能力壳的衔接方式，明确哪些字段继承 `FR-0007`，哪些字段属于 Phase 2 新增元数据。
3. 明确一套候选能力描述如何同时承载至少一个 L3 样本与一个 L2 样本。
4. 冻结候选能力与读 / 写 / 下载三类能力面的统一表达边界，避免后续每类能力自造一套描述方式。
5. 为 `FR-0018`、`FR-0019` 和后续交付/导入相关事项提供 implementation-ready 的正式输入。

## 非目标

- 不实现能力导入、安装、分享或版本治理。
- 不实现最小验证、重放与可信判断；这些由 `FR-0018` / 后续 FR 承接。
- 不实现未知网站的 L2 首次可用执行逻辑；这些由 `FR-0019` / 后续 FR 承接。
- 不重定义 `FR-0007` 已冻结的最小能力输入/输出/错误壳。
- 不把候选能力描述提前扩张成最终交付格式、市场格式或社区分享协议。
- 不在本 FR 内混入实现代码。

## 功能需求

### 1. Phase 2 定位与继承边界

- 本 FR 归属 Phase 2 主树中的 `FR-0017` 节点，对应 owning Work Item 为统一候选能力描述与能力壳；它是 Phase 2 / Sprint 4 “再变成可复用能力”的正式规约起点。
- 本 FR 必须显式继承以下既有对象，而不是并行重定义：
  - `FR-0007` 的最小能力壳输入/输出/错误骨架
  - `FR-0004` 的最小诊断与结构化错误表达
  - `FR-0006` 的运行证据与最小持久化边界
- 本 FR 只冻结“候选能力描述”与“如何挂到最小能力壳上”，不承担验证状态判断和交付版本治理。

### 2. 候选能力描述对象

- 必须冻结稳定的 `candidate_ability_descriptor` 对象，至少包含：
  - `ability_id`
  - `display_name`
  - `ability_kind`
  - `entrypoint`
  - `platform_scope`
  - `execution_layer_support`
  - `input_contract_ref`
  - `output_contract_ref`
  - `error_contract_ref`
  - `capture_origin`
  - `capture_run_id`
  - `capture_profile`
  - `captured_at`
  - `candidate_status`
- 可选补充字段：
  - `capture_artifact_refs`
  - `seed_replay_input_ref`
- 其中：
  - `ability_kind` 必须至少支持 `read`、`write`、`download`
  - `execution_layer_support` 必须至少能表达 `L3`、`L2`、`L1`；即使当前主闭环样本主要来自 `L3/L2`，共享 descriptor 也不得把未来 `L1` 候选层排除在正式枚举之外
  - 每个 `candidate_ability_descriptor.execution_layer_support` 都必须显式声明至少一个实际支持层，不得以空集合冒充“稍后再决定”
  - `candidate_status` 在本 FR 内只冻结最小生命周期，不承担可信判断
  - `platform_family` 必须使用稳定、归一化的平台键，不能把共享描述符冻结成 XHS-only 枚举

### 3. 与最小能力壳的接线方式

- `candidate_ability_descriptor` 必须明确映射到 `FR-0007` 的最小能力壳：
  - 调用入口如何映射到结构化 `ability`
  - 输入如何映射到 `input`
  - 运行选项如何映射到 `options`
  - 结果如何继续落回 `summary.capability_result`
  - 错误如何继续复用 `error.details`
- 调用时的 `ability` 必须继续保持 `FR-0007` 的结构对象：
  - `ability.id` 对应 `candidate_ability_descriptor.ability_id`
  - `ability.layer` 表达本次执行所走的实际执行层，不能被 `execution_layer_support` 替代
  - `ability.action` 继续复用 `read` / `write` / `download`
- `ability.layer` 必须落在 `candidate_ability_descriptor.execution_layer_support` 之内；未声明支持的执行层不得被当作合法 invocation 层。
- `ability.action` 必须直接等于 `candidate_ability_descriptor.ability_kind`；若 invocation 中的 action 与 descriptor kind 不一致，必须按结构化输入错误拒绝，而不是由实现自行猜测真实能力面。
- `candidate_ability_descriptor` 必须自包含 `input_contract_ref`、`output_contract_ref`、`error_contract_ref`；本 FR 不再拆出独立 binding 对象或 `descriptor_ref` 平行引用。
- `input_contract_ref`、`output_contract_ref`、`error_contract_ref` 必须被定义为稳定、机器可读的契约标识；它们由 `candidate_ability_descriptor` 命名空间持有，下游 FR 只能按 ref 消费，不得自行猜测路径或重建私有映射。
- `*_contract_ref` 的 canonical namespace 必须统一为 `cad::<ability_id>::<input|output|error>::v<major>`；该格式本身就是正式 resolver 输入，不允许实现方再派生第二套 ref 语法。
- `*_contract_ref` 的 authoritative resolver 必须是 descriptor-owned `candidate_ability_contract_registry`；lookup 规则固定为“以当前 `ability_id` 为 owner，按完整 ref 精确匹配 `entries[*].contract_ref`，并校验 `contract_kind` 与 ref kind 一致”。实现不得把 ref 解释为 repo 文件路径、runtime-store 行键或其他私有定位规则。
- `candidate_ability_contract_registry` 必须作为与 descriptor 同 owner 的伴随对象原子提供；若 registry 缺失、ref 无法解引用、或出现多条冲突 entry，该 descriptor 不得被视为 `candidate_ready`。
- 相同 `*_contract_ref` 只能代表兼容的同一份契约边界；若输入、输出或错误语义发生不兼容变化，必须生成新的 ref。
- 本 FR 必须明确：候选能力描述可以补充元数据，但不得重写 `FR-0007` 的最小输入/输出/错误结构。
- 本 FR 不得新增并行顶层结果壳；成功结果仍只允许通过 `FR-0007.summary.capability_result` 暴露。

### 4. L3 / L2 / L1 统一承载边界

- 必须明确同一套描述对象可以承载：
  - 已有 L3 平台样本
  - 未来 L2 未知网站首次可用样本
  - 未来 L1 fallback 样本
- 必须冻结 `capture_origin` 的最小来源类型，至少覆盖：
  - `l3_adapter_sample`
  - `l2_first_usable_sample`
  - `l1_fallback_sample`
- 必须明确：
  - L3/L2/L1 的差异体现在 `entrypoint`、`platform_scope`、`execution_layer_support` 与 `capture_origin`
  - `capture_origin` 必须与 `execution_layer_support` 至少共享一个对应执行层：`l3_adapter_sample -> L3`、`l2_first_usable_sample -> L2`、`l1_fallback_sample -> L1`
  - 不允许因为执行层不同而拆出第二套候选能力描述协议

### 5. 统一表达读 / 写 / 下载能力面

- 必须明确三类核心能力面如何进入同一描述模型：
  - `read`
  - `write`
  - `download`
- 统一表达至少要覆盖：
  - 入口标识
  - 参数边界
  - 结果边界
  - 失败类型边界
- 本 FR 允许 `download` 暂不进入当前 Sprint 4 主闭环实现，但不允许在模型层缺位。

### 6. 最小生命周期与来源证据

- 必须冻结候选能力在本 FR 内的最小状态集合，至少覆盖：
  - `draft_candidate`
  - `candidate_ready`
- 必须明确：
  - “候选能力已存在”不等于“验证已通过”
  - “候选能力已存在”也不等于“可分享/可交付”
- 每个候选能力必须保留最小来源证据字段，以支持后续验证、重放和诊断：
  - `capture_run_id`
  - `capture_profile`
- `capture_profile` 必须是形成该候选能力时实际使用的 profile 引用，不允许缺失。
- `seed_replay_input_ref` 如存在，必须是首个 replay 输入快照的正式引用字段，稳定指向 `FR-0018.ReplayInputSnapshotRef.snapshot_ref`；后续验证/重放不得再依赖从 `capture_run_id` 或 artifact 引用中临时反推初始输入。
- `seed_replay_input_ref` 如存在，必须与 `capture_run_id + capture_profile` 对应的成功捕获输入同源；但它不是 `draft_candidate` 的强制前置。
- `seed_replay_input_ref` 如存在，只允许初始化 `capture_profile + capture_origin` 对应执行层的首个 replay truth source；descriptor 其他受支持执行层不得因此自动获得 replay eligibility。
- `ability_kind=write` 时，`seed_replay_input_ref` 只允许作为 capture evidence 引用保留；在后续 FR 没有正式冻结 write replay 的 gate 元数据或 dry-run 语义前，不得把它解释成可执行 replay seed。
- `capture_artifact_refs` 如存在，其正式 truth source 必须与 `capture_run_id` 同属一次运行的补充 evidence refs；FR-0017 只保存引用，不定义新的 artifact 存储或跨 run 聚合规则。

### 7. 诊断与实现边界

- 候选能力描述必须能引用最小诊断与失败分类，但不得提前替代 `FR-0018` 的验证结果对象。
- 若一次成功路径缺少最小来源证据、入口边界或输入/输出契约，系统不得把它提升为 `candidate_ready`。
- 本 FR 不引入最终分发清单、版本矩阵或导入协议。

## GWT 验收场景

### 场景 1：L3 样本可进入统一候选能力描述

Given 已存在一个 Phase 1 打穿的 L3 样本
When reviewer 检查本 FR 的正式对象
Then 可以用 `candidate_ability_descriptor` 表达该样本
And 不需要再为 L3 单独创造第二套候选能力协议

### 场景 2：L2 样本可复用同一套描述

Given 后续存在未知网站的 L2 首次可用样本
When reviewer 对照本 FR 的字段与边界
Then 能明确看到 L2 样本只通过 `capture_origin`、`entrypoint` 和 `execution_layer_support` 区分
And 不会要求 L2 另起一套能力壳

### 场景 3：候选能力不会被误写成“已验证”

Given 某个候选能力已经被保存
When reviewer 检查生命周期字段
Then 只能看到 `draft_candidate` 或 `candidate_ready`
And 文档会明确这不等于验证已通过或正式可交付

### 场景 4：读 / 写 / 下载进入统一表达

Given 仓库后续要同时承载读 / 写 / 下载三类能力
When reviewer 检查 `ability_kind` 与契约边界
Then 能明确看到三类能力都进入同一模型
And 下载能力不会因为当前 Sprint 4 的优先级较低而在模型中缺位

### 场景 5：候选能力继续复用 FR-0007 最小壳

Given `FR-0007` 已冻结最小能力壳
When reviewer 检查本 FR 的调用边界
Then 能明确看到候选能力只是附加描述与元数据
And 不会改写 `ability`、`input`、`options`、`summary.capability_result` 或 `error.details` 的最小含义

## 异常与边界场景

1. 只有命令名、没有最小输入/输出契约：不得提升为 `candidate_ready`。
2. 只有一次口头成功，没有 `capture_run_id` 等最小来源证据：不得视为正式候选能力。
3. `*_contract_ref` 不走 descriptor-owned `candidate_ability_contract_registry`，而由实现自行猜 repo 路径或重建私有映射：视为契约解析边界未冻结。
4. `candidate_ability_contract_registry` 缺失、无法精确解引用、或同 ref 出现冲突 entry：不得把该 descriptor 视为 `candidate_ready`。
5. `ability.action` 与 `candidate_ability_descriptor.ability_kind` 不一致时仍允许继续执行：视为调用边界未冻结。
6. 为 L2 单独发明第二套能力描述对象：视为范围漂移。
7. 把 `candidate_status` 直接等同于“验证通过”或“可交付”：视为与 `FR-0018` / Phase 3 边界冲突。
8. 将下载能力排除在统一模型之外：视为与 roadmap 的统一表达方向冲突。
9. 在本 FR 中引入版本治理、导入安装或分享协议：视为越界到 Phase 3/5。
10. `execution_layer_support` 为空，或 `capture_origin` 与其不共享对应执行层：视为候选能力来源与执行层支持边界未冻结。

## 验收标准

1. FR-0017 套件完整，至少包含 `spec.md`、`plan.md`、`TODO.md`、`contracts/`、`data-model.md`、`research.md`、`risks.md`。
2. `candidate_ability_descriptor` 的稳定字段与最小生命周期已冻结。
3. 本 FR 已明确继承 `FR-0007`，不重定义最小能力壳。
4. 同一套候选能力描述已能同时承载 L3 与 L2 样本。
5. 读 / 写 / 下载三类能力面已进入统一表达边界。
6. 本 PR 只冻结规约，不混入实现代码。

## 依赖与前置条件

- GitHub 事项：
  - `#427` Phase 2
  - `#418` Canonical FR issue: FR-0017
  - `#156` Owning Work Item: 统一候选能力描述与能力壳
- 上游 FR：
  - `FR-0007-min-capability-shell`
  - `FR-0004-runtime-observability`
  - `FR-0006-runtime-sqlite-store`
- 相关但不由本 FR 关闭的事项：
  - `#155` / `FR-0018`
  - `#157` / `FR-0019`
  - `#153` / `FR-0021`
  - 后续导入/交付类事项
