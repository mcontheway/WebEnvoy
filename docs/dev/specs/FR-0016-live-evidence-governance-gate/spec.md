# FR-0016 真实 Live Evidence 治理门禁

## 背景

`#310` 的目标是把“真实 live evidence 专项门禁”冻结为仓库正式治理基线，避免以下材料被误当作真实闭环放行依据：

- 历史 run、旧 head 或旧 artifact
- repo-owned native host stub、本地 fake host 或其他替身路径
- 只证明控制面存活的 `runtime.ping` / `runtime.bootstrap`

当前 `#311` 已把相关条款写入 `AGENTS.md`、`docs/dev/AGENTS.md`、`code_review.md` 与 `.github/PULL_REQUEST_TEMPLATE.md`，并已修正前两轮 review 提出的触发条件不一致和最低字段缺失问题。但最新 guardian/review 结论仍明确阻断：这次改动实质上新增了 review/merge 硬门禁，属于高风险治理基线变更，不能绕过正式 FR/spec review 直接合入；并且 `scripts/pr-guardian.sh` 的常驻提示还会注入 `docs/dev/review/guardian-review-addendum.md`，后续治理落库 PR 不能漏掉这一处同步对象。

`#454` 又进一步暴露出 FR-0016 当前冻结口径的后续维护死锁：docs-only live-evidence closeout PR 若在仓库 formal 文档中保留“已固化样本”或历史失败事实，guardian 仍可能把 latest-head fresh rerun 的门禁要求错误外推到仓库内 formal 文档，持续要求把当前 PR head SHA 写回文档；同时，FR-0016 又把 `governance_landing_pr` 固定为 `#310 + 精确五文件` 的一次性落库 lane，导致后续治理维护 PR 很难在不违反 formal contract 的前提下修正这类误判。

因此，本 FR 的职责不是继续润色现有文案，而是为 `#310` 补齐正式治理输入，冻结：

1. live evidence 门禁的适用范围与非适用范围
2. 有效 / 无效 evidence 的边界
3. PR 描述中的最低元数据契约
4. reviewer / guardian / merge-ready 的阻断口径
5. `Fixes #...` / `Refs #...` 与 live evidence 门禁之间的关闭语义
6. formal spec review PR 与治理落库 PR 的拆分要求
7. docs-only formal closeout PR 的 PR 级 latest-head 证据与仓库内固定样本之间的职责分层

## 目标

1. 冻结 `#310` 的正式治理范围，明确哪些 PR 必须进入 live evidence 专项门禁。
2. 冻结“有效证据”和“无效证据”的最低判断口径，防止 reviewer / guardian 各自临时解释。
3. 冻结 PR 描述中 live evidence 区块的最低字段与 `N/A` 适用条件。
4. 冻结 reviewer / guardian / merge-ready / closing semantics 的一致触发条件。
5. 明确 `#310` 必须先走 formal spec review，再进入治理落库 PR。
6. 冻结可支撑后续治理维护 PR 与 docs-only closeout PR 的治理边界，消除这类 motivating case 暴露出的自指阻断，同时不放松真实 in-scope PR 的 latest-head fresh rerun 要求。

## 非目标

- 不修改 runtime、extension、验证脚本或任何页面交互实现。
- 不把 live evidence 门禁扩展成适用于所有 PR 的统一门禁。
- 不替代 runtime 相关 FR（如 `#308`、`#309`）中的正式实现与验证契约。
- 不要求在本 FR 内完成新的 GitHub Action、自动校验器或 bot。
- 不把治理文案落库 PR 伪装成 spec review PR。

## 功能需求

### 1. 专项门禁适用范围冻结

- live evidence 专项门禁必须同时覆盖以下 PR：
  - 声称完成 official runtime 闭环的 PR
  - 声称完成真实页面交互的 PR
  - 声称完成真实 live read/write 闭环的 PR
  - 把 live evidence 作为关闭 issue 核心依据的 PR
  - 把 live evidence 作为判定“已完成”核心依据的 PR
  - 把 live evidence 作为请求 merge 放行核心依据的 PR
- 非适用范围必须至少包含：
  - 不以真实 live evidence 作为关闭、完成或 merge 放行依据的纯文档 PR
  - 不以真实 live evidence 作为关闭、完成或 merge 放行依据的纯研究 / spike PR
  - 不以真实 live evidence 作为关闭、完成或 merge 放行依据的 formal spec / design input PR
  - 不以真实 live evidence 作为关闭、完成或 merge 放行依据的治理前置 PR
