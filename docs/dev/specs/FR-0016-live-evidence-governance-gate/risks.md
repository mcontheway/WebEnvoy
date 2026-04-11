# FR-0016 风险与回滚

## 风险 1：专项门禁触发集合再次漂移

- 触发条件：
  - 根级规范、开发区规范、review 基线、guardian 常驻审查摘要与 PR 模板对适用范围写出不同集合
  - “以 live evidence 请求 merge 放行”再次被遗漏
  - PR 侧元数据没有稳定承载 `gate_applicability`，导致 reviewer / guardian 被迫回退到标题、路径或人工上下文 heuristics
  - `gate_applicability` 被错误扩成所有 reviewed PR 的 repo-wide 必填元数据
  - `governance_landing_pr` 只靠作者自报 `review_lane`，没有冻结可校验的目标文件集合
  - formal spec review PR 与治理落库目标文件重新混线，但 contract 没有结构化 blocker
  - lane 判定仍要先相信作者自报 `review_lane`，没有独立的 classification 输入
  - `governance_landing_pr` 若只靠五个治理目标文件路径命中，会把未来无关治理修订误吸进 FR-0016 专项门禁
  - 未来治理维护 PR 若精确命中五个治理目标文件，却缺少可机器判定的治理 issue 引用，仍会回到启发式分类
  - `mixed_spec_and_governance_scope` 若没有把 FR-0016 `TODO.md` handoff 文件纳入阻断，治理落库 PR 仍可夹带 handoff 改动重新混线
  - `formal_spec_review_pr` 若继续按整棵 spec 目录命中，会把非契约 handoff 回写也误判成 formal spec 语义变更
  - `governance_landing_pr` 若允许部分五文件子集触发，仍会给不完整落库 PR 留下提前关闭 `#310` 的空间
  - 必需的 `gate_applicability` 元数据若缺失却不显式 blocked，reviewer/guardian 仍可回到启发式放行
  - 治理落库 lane 若继续为 `TODO.md` 开同行例外，机器判定仍会回到“进度回写还是语义回写”的启发式争议
  - 治理落库 PR 若允许在五文件之外夹带其他实质性改动，split 规则仍不可机器执行
  - 精确命中五个治理落库目标文件却缺少 `governance_context_issue_ref` 时，若不显式 blocked，仍可绕开治理门禁前置条件
  - `governance_landing_pr` 若允许 `n_a` closing semantics，仍可绕开仓库要求的 `Refs/Fixes #310` metadata
  - 带 `#310` 上下文的治理落库尝试若只命中目标文件子集，或在五文件之外扩 scope，仍可能绕开治理前置门禁
  - formal spec PR 若触碰任一治理落库目标文件却不立即 mixed-scope blocked，仍可能把高风险治理文案重新塞回 spec 线
  - formal spec PR 若在 `status=ready` 时仍可使用 `Fixes`，仍可能提前关闭本应由治理落库 PR 承接的 `#310`
  - docs-only closeout PR 若在仓库 formal 文档中保留固定样本，reviewer / guardian 仍错误要求其逐提交追写当前 PR head SHA
- 影响：
  - 作者、reviewer 与 guardian 会基于不同前提做判断
  - live evidence 门禁再次出现可绕过空间
