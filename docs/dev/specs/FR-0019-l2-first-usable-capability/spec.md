# FR-0019 L2 未知网站首次可用能力

## 背景

Phase 2 的另一条主价值线是：面对没有现成适配器的未知网站，用户至少要能先做成一次，然后才能谈候选能力、验证与复用。当前架构文档已经为 L2 通用能力留出了明确占位，但 GitHub backlog 里还缺对应的正式规约入口。

FR-0019 的 owning Work Item 承接的就是这条缺口：在不依赖站点专用规则的前提下，为未知网站提供最小读取与基础交互能力，并把首次成功路径整理成可进入统一能力壳的输入。如果这一层继续停留在 roadmap 和研究占位，Phase 2 的“再变成可复用能力”会只对已有 L3 样本成立，无法证明 WebEnvoy 对长尾网站也具备生产力。

因此，本 FR 作为 FR-0019 owning Work Item 的正式规约入口，负责冻结 L2 未知网站首次可用能力的正式边界、成功判定与向候选能力描述的 handoff 输入。

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
- 不在本 FR 内冻结未知站点通用 `write` 请求、live write lane 或对应治理路径。
- 不在本 FR 内混入实现代码。

## 功能需求

### 1. Phase 2 定位与继承边界

- 本 FR 归属 Phase 2 主树中的 `FR-0019` 节点，对应 owning Work Item 为 L2 首次可用闭环。
- 本 FR 必须显式继承以下既有边界：
  - `FR-0017` 的候选能力描述输入
  - 现有 CLI / Extension / Native Messaging 主链
  - `FR-0004` 的最小诊断对象
  - 与 `FR-0010/0011` 一致的站点无关最小风险门禁原则（如 `risk_gate_blocked`、人工确认、最小审计留痕）
- 本 FR 只承接“先做成一次”的最小能力，不承诺长期稳定性与正式复用。
- 本 FR 不得把 XHS 专用 gate 条件、账号特有反风控假设或平台特有审批路径直接当成未知网站的实现前置。
- 本 FR 的请求面只冻结站点无关的 `risk_gate_context`，不得把 `FR-0010.gate_input` 或其他平台专用 gate 请求对象整体别名为通用 L2 输入。
- 在 Phase 2 Spike D/E 完成并把相关实现输入冻结前，本 FR 只能作为 formal spec baseline；不得被表述成已经具备 implementation-ready 状态。

### 2. L2 首次可用的最小能力面

- 必须冻结 L2 首次可用至少覆盖：
  - 最小读取
  - 最小页面结构感知
  - 最小基础交互
- 面向上游/下游共享对象时，能力目标类型必须与 Phase 2 统一模型保持一致：
  - `read`
  - `write`
  - `download`
- 当前 FR 的请求面只冻结：
  - `read`
- `write` / `download` 仍保留在上游共享模型中，但不属于本 FR 的可请求能力。
- 本 FR 内的“最小基础交互”只允许承接：
  - 导航
  - 定位
  - 点击
  - 提取
  - 等待状态收敛