- 同一套触发条件必须在根级规范、开发区规范、review 基线、guardian 常驻审查摘要与 PR 模板之间保持一致，不允许某一处缩窄或放宽。
- shared contract 必须显式区分 `general_pr`、`formal_spec_review_pr`、`governance_landing_pr` 与 `governance_maintenance_pr` 四类 review lane，避免 reviewer / guardian 依赖 PR 标题或改动路径临时猜测治理链路阻断前提。
- shared contract 必须明确：`governance_landing_pr` 只保留给 `#310` 的一次性治理落库闭环；后续若仍需精确回写同一五处治理文件，必须显式申报为 `governance_maintenance_pr`，并提供独立的治理 issue 引用，不能回退到启发式判定。

### 2. 有效 / 无效 evidence 边界冻结

- 有效 evidence 必须同时满足：
  - 来自当前 PR latest head 的重新复验
  - 来自真实浏览器执行面，而非 stub / fake host / 其他替身路径
  - 能证明真实页面交互或真实闭环结果，而不是只证明控制面存活
- 以下材料必须被正式标记为默认无效 evidence：
  - 旧 head、旧 run、旧 artifact 的直接复用
  - repo-owned native host stub、本地 fake host 或其他替身路径的成功结果
  - 仅有 `runtime.ping` 成功
  - 仅有 `runtime.bootstrap` ack
  - 只能证明控制链路连通、不能证明真实页面交互或闭环结果的日志

### 3. PR 元数据契约冻结

- 对以下 PR，描述中必须提供结构化 `gate_applicability` 区块：
  - 落入 live evidence 专项门禁的 PR
  - FR-0016 的 formal spec review PR
  - 基于 FR-0016 结论推进的 governance landing PR
  - 基于 FR-0016 结论推进的 governance maintenance PR
- 其余明确不在上述范围内的 PR，不要求为了 FR-0016 额外携带 `gate_applicability` 元数据。
- shared contract 还必须冻结独立于作者自报 lane 的 `classification_scope` 判定输入，至少覆盖：
  - `spec_suite_root`
  - `spec_contract_targets`
  - `todo_handoff_target`
  - `governance_issue_ref`
  - `governance_scope_targets`
- 对落入专项门禁的 PR，描述中还必须提供结构化 `live_evidence_record` 区块。
- `live_evidence_record` 是 PR 级 latest-head fresh rerun 门禁对象；reviewer / guardian 必须以 PR 描述中的该对象作为 latest-head、freshness 与执行面来源的判定输入，不得要求仓库内 formal 文档逐提交追写当前 PR head SHA 来替代这份 PR 元数据。
- `gate_applicability` 必须至少包含：
  - `review_lane`
  - `governance_context_issue_ref`
  - `governance_scope_targets`
  - `in_scope`
  - `trigger_reasons`
  - `n_a_allowed`
- 最低字段必须至少包含：
  - `latest_head_sha`
  - `profile`
  - `browser_channel`
  - `execution_surface`
  - `page_url`
  - `target_tab_id`
  - `run_id`
  - `evidence_collected_at`
  - `artifact_identity`
  - `relay_path`
  - `interaction_locator` 或等价交互定位
  - `success_signals`
  - `minimum_replay`
  - `artifact_log_ref`
  - `failure_reason`
  - `blocker_level`