- 缓解：
  - formal contract 中显式冻结触发原因枚举
  - formal contract 中显式冻结 `review_lane`
  - formal spec 明确要求 PR 描述显式承载 `gate_applicability`
  - formal spec 明确限制 `gate_applicability` 只作用于专项门禁 PR、formal spec review PR、governance landing PR 与 governance maintenance PR
  - formal contract 中显式冻结 `governance_scope_targets`，并要求 reviewer / guardian 用其校验治理落库 lane
  - formal contract 中显式冻结 `mixed_spec_and_governance_scope` 与 formal spec lane 的 `Fixes` 禁止规则
  - formal contract 中显式冻结 `classification_scope`，并要求先消费该输入再判 lane
  - formal contract 中显式冻结 `governance_issue_ref=#310`，要求治理落库 lane 只能在“目标文件命中 + issue 上下文命中”时成立
  - formal contract 中显式区分 `#310` 的一次性 `governance_landing_pr` 与后续 `governance_maintenance_pr`，并要求两者都携带可机器判定的治理 issue 引用
  - formal contract 中显式冻结 `spec_contract_targets`，把正式契约文件与 FR-0016 `TODO.md` handoff 文件分开建模
  - formal contract 中显式要求 formal spec lane 只由 `spec_contract_targets` 触发，治理落库 lane 只在完整五文件集合落库时成立
  - formal contract 中显式冻结 `missing_gate_applicability_metadata` blocker，禁止 reviewer/guardian 以启发式替代必需元数据
  - formal contract 中显式限定 FR-0016 `TODO.md` 只承担 handoff 记录，不再作为治理落库 lane 的同行例外
  - formal contract 中显式限定治理落库线为精确五文件范围，排除其他实质性夹带改动
  - formal contract 中显式冻结 `missing_governance_issue_ref` blocker，禁止精确命中治理落库集合的 PR 通过漏写 `#310` 引用来绕路
  - formal contract 中显式限定 `governance_landing_pr` 即使 `not_applicable` 也不得使用 `n_a` closing semantics
  - formal contract 中显式冻结 `invalid_governance_landing_scope` blocker，禁止带 `#310` 上下文的子集/超集治理改动退回普通 PR
  - formal contract 中显式要求 formal spec PR 只要触碰任一治理落库目标文件就立即触发 `mixed_spec_and_governance_scope`
  - formal contract 中显式要求 formal spec lane 无论 `ready` 还是 `not_applicable` 都保持 `refs_only`
  - formal contract 中显式声明 `live_evidence_record` 是 PR 级 latest-head 门禁对象，禁止把仓库 formal 文档中的固定样本误判成必须追写当前 PR head 的 gate 证据
  - 后续治理落库 PR 必须逐项对照同一集合，并同步更新 `docs/dev/review/guardian-review-addendum.md`
- 回滚：
  - 阻断治理落库 PR，回到 formal spec 层修正 shared contract

## 风险 2：最低字段全集被删减，无法支撑 latest head / 执行面 / 最小复现 / artifact 复核

- 触发条件：
  - `contracts/live-evidence-gate.md` 已冻结的任一 `live_evidence_record` 字段被删除、重命名、降格为可选，或只保留 `latest_head_sha` / `execution_surface` 两个核心字段
  - 缺少能区分同一 head 下 fresh rerun 与历史 artifact 的 freshness / artifact identity 字段，例如 `evidence_collected_at`、`artifact_identity`
- 影响：
  - reviewer 无法稳定判断 evidence 是否来自当前 latest head
  - reviewer / guardian 无法稳定判断 evidence 是否真的是当前 latest head 的 fresh rerun，而不是同一 head 的历史 artifact
  - guardian 无法稳定判断 evidence 是否来自真实浏览器执行面
  - 缺少 `profile`、`run_id`、`evidence_collected_at`、`artifact_identity`、`page_url`、`interaction_locator`、`minimum_replay`、`artifact_log_ref` 等字段时，复核者无法稳定复现或追溯 evidence
- 缓解：
  - 在 shared contract 中把 `live_evidence_record` 的全部已冻结字段都定义为只可追加、不可删减、不可降格为可选
  - 把 `evidence_collected_at`、`artifact_identity`、`run_id` 与 `artifact_log_ref` 组合起来，作为“fresh rerun 而非 same-head 历史 artifact”的最小复核线索
  - 任何删减、重命名或降格都视为阻断性改动
- 回滚：
  - 保持 `refs_only` 与 `merge_ready=false`，直到字段恢复

## 风险 3：`N/A` 被误用为规避披露

- 触发条件：
  - 落入专项门禁的 PR 仍把 live evidence 区块写成 `N/A`
  - 模板或 review 规则没有写清 `N/A` 只适用于非专项门禁 PR
- 影响：
  - 作者可以形式上“满足模板”，但 reviewer 实际拿不到必要信息
  - live evidence 元数据门禁失效
- 缓解：
  - formal spec 明确 `N/A` 只适用于 `in_scope=false`
  - reviewer / guardian 在 `in_scope=true` 且 `N/A` 出现时直接阻断
- 回滚：
  - 将该 PR 退回 `blocked`，并要求重填最低字段

## 风险 4：stub / fake host / 控制面信号继续被误写成有效 evidence

- 触发条件：
  - review 基线没有把 `runtime.ping`、`runtime.bootstrap`、stub/fake host 写成默认无效 evidence
- 影响：
  - PR 可能在没有真实浏览器闭环的情况下被错误放行
- 缓解：
  - 在 formal spec、contract 与治理落库文案中同时冻结“默认无效 evidence”集合
  - 将此类情况定义为直接阻断，而不是建议补充
- 回滚：
  - 继续使用 `Refs #...`
  - 保持 `merge_ready=false`

## 风险 5：formal spec review 与治理落库 PR 混线

- 触发条件：
  - 高风险治理事项在同一 PR 中同时新增 formal spec 与落库文案