- 本 FR 必须明确：
  - 这些能力是为了达成首次成功路径
  - 不等于已经形成平台专用适配器或完整命令集
  - `L2FirstUsableRequest` 只允许携带站点无关的 `risk_gate_context`，至少包含 `run_id`、`profile`、`target_domain`、`target_tab_id`、`target_page`、`risk_state`；`session_id` 如 runtime 已提供则携带，否则不得因其缺失而判定请求无效
  - `goal_kind` 是本 FR 唯一正式的能力目标类型；`interaction_safety_class` 是与之分离的正式动作纯度轴；但当前 formal baseline 只冻结 `goal_kind=read + interaction_safety_class=pure_read`
  - `target_url` 的域名必须能回链到 `risk_gate_context.target_domain`，且请求不得缺少 `target_tab_id + target_page` 这组目标页确认坐标
  - 若上游门禁请求仍携带平台专用 write lane、`irreversible_write` 或其他站点专用 gate 语义，必须在进入本 FR 前直接被阻断；FR-0019 当前不消费这类输入
  - `risk_state=paused` 时，请求必须直接返回 `failure_class=risk_gate_blocked`，不得进入 read-first 执行路径
  - `risk_state=limited` 在本 FR 中表示“只允许受控范围”；当前 formal baseline 下，`goal_kind=read + interaction_safety_class=pure_read` 属于允许执行的受控路径，不得因状态为 `limited` 而默认阻断
  - `risk_state=allowed` 时，同样允许执行当前 read-first 路径；因此对本 FR 而言，可执行状态固定为 `limited | allowed`，阻断状态固定为 `paused`
  - `goal_kind=read` 必须固定映射到 `interaction_safety_class=pure_read`
  - `goal_kind=read` 时允许放行 `navigate`、`locate`、`reveal_only_click`、`extract`、`wait_settled`；request-side 不再允许裸 `click`
  - `goal_kind=read` 的 request-side `allowed_actions` 必须显式包含 `extract`；若请求没有授权 `extract`，则它与 read-success 判定矛盾，必须在请求阶段按结构化输入错误拒绝
  - 当前 formal baseline 下，`goal_kind=read` 是唯一成功目标；`navigate`、`locate`、`reveal_only_click`、`wait_settled`、`extract` 只定义 read-first 路径允许使用的步骤，其中除 `extract` 外均不得单独构成成功终态
  - `reveal_only_click` 只允许承接 `expand_or_collapse`、`switch_content_tab`、`open_detail_view`、`load_more_or_paginate`
  - request-side `reveal_only_click` 与 trace-side `action=click + interaction_semantics=reveal_only_click` 是同一类受允许动作的正式翻译关系；bare `action=click` 且没有 `interaction_semantics=reveal_only_click` 不得被视为已授权的 pure-read 点击
  - `interaction_safety_class=pure_read` 时，必须显式禁止 `type`、submit、confirm、publish、purchase、dispatch、bind，以及任何会持久改变账号、内容或表单状态的点击
  - 未知站点通用 `write` lane 当前不在本 FR 范围内；如需纳入正式请求面，必须在独立 FR 中同时冻结其 execution、validation、audit 与 health-state 边界

### 3. 首次成功路径的结构化输出

- 必须冻结 L2 首次可用的最小成功产物，至少包含：
  - `first_usable_trace`
  - `interaction_trace`
  - `capture_hints`
  - `candidate_shell_seed`
- 必须明确：
  - 成功态必须同时返回 `result_summary`、`first_usable_trace`、`interaction_trace`、`capture_hints`、`candidate_shell_seed`
  - `first_usable_trace` 与 `interaction_trace` 必须都是结构化步骤对象数组，而不是自由文本列表
  - `interaction_trace` 必须显式编码 `interaction_semantics`
  - 当前 formal baseline 下，成功路径里的 `action=click` 只允许与 `interaction_semantics=reveal_only_click` 一起出现，并且必须显式编码 `click_kind`
  - `interaction_semantics=neutral` 只允许用于 `navigate`、`locate`、`extract`、`wait_settled` 这类非点击步骤；pure-read 成功路径不得上报 `neutral click`
  - `candidate_shell_seed` 是面向 `FR-0017` 的 handoff 输入
  - 它不等于候选能力描述本身
  - 但它必须已经提供足以直接物化 `FR-0017.candidate_ability_descriptor` 必填字段的结构化值，并同时携带 descriptor-owned `candidate_ability_contract_registry` 的最小 seed；不得只留下无法解引用的 `*_contract_ref`
  - `candidate_shell_seed.ability_kind` 必须直接等于本次请求的 `goal_kind`；当前 formal baseline 下只允许落成 `read`
  - `interaction_safety_class` 只描述本次首次可用路径允许的动作纯度，不改变 `candidate_shell_seed.ability_kind`；当前 formal baseline 下，`pure_read` 必须自然回落到 `FR-0017.ability_kind=read`
  - `candidate_shell_seed.execution_layer_support` 必须显式声明为 `["L2"]`；不得省略，也不得以空数组冒充支持 L2 handoff
  - `candidate_shell_seed.contract_registry_seed.ability_id` 必须直接等于 `candidate_shell_seed.ability_id`，且 `entries[*].contract_ref` 至少覆盖该次 handoff 引用到的 `input_contract_ref`、`output_contract_ref`、`error_contract_ref`
  - `success=true` 还要求 `candidate_shell_seed.contract_registry_seed` 已满足 `FR-0017.candidate_ability_contract_registry` 的有效性规则；若存在重复 ref、kind 不匹配或无法唯一解引用的 entry，不得上报成功 handoff
  - L2 首次可用成功的上报不依赖 replay artifact；首次 replay snapshot 的生成与持久化由后续 `FR-0018` 验证链路承接