- 字段命名必须与 `contracts/live-evidence-gate.md` 的 `live_evidence_record` 保持一致；PR 模板可在展示文案中补充中文说明，但不能改出另一套 schema。
- `gate_applicability` 的字段命名必须与 `contracts/live-evidence-gate.md` 保持一致；即使 `live_evidence_record` 整块为 `N/A`，formal spec review PR、governance landing PR、governance maintenance PR 与其他落入专项门禁的 PR 也仍必须提供 `review_lane`、`governance_context_issue_ref`、`in_scope`、`trigger_reasons` 与 `n_a_allowed`，供 reviewer / guardian 机器化判定。
- formal spec review PR、governance landing PR、governance maintenance PR 与其他落入专项门禁的 PR 若缺少必需的结构化 `gate_applicability` 元数据，必须直接阻断；reviewer / guardian 不得用路径或 issue 引用替代这份 PR 元数据义务。
- `classification_scope` 必须独立于作者自报 `review_lane` 存在，用于让 reviewer / guardian 先依据冻结的目标集合判定“是否命中 FR-0016 formal spec 契约文件”“是否触碰 FR-0016 的 `TODO.md` handoff 文件”与“是否精确命中治理落库目标文件”，再决定 lane 与 blocker。
- 对 `governance_landing_pr` / `governance_maintenance_pr`，`gate_applicability` 都还必须显式给出 `governance_scope_targets`，并与 FR-0016 冻结的五处治理落库目标文件保持一致。
- reviewer / guardian 只有在 PR 精确命中这五处目标文件、且 `gate_applicability.governance_context_issue_ref=#310` 时，才按 `governance_landing_pr` 处理，不得被自报 `general_pr` 绕过。
- reviewer / guardian 只有在 PR 精确命中这五处目标文件、且 `gate_applicability.governance_context_issue_ref` 非空且不等于 `#310` 时，才按 `governance_maintenance_pr` 处理；该 lane 不得依赖“作者口头说明自己只是维护 PR”来成立。
- 若 PR 精确命中五处治理落库目标文件，但缺少 `gate_applicability.governance_context_issue_ref`，reviewer / guardian 必须直接阻断，不得把它降格成 `general_pr` 放行。
- 若 PR 在 `#310` 上下文中只命中五处治理目标文件的子集，或在五处目标文件之外再夹带其他实质性改动，也必须直接阻断，不得退成普通 PR。
- 治理落库 PR 与治理维护 PR 都不得触碰 FR-0016 的 `TODO.md` handoff 文件；若需要更新停点或恢复说明，必须拆到独立 PR，而不是继续占用受控治理 lane。
- `governance_landing_pr` 即使对 live evidence 本身属于 `not_applicable`，也仍必须携带可用的 issue closing semantics，只允许 `Refs #310` 或在实际闭环时使用 `Fixes #310`；不得退成 `n_a`。
- `governance_maintenance_pr` 即使 `not_applicable`，也仍必须携带其 `governance_context_issue_ref` 对应的 closing semantics，只允许 `Refs` 或 `Fixes`，不得退成 `n_a`。
- `evidence_collected_at` 必须能标识当前 latest head 上这次 fresh rerun 的采集时间；不得继续复用同一 head 的历史 artifact 时间戳来冒充新鲜复验。
- `run_id` 与 `artifact_identity` 必须使用 provider-scoped 的稳定标识，能够让 reviewer / guardian 机器化地区分“当前 latest head 的 fresh rerun”与“同一 head 的历史 artifact”。
- docs-only formal closeout PR 若在仓库内保留固定样本、历史失败事实或已固化 run 记录，必须明确标注其不是当前 latest-head gate 证据；只要 PR 描述中的 `live_evidence_record` 已完整承载当前 latest-head fresh rerun，reviewer / guardian 就不得要求仓库 formal 文档继续追写当前 PR head SHA。
- 若 evidence 成功，`failure_reason` 与 `blocker_level` 必须填写 `N/A`。
- 若 evidence 失败或阻断，`failure_reason` 与 `blocker_level` 必须填写非空原因和阻断层级，不得用 `N/A` 规避。
- 只有在 PR 明确不落入专项门禁时，才允许将整块字段写为 `N/A`。
- 若 PR 落入专项门禁，但 evidence 结果是失败或阻断，字段仍必须完整填写；不得用 `N/A` 规避披露。

### 4. reviewer / guardian / merge-ready / closing semantics 一致性冻结

- reviewer 与 guardian 必须使用同一套触发条件、最低字段与有效性判断口径。
- 只要以下任一条件成立，reviewer / guardian 就必须阻断，而不是“建议补充”：
  - PR 落入专项门禁但缺少 latest head 新鲜复验
  - evidence 来源不是实际浏览器执行面
  - 只有 `runtime.ping` / `runtime.bootstrap` 一类控制面信号
  - live evidence 字段缺失或与 latest head 不一致
- 对落入专项门禁的 PR：
  - 只有 latest head 的新鲜有效 live evidence 齐备后，才允许使用 `Fixes #...`
  - 若 latest head 的新鲜有效 live evidence 不足，必须继续使用 `Refs #...`
  - 若 evidence 已齐备但本次 PR 只阶段性引用 issue、不构成完整关闭，仍可继续使用 `Refs #...`，不得被 live evidence 专项门禁强制改成 `Fixes #...`
  - 若 `review_lane=formal_spec_review_pr`，则无论 `status=ready` 还是 `status=not_applicable`，都必须继续使用 `Refs #...`，不得使用 `Fixes #...`
  - 只有 reviewer / guardian 未标记 evidence 缺失、失效或边界不符时，才允许进入 `merge-ready`

