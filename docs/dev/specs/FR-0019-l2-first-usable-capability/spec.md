# FR-0019 L2 未知网站首次可用能力

## 背景

Phase 2 的另一条主价值线是：面对没有现成适配器的未知网站，用户至少要能先做成一次，然后才能谈候选能力、验证与复用。当前架构文档已经为 L2 通用能力留出了明确占位，但 GitHub backlog 里还缺对应的正式规约入口。

`#157` 承接的就是这条缺口：在不依赖站点专用规则的前提下，为未知网站提供最小读取与基础交互能力，并把首次成功路径整理成可进入统一能力壳的输入。如果这一层继续停留在 roadmap 和研究占位，Phase 2 的“再变成可复用能力”会只对已有 L3 样本成立，无法证明 WebEnvoy 对长尾网站也具备生产力。

因此，本 FR 作为 `#157` 的正式规约入口，负责冻结 L2 未知网站首次可用能力的正式边界、成功判定与向候选能力描述的 handoff 输入。

## 目标

1. 冻结未知网站 L2 首次可用能力的正式范围，至少覆盖最小读取与最小基础交互。
2. 冻结 L2 首次成功路径如何产出可进入 `FR-0017` 的候选能力输入。
3. 明确 L2 首次可用与 L3/L1 的边界，以及何时停止、何时降级到 L1。
4. 冻结 L2 首次可用的最小成功判定、失败分类与结构化回传边界。
5. 为后续 Spike D/E 收口和实现前冻结提供正式 baseline 输入。

## 非目标

- 不实现完整通用平台或完整 L1 兜底。
- 不把 L2 首次可用等同于“未知网站能力已经正式可复用”。
- 不实现最终导入/交付。
- 不重定义现有 CLI 主链、运行记录或风控对象。
- 不把高风险 live 写路径恢复混入本 FR。
- 不在本 FR 内混入实现代码。

## 功能需求

### 1. Phase 2 定位与继承边界

- 本 FR 归属 `#368`，承接 `#157` 的 L2 首次可用主线。
- 本 FR 必须显式继承以下既有边界：
  - `FR-0017` 的候选能力描述输入
  - 现有 CLI / Extension / Native Messaging 主链
  - `FR-0004` 的最小诊断对象
  - 与 `FR-0010/0011` 一致的站点无关最小风险门禁原则（如 `risk_gate_blocked`、人工确认、审计留痕）
- 本 FR 只承接“先做成一次”的最小能力，不承诺长期稳定性与正式复用。
- 本 FR 不得把 XHS 专用 gate 条件、账号特有反风控假设或平台特有审批路径直接当成未知网站的实现前置。
- 在 Phase 2 Spike D/E 完成并把相关实现输入冻结前，本 FR 只能作为 formal spec baseline；不得被表述成已经具备 implementation-ready 状态。

### 2. L2 首次可用的最小能力面

- 必须冻结 L2 首次可用至少覆盖：
  - 最小读取
  - 最小页面结构感知
  - 最小基础交互
- 面向上游/下游共享对象时，能力目标类型必须与 Phase 2 统一模型保持一致：
  - `read`
  - `write`
- 当前 FR 的请求面只冻结：
  - `read`
  - `write`
- `download` 仍保留在上游共享模型中，但不属于本 FR 的可请求能力。
- 本 FR 内的“最小基础交互”只允许承接：
  - 导航
  - 定位
  - 点击
  - 输入
  - 提取
  - 等待状态收敛
- 本 FR 必须明确：
  - 这些能力是为了达成首次成功路径
  - 不等于已经形成平台专用适配器或完整命令集
  - 本 FR 中的基础交互在共享枚举上归入 `write`，但不代表恢复高风险 live 写路径
  - `L2FirstUsableRequest.gate_input` 必须直接复用 `FR-0010.gate_input` 的冻结字段形状，至少包含 `run_id`、`session_id`、`profile`、`target_domain`、`target_tab_id`、`target_page`、`action_type`、`requested_execution_mode`、`risk_state`
  - `goal_kind` 必须直接等于 `gate_input.action_type`，且请求不得缺少 `target_tab_id + target_page` 这组目标页确认坐标
  - 当 `goal_kind=write` 时，必须带有机器可读的 `write_safety_boundary`，并明确屏蔽 submit、publish、purchase、final confirm，以及更泛化的 destructive action、financial commitment、external dispatch、account binding 一类不可逆控件

### 3. 首次成功路径的结构化输出

- 必须冻结 L2 首次可用的最小成功产物，至少包含：
  - `first_usable_trace`
  - `interaction_trace`
  - `capture_hints`
  - `candidate_shell_seed`
- 必须明确：
  - 成功态必须同时返回 `result_summary`、`first_usable_trace`、`interaction_trace`、`capture_hints`、`candidate_shell_seed`
  - `first_usable_trace` 与 `interaction_trace` 必须都是结构化步骤对象数组，而不是自由文本列表
  - `candidate_shell_seed` 是面向 `FR-0017` 的 handoff 输入
  - 它不等于候选能力描述本身
  - 但它必须已经提供足以直接物化 `FR-0017.candidate_ability_descriptor` 必填字段的结构化值，而不是仅提供临时 hint
  - `candidate_shell_seed.ability_kind` 必须直接等于本次请求的 `goal_kind`；若目标类型与 handoff seed 不一致，不得把该结果视为首次成功成立
  - L2 首次可用成功的上报不依赖 replay artifact；首次 replay snapshot 的生成与持久化由后续 `FR-0018` 验证链路承接

### 4. 成功判定与失败分类

- 必须冻结 L2 首次可用的最小成功判定，至少包含：
  - 已完成目标读取或目标基础交互
  - 已生成可复核的结构化结果
  - 已生成可进入候选能力链路的 handoff 输入