### 4. 成功判定与失败分类

- 必须冻结 L2 首次可用的最小成功判定，至少包含：
  - 已完成目标读取
  - 已生成可复核的结构化结果
  - 已生成可进入候选能力链路的 handoff 输入
- 必须冻结最小失败大类，至少覆盖：
  - `risk_gate_blocked`
  - `requires_l1_fallback`
- 必须明确：
  - 当前 read-first baseline 下，`success=true` 必须证明实际读取已经完成；为读取服务的 reveal-only click、导航、定位、等待收敛都只能作为支持步骤，不能替代读取成功本体
  - `success=true` 时，`result_summary` 必须携带满足 `output_contract_ref` 的实际读取结果，且 `interaction_trace` 中必须至少出现一条 `action=extract` 的读取步骤
  - `success=false` 的结果对象必须始终返回 `failure_class`
  - 失败分支可以省略成功态产物，但不能省略最小失败原因码
  - 当 `failure_class=requires_l1_fallback` 时，结果对象必须同时返回结构化 `l1_fallback_payload`，至少包含 `fallback_goal`、`fallback_reason`、`recommended_strategy`
  - L2 因语义结构不足、目标连续无法定位或状态始终无法收敛而停止时，顶层 `failure_class` 必须统一为 `requires_l1_fallback`，不得再把这三类原因平铺成并列的顶层失败形状
  - `l1_fallback_payload.fallback_reason` 只允许表达触发 L2 停止并移交 L1 的最小原因：语义结构不足、目标连续无法定位、或状态始终无法收敛
  - `l1_fallback_payload.recommended_strategy` 只描述 L1 下一步最小方向，不在本 FR 中扩张成完整 L1 工作流或自动切换

### 5. 与 L1 兜底和 L3 专用路径的边界

- 本 FR 必须明确：
  - L2 只承接未知网站或暂无线下专用适配器的网站
  - 若页面缺少足够语义结构、连续三次无法定位目标、或交互链始终无法稳定收敛，应停止宣称 L2 首次可用成立，并给出 L1 fallback 建议
  - 该建议必须以结构化 `l1_fallback_payload` 返回，而不是自由文本；`fallback_goal` 当前只允许 `read`，`recommended_strategy` 只冻结最小方向，如视觉重新获取目标、视觉确认页面状态、或视觉引导后继续物理交互
- 本 FR 不承诺运行时自动切换 L2/L1/L3，只冻结成功判定与 handoff 边界。

### 6. 与候选能力与验证链路的衔接

- 本 FR 必须明确：
  - L2 首次成功路径的输出必须能进入 `FR-0017`
  - 进入候选能力描述后，后续验证/重放继续由 `FR-0018` 承接
- 本 FR 不得直接把一次成功路径表述成“已验证”或“已正式可复用”。

## GWT 验收场景

### 场景 1：未知网站至少可以先做成一次

Given 某个网站没有现成的 L3 适配器
When 用户通过 L2 首次可用能力执行最小读取，并在需要时使用基础交互作为支持步骤
Then 系统可以返回结构化结果
And 返回的结构化结果必须包含实际读取结果，而不是仅包含交互状态
And 这次成功不会只停留在临时操作里
And 只有在实际读取结果已经形成后，才允许把该次执行标记为 `success=true`

### 场景 2：read 目标允许 reveal-only click

Given 某个未知网站的读取目标需要先展开折叠区或切换内容标签才能看到内容
When 请求以 `goal_kind=read` 进入 L2 首次可用
Then 正式动作纯度必须是 `interaction_safety_class=pure_read`
And `expand_or_collapse`、`switch_content_tab`、`open_detail_view`、`load_more_or_paginate` 这类 `reveal_only_click` 可以被视为合法读取路径的一部分
And 不会因此把该请求升级为 `write`
And 这些点击只能作为读取前的支持步骤，不能单独充当读取成功
And 只有在后续完成 `extract` 并返回实际读取结果后，才可构成合法 read-success 的一部分

### 场景 3：read 目标中的 type 或 submit 不合法