### 5. formal spec review 与治理落库 PR 的拆分冻结

- `#310` 必须先通过 formal spec review，再进入治理落库 PR。
- 修订 FR-0016 formal contract 与回写五个治理落库文件，仍必须拆成独立 PR；不得为了修复 docs-only closeout 阻断而在同一 PR 混写 formal spec 与治理落库。
- formal spec review PR 的职责只限于：
  - 建立 `docs/dev/specs/FR-0016-live-evidence-governance-gate/`
  - 冻结适用范围、证据边界、元数据契约、阻断规则与拆分要求
- 治理落库 PR 的职责只限于：
  - 按已通过的 FR 结论更新 `AGENTS.md`
  - 更新 `docs/dev/AGENTS.md`
  - 更新 `code_review.md`
  - 更新 `docs/dev/review/guardian-review-addendum.md`
  - 更新 `.github/PULL_REQUEST_TEMPLATE.md`
- 后续治理维护 PR 若不承接 `#310` 的一次性落库闭环，即使命中同一五处文件，也必须以独立治理 issue 引用进入 `governance_maintenance_pr`，而不是继续占用 `governance_landing_pr` lane 或退回启发式 `general_pr`。
- 在 formal spec review 通过前，治理落库 PR 不得申报为可合并状态。
- `spec_review_not_completed` 的阻断必须只对 `governance_landing_pr` 生效，并由 shared contract 内部的结构化 lane 字段判定，而不是依赖 PR 标题、改动路径或人工上下文。
- 若同一 PR 同时改动 `spec_contract_targets` 中任一正式契约文件，或命中 `todo_handoff_target`，且又命中任一治理落库目标文件，必须作为 `mixed_spec_and_governance_scope` 直接阻断；不需要等到完整五文件 landing 形态才触发。

## GWT 验收场景

### 场景 1：以 live evidence 请求 merge 放行的 PR 会被纳入专项门禁

Given 一个 PR 没有宣称关闭 issue
And 该 PR 依赖 live evidence 作为请求 merge 放行的核心依据
When reviewer 或 guardian 判断该 PR 是否适用专项门禁
Then 该 PR 必须落入专项门禁
And 不得因为“没有使用 Fixes”而规避 live evidence 披露

### 场景 2：formal spec / 治理前置 PR 可以明确填写 N/A

Given 一个 PR 只起草 formal spec 或其他治理前置输入
And 它不以真实 live evidence 作为关闭、完成或 merge 放行依据
When 作者填写 PR 模板
Then `live_evidence_record` 区块可以整体填写 `N/A`
And `gate_applicability` 仍必须以结构化元数据显式提供
And reviewer / guardian 不得错误要求其补 runtime live evidence
And 该 PR 必须继续使用 `Refs #...`，不得使用 `Fixes #...` 或省略 issue 引用

### 场景 2A：docs-only closeout PR 的 latest-head 证据以 PR 元数据为准

Given 一个 docs-only PR 以 latest-head fresh rerun 作为 merge 放行依据
And 仓库 formal 文档中仍保留已固化样本或历史失败事实
When reviewer 或 guardian 复核 latest-head freshness
Then 必须以 PR 描述中的 `live_evidence_record` 作为 latest-head 门禁输入
And 只要仓库文档没有把固定样本误写成“当前 latest head”，就不得要求仓库 formal 文档继续追写当前 PR head SHA

### 场景 3：stub 或控制面信号不能被当作真实闭环证据

Given 一个 PR 提供了 stub/fake host 运行日志
Or 只提供 `runtime.ping` 成功或 `runtime.bootstrap` ack
When reviewer 或 guardian 复核 live evidence
Then 这些材料必须被判定为无效 evidence
And 该 PR 必须继续保持阻断状态

### 场景 4：最低字段足以复核 latest head 与执行面来源

Given 一个 PR 落入专项门禁
When 作者补齐 `latest_head_sha`、`execution_surface` 和其他最低字段
Then reviewer 能复核 evidence 是否来自当前 latest head
And guardian 能复核 evidence 是否来自真实浏览器执行面
And 若字段缺失，必须直接阻断

### 场景 5：closing semantics 与 merge-ready 不会出现双口径