- 影响：
  - reviewer 无法先冻结契约，再判断实现是否符合契约
  - 当前 blocker 会反复出现
- 缓解：
  - formal spec review PR 与治理落库 PR 强制拆开
  - 治理落库 PR 在 spec review 通过前默认阻断
- 回滚：
  - 拆分 PR，保留 formal spec 主链，把治理落库改动移到后续 PR

## 最小门禁矩阵

本节只做 `contracts/live-evidence-gate.md` 的状态镜像摘要，帮助 reviewer 按风险视角快速判定 `ready / blocked / not_applicable`；若与 contract 条款存在任何冲突，以 `contracts/live-evidence-gate.md` 为准，并先回到 contract 修正单一真源。

### ready

- `status=ready`
- `gate_applicability.in_scope=true`
- `gate_applicability.trigger_reasons` 非空
- `gate_applicability.n_a_allowed=false`
- `blocking_reasons=[]`
- 若 `review_lane=formal_spec_review_pr`，`closing_semantics` 必须保持 `refs_only`
- 其他 lane 的 `closing_semantics` 可按普通 Issue 闭环语义选择 `fixes_allowed` 或继续保持 `refs_only`；live evidence 专项门禁只负责解除“因证据不足而不得使用 `Fixes`”这一层限制，不强制要求作者必须改成 `Fixes`
- `merge_ready=true`
- `live_evidence_record` 已完整提供，`latest_head_sha` 对应当前 PR latest head，`execution_surface=real_browser`，`success_signals` 能证明真实页面交互或真实闭环结果
- `run_id`、`evidence_collected_at`、`artifact_identity` 与 `artifact_log_ref` 能共同指向当前 latest head 的 fresh rerun，而不是同一 head 的历史 artifact
- `interaction_locator` 与当前 evidence 场景相匹配，不要求 write-flow 专用占位字段
- reviewer / guardian 未标记 evidence 缺失、旧 head、非真实执行面或控制面-only 信号

### blocked

- `status=blocked`
- `blocking_reasons` 非空
- `closing_semantics=refs_only`
- `merge_ready=false`
- 常见阻断原因包括缺少 latest head 新鲜复验、evidence 来源不是 `real_browser`、只有控制面信号、最低字段缺失、旧 head / 旧 artifact 复用
- 只有 `gate_applicability.review_lane=governance_landing_pr` 且 formal spec review 未通过时，才必须把 `spec_review_not_completed` 放入 `blocking_reasons`，并保持 `status=blocked`
- 若同一 PR 同时改动 FR-0016 `spec_contract_targets` 或 `TODO.md` handoff 文件，并命中五个治理落库目标文件中的任一项，必须包含 `mixed_spec_and_governance_scope`

### not_applicable

- `status=not_applicable`
- `gate_applicability.in_scope=false`
- `gate_applicability.trigger_reasons=[]`
- `gate_applicability.n_a_allowed=true`
- `blocking_reasons=[]`
- `merge_ready=true`
- `closing_semantics` 可按普通 Issue 闭环语义选择 `n_a`、`refs_only` 或 `fixes_allowed`，但 `review_lane=formal_spec_review_pr` 时必须为 `refs_only`，`review_lane=governance_landing_pr` 或 `review_lane=governance_maintenance_pr` 时不得为 `n_a`
- `live_evidence_record` 允许省略或置为 `null`
- PR 明确不命中任一 `trigger_reasons`，且不以真实 live evidence 作为 issue 关闭、完成判定或 merge 放行依据；formal spec / 治理前置 / 纯文档 / 纯研究 PR 只是典型非适用场景，不是唯一入口
- 一旦命中任一 `trigger_reasons`，就必须回到 `in_scope=true`，不得仅凭文档 / 研究 / 规约属性判为 `not_applicable`

## 最小恢复路径

- formal 输入缺失：
  - 先补 FR-0016 套件并完成 spec review
  - 再恢复治理落库 PR 审查
- 字段缺失或 `N/A` 误用：
  - 回到 PR 描述补齐最低字段
  - 重新触发 reviewer / guardian 复核
- 证据来源错误或控制面信号不足：
  - 重新执行 latest head live 复验
  - 替换为真实浏览器执行面证据后再申请放行

## stop-ship 条件

- 高风险治理落库 PR 仍未经过 formal spec review
- reviewer / guardian 任一侧缺少统一触发集合
- 最低字段清单删掉、重命名或降格为可选任一已冻结 `live_evidence_record` 字段
- `N/A` 仍可被落入专项门禁的 PR 用来规避披露