Given 某个未知网站的读取路径要求先输入文本或触发 submit/confirm
When 请求仍以 `goal_kind=read` 进入 L2 首次可用
Then 系统不得把该路径视为合法 `pure_read`
And 必须阻断该动作组合、返回失败或进入 fallback

### 场景 4：未知站点通用 write lane 不属于当前 formal baseline

Given 某个未知网站的目标需要 `type`、submit、confirm 或其他状态改变动作
When 请求仍试图进入当前 FR 的 L2 首次可用
Then 系统不得把该路径视为当前 formal baseline 内的合法请求
And 不得返回 `candidate_shell_seed`
And 必须阻断、失败或进入 fallback，而不是把未知站点 write lane 混入本 FR

### 场景 5：read 中的揭示型点击必须能被机器识别

Given 某个读取路径使用了 `open_detail_view` 或 `load_more_or_paginate`
When reviewer 同时检查请求对象与系统输出 `interaction_trace`
Then request-side 只能通过 `allowed_actions=reveal_only_click` 预授权这类点击
And 相应交互在 trace-side 必须显式标记 `action=click + interaction_semantics=reveal_only_click`
And 必须显式给出对应的 `click_kind`
And 不得把这类点击退回为无法区分语义的泛化 `click`
And pure-read 成功路径中的点击步骤不得以 `interaction_semantics=neutral` 回传

### 场景 6：首次成功路径可以进入候选能力链路

Given 某次 L2 首次可用执行成功
When reviewer 检查本 FR 的输出对象
Then 能看到 `candidate_shell_seed`
And 该输出能作为 `FR-0017` 的 handoff 输入
And `candidate_shell_seed` 中会同时包含 descriptor 字段与 `contract_registry_seed`

### 场景 7：L2 失败时不会伪装为成功

Given 页面缺少足够语义结构或连续无法定位目标
When L2 无法稳定完成首次成功路径
Then 系统会返回明确失败大类
And `success=false` 的结果对象中必须包含 `failure_class`
And 当 `failure_class=requires_l1_fallback` 时必须同时包含结构化 `l1_fallback_payload`
And 不会返回 `candidate_shell_seed` 冒充候选能力输入

### 场景 8：`risk_state=limited` 仍允许执行受控 read-first 路径

Given 请求满足当前 formal baseline 的 `goal_kind=read + interaction_safety_class=pure_read`
And `risk_gate_context.risk_state=limited`
When 请求进入 L2 首次可用
Then 系统不得仅因 `risk_state=limited` 就返回 `risk_gate_blocked`
And 该请求仍可进入当前受控 read-first 执行路径

### 场景 9：`risk_state=paused` 必须直接阻断

Given `risk_gate_context.risk_state=paused`
When 请求进入 L2 首次可用
Then 系统必须返回 `failure_class=risk_gate_blocked`
And 不得进入 read-first 执行路径

### 场景 10：L2 首次可用不等于正式复用

Given 某次 L2 路径已经成功一次
When reviewer 检查本 FR 的边界
Then 文档会明确它还需要进入候选能力描述和验证链路
And 不会把它直接描述成正式可复用能力

## 异常与边界场景