Given 一个 PR 落入专项门禁
When 作者尝试使用 `Fixes #...` 或请求进入 `merge-ready`
Then reviewer / guardian 必须基于同一套 live evidence 判定口径进行审查
And 若 latest head 的新鲜有效 evidence 不足，该 PR 只能使用 `Refs #...`
And 不得进入 `merge-ready`

### 场景 6：治理落库 PR 在 spec review 通过前不会被误判为可合并

Given `#310` 的治理落库 PR 已存在
And formal spec review 尚未通过
When reviewer 或 guardian 评估其是否可以继续合并
Then 必须给出阻断结论
And 阻断理由应明确指向“先完成 formal spec review”

## 异常与边界场景

1. 新提交导致 latest head 改变：旧 evidence 自动失效，必须重新复验。
2. PR 使用 live evidence 作为“阶段完成”论据，但不关闭 issue：仍属于专项门禁范围，不得按非适用处理。
3. PR 描述提供了失败 evidence：允许作为阻断证据存在，但字段仍必须完整，且必须显式给出失败原因与阻断层级。
4. PR 只引用历史 artifact 作为背景说明，而不作为关闭、完成或 merge 放行依据：可以不落入专项门禁，但必须避免把历史 artifact 写成当前有效 evidence。
5. reviewer / guardian 文档任一处出现缩窄或放宽触发集合：视为治理基线不一致，必须阻断。
6. formal spec review PR 与治理落库 PR 混在同一条高风险链路：视为流程违规，必须拆分。
7. 未来其他事项若单独修改 `AGENTS.md`、`docs/dev/AGENTS.md`、`code_review.md`、`docs/dev/review/guardian-review-addendum.md` 或 `.github/PULL_REQUEST_TEMPLATE.md`，但不承载 `#310` 的 FR-0016 落库闭环：不得被误判为 `governance_landing_pr`。
8. 治理落库 PR 或治理维护 PR 若触碰 FR-0016 `TODO.md` handoff 文件：视为混线，必须拆分，不继续占用受控治理 lane。
9. 仅改动五处治理落库目标文件中的子集，即使引用 `#310`，也不得被视为完成版 `governance_landing_pr`，更不得据此提前关闭 `#310`。
10. 若治理落库 PR 在五处目标文件之外再混入其他实质性文档或实现改动，也不得继续宣称自己是受控的 `governance_landing_pr`。
11. 若 PR 精确命中五处治理目标文件却缺少 `gate_applicability.governance_context_issue_ref`，必须被阻断；若该 issue 引用等于 `#310`，才可进入 `governance_landing_pr`，否则应进入 `governance_maintenance_pr`。
12. 若治理落库 PR 只更新五处目标文件中的子集，或在五处目标文件之外扩 scope，即使带有 `#310` 引用，也必须被阻断，而不是退回普通 PR 处理。
13. docs-only formal closeout PR 若在仓库内保留固定样本或历史失败事实，只要未把这些样本误写成当前 latest head，就不得因为仓库文档未追写当前 PR head SHA 而被阻断。

## 验收标准

1. `#310` 已拥有可独立 review 的正式 FR 套件。
2. live evidence 专项门禁的触发集合、最低字段和无效 evidence 集合已正式冻结。
3. reviewer / guardian / merge-ready / closing semantics 使用同一套口径，不再依赖口头解释。
4. `N/A` 的适用边界已被清楚冻结，不会给落入专项门禁的 PR 留下绕过空间。
5. formal spec review PR 与治理落库 PR 的拆分要求已被正式写清。
6. 本 FR 没有把 runtime 实现、验证脚本或全仓统一门禁误写进范围。
7. docs-only closeout PR 的 PR 级 latest-head 证据与仓库内固定样本职责已被正式区分，不再产生“为追最新 head 而持续改仓库 formal 文档”的自指阻断。

## 依赖与前置条件

- 对应 issue：
  - `#310`
  - `#343`
- 当前阻断输入：
  - PR `#311`
  - guardian/review on `#311` at commit `0227c64a11d58660cff87d153c79648b87664bff`
  - PR `#454`
  - Issue `#455`
- 上位基线：
  - `vision.md`
  - `AGENTS.md`
  - `docs/dev/AGENTS.md`
  - `code_review.md`
  - `docs/dev/review/guardian-review-addendum.md`
  - `spec_review.md`
- 明确不在本 FR 内承接：
  - `#308`
  - `#309`