- 必须冻结最小失败大类，至少覆盖：
  - `insufficient_semantic_structure`
  - `target_not_located`
  - `state_not_settled`
  - `risk_gate_blocked`
  - `requires_l1_fallback`
- 必须明确：
  - `success=false` 的结果对象必须始终返回 `failure_class`
  - 失败分支可以省略成功态产物，但不能省略最小失败原因码
  - 当 `failure_class=requires_l1_fallback` 时，结果对象必须同时返回结构化 `l1_fallback_payload`，至少包含 `fallback_goal`、`fallback_reason`、`recommended_strategy`
  - `l1_fallback_payload.fallback_reason` 只允许表达触发 L2 停止并移交 L1 的最小原因：语义结构不足、目标连续无法定位、或状态始终无法收敛
  - `l1_fallback_payload.recommended_strategy` 只描述 L1 下一步最小方向，不在本 FR 中扩张成完整 L1 工作流或自动切换

### 5. 与 L1 兜底和 L3 专用路径的边界

- 本 FR 必须明确：
  - L2 只承接未知网站或暂无线下专用适配器的网站
  - 若页面缺少足够语义结构、连续三次无法定位目标、或交互链始终无法稳定收敛，应停止宣称 L2 首次可用成立，并给出 L1 fallback 建议
  - 该建议必须以结构化 `l1_fallback_payload` 返回，而不是自由文本；`fallback_goal` 用于说明 L1 继续承接的是 `read` 还是 `write`，`recommended_strategy` 只冻结最小方向，如视觉重新获取目标、视觉确认页面状态、或视觉引导后继续物理交互
- 本 FR 不承诺运行时自动切换 L2/L1/L3，只冻结成功判定与 handoff 边界。

### 6. 与候选能力与验证链路的衔接

- 本 FR 必须明确：
  - L2 首次成功路径的输出必须能进入 `FR-0017`
  - 进入候选能力描述后，后续验证/重放继续由 `FR-0018` 承接
- 本 FR 不得直接把一次成功路径表述成“已验证”或“已正式可复用”。

## GWT 验收场景

### 场景 1：未知网站至少可以先做成一次

Given 某个网站没有现成的 L3 适配器
When 用户通过 L2 首次可用能力执行最小读取或基础交互
Then 系统可以返回结构化结果
And 这次成功不会只停留在临时操作里

### 场景 2：首次成功路径可以进入候选能力链路

Given 某次 L2 首次可用执行成功
When reviewer 检查本 FR 的输出对象
Then 能看到 `candidate_shell_seed`
And 该输出能作为 `FR-0017` 的 handoff 输入

### 场景 3：L2 失败时不会伪装为成功

Given 页面缺少足够语义结构或连续无法定位目标
When L2 无法稳定完成首次成功路径
Then 系统会返回明确失败大类
And `success=false` 的结果对象中必须包含 `failure_class`
And 当 `failure_class=requires_l1_fallback` 时必须同时包含结构化 `l1_fallback_payload`
And 不会返回 `candidate_shell_seed` 冒充候选能力输入

### 场景 4：L2 首次可用不等于正式复用

Given 某次 L2 路径已经成功一次
When reviewer 检查本 FR 的边界
Then 文档会明确它还需要进入候选能力描述和验证链路
And 不会把它直接描述成正式可复用能力

## 异常与边界场景

1. 只完成了一次临时读取，但未留下结构化输出或候选能力 handoff 输入：不得声称首次可用成立。
2. `success=true`，但 `candidate_shell_seed.ability_kind` 与请求 `goal_kind` 不一致：视为 handoff 映射边界未冻结。
3. `success=false` 却缺少 `failure_class`，或仍返回 `candidate_shell_seed`：视为失败回传边界未冻结。
4. `failure_class=requires_l1_fallback` 却缺少结构化 `l1_fallback_payload`，或只给出自由文本建议：视为 L1 交接边界未冻结。
5. 风险门禁阻断时继续推进高风险交互：视为越界到 `FR-0010/0011` 之外。
6. 因为未知网站暂时成功一次就宣称 L2 通用平台已经完成：视为过度承诺。
7. 在未冻结最小执行语义前，把 `download` 伪装成当前 FR 已支持的 L2 请求能力：视为超出本 FR 范围。
8. 在本 FR 中引入完整 L1 兜底、完整导入/交付或完整版本治理：视为越界。

## 验收标准

1. FR-0019 套件完整，至少包含 `spec.md`、`plan.md`、`TODO.md`、`contracts/`、`data-model.md`、`research.md`、`risks.md`。
2. L2 首次可用的最小能力面、成功判定、失败分类与 handoff 输出已冻结。
3. `failure_class=requires_l1_fallback` 时的结构化 `l1_fallback_payload` 已冻结，且不会与成功态 `candidate_shell_seed` 混用。
4. 本 FR 已明确继承 `FR-0017` 与既有运行/诊断/风控边界。
5. 文档已明确区分“首次成功”“候选能力”“已验证能力”。
6. 本 PR 只冻结规约，不混入实现代码。
7. 文档已明确把 Spike D/E 保留为进入实现前冻结之前的前置，而不是已完成事实。

## 依赖与前置条件

- GitHub 事项：
  - `#368`
  - `#157`
- 上游 FR：
  - `FR-0017-unified-candidate-ability-shell`
  - `FR-0004-runtime-observability`
- 相关但不由本 FR 关闭的事项：
  - `#155`
  - `#153`
  - 后续 L1 兜底与交付类事项
  - `FR-0010-xhs-risk-gates-hardening`
  - `FR-0011-xhs-min-anti-detection-execution`