1. 只完成了一次临时读取，但未留下结构化输出或候选能力 handoff 输入：不得声称首次可用成立。
2. 只完成 reveal-only click、导航、定位或等待收敛，但没有形成实际读取结果，仍把结果标记为 `success=true`：视为把支持步骤误当成读取成功。
3. `success=true`，但 `candidate_shell_seed.ability_kind` 与请求 `goal_kind` 不一致：视为 handoff 映射边界未冻结。
4. `success=true`，但 `candidate_shell_seed` 只给出 `*_contract_ref`，没有同 owner 的 `contract_registry_seed` 或缺少对应 entry：视为下游 contract resolver 边界未冻结。
5. `success=false` 却缺少 `failure_class`，或仍返回 `candidate_shell_seed`：视为失败回传边界未冻结。
6. `failure_class=requires_l1_fallback` 却缺少结构化 `l1_fallback_payload`，或只给出自由文本建议：视为 L1 交接边界未冻结。
7. 风险门禁阻断时继续推进高风险交互：视为越界到 `FR-0010/0011` 之外。
8. `risk_state=limited` 的请求一会儿被默认阻断、一会儿又被允许执行：视为门禁执行语义未冻结。
9. `risk_state=paused` 的请求仍进入 read-first 执行路径：视为风险阻断边界未冻结。
10. 因为未知网站暂时成功一次就宣称 L2 通用平台已经完成：视为过度承诺。
11. 在未冻结最小执行语义前，把 `download` 伪装成当前 FR 已支持的 L2 请求能力：视为超出本 FR 范围。
12. 在本 FR 中引入完整 L1 兜底、完整导入/交付或完整版本治理：视为越界。
13. 把 `FR-0010.gate_input`、其平台专用 write lane / execution-mode 集合，或其他平台专用 gate 请求对象直接当成通用未知网站 L2 输入，而不先收敛到当前 read-first 边界：视为共享请求边界漂移。
14. `goal_kind=read` 未引入独立的 `interaction_safety_class`，或把 `type`、submit、confirm 等状态改变动作混入 `pure_read`：视为目标类型与动作纯度仍然混轴。
15. request-side 仍允许裸 `click`，没有在执行前把可放行的点击显式收敛为 `reveal_only_click`：视为读取边界未冻结。
16. 在当前 FR 中引入未知站点通用 `write` 请求、write candidate 或 live-write 门禁对象：视为超出已批准的 Phase 2 read-first 基线。
17. request-side `reveal_only_click` 与 trace-side `action=click + interaction_semantics=reveal_only_click` 没有形成稳定翻译关系：视为请求边界与执行回传边界仍然脱节。
18. `candidate_shell_seed.contract_registry_seed` 存在重复 ref、kind 不匹配或无法唯一解引用的 entry，仍被当作成功 handoff：视为下游 contract resolver 边界未冻结。
19. pure-read 成功路径里仍出现 `action=click + interaction_semantics=neutral`，或点击步骤缺少 `click_kind`：视为成功 trace 的机器边界未冻结。
20. 把 `insufficient_semantic_structure`、`target_not_located`、`state_not_settled` 继续平铺为顶层 `failure_class`，而不是统一收口到 `requires_l1_fallback + l1_fallback_payload.fallback_reason`：视为 L2->L1 交接形状仍然重复。
21. `candidate_shell_seed.execution_layer_support` 缺失、为空，或不是显式 `["L2"]`：视为成功 handoff 仍未正式声明实际支持的执行层。
22. `success=true`，但 `interaction_trace` 中没有任何 `action=extract`，或 `result_summary` 里没有可回链到本次读取的结构化结果：视为把未完成的 read 路径误报为已成功。
23. `goal_kind=read` 的 request-side `allowed_actions` 未显式包含 `extract`，却仍允许请求进入执行：视为请求契约与成功契约仍然矛盾。

## 验收标准

1. FR-0019 套件完整，至少包含 `spec.md`、`plan.md`、`TODO.md`、`contracts/`、`data-model.md`、`research.md`、`risks.md`。
2. L2 首次可用的最小能力面、成功判定、失败分类与 handoff 输出已冻结。
3. 当前 formal baseline 已明确保持 read-first，未知站点通用 `write` lane 不在本 FR 的正式请求面与成功路径内。
4. `failure_class=requires_l1_fallback` 时的结构化 `l1_fallback_payload` 已冻结，且不会与成功态 `candidate_shell_seed` 混用。
5. 本 FR 已明确继承 `FR-0017` 与既有运行/诊断/风控边界。
6. 文档已明确区分“首次成功”“候选能力”“已验证能力”。
7. 本 PR 只冻结规约，不混入实现代码。
8. 文档已明确把 Spike D/E 保留为进入实现前冻结之前的前置，而不是已完成事实。

## 依赖与前置条件

- GitHub 事项：
  - `#427` Phase 2
  - `#419` Canonical FR issue: FR-0019
  - `#157` Owning Work Item
- 上游 FR：
  - `FR-0017-unified-candidate-ability-shell`
  - `FR-0004-runtime-observability`
- 相关但不由本 FR 关闭的事项：
  - `#155` / `FR-0018`
  - `#153` / `FR-0021`
  - 后续 L1 兜底与交付类事项
  - `FR-0010-xhs-risk-gates-hardening`
  - `FR-0011-xhs-min-anti-detection-execution`
