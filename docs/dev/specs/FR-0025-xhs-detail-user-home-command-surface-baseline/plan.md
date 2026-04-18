# FR-0025 实施计划

## 实施目标

冻结 `xhs.detail` / `xhs.user_home` 的 current public command surface、canonical command input、target-page baseline，以及它们与 `FR-0023` 四对象输入和请求级结果对象之间的 command-level ownership，为后续 `#500` 实现 PR 与 `#445` closeout 提供稳定正式输入。

## 分阶段拆分

### 阶段 1：baseline 冲突收敛

- 产出：`spec.md`
- 重点：把 `FR-0005` 中关于“detail/user_home 尚无公开命令面”的 dated historical fact 与 current main 实现/测试事实区分开，冻结 current public command surface

### 阶段 2：command-level contract 冻结

- 产出：`contracts/detail-user-home-command-surface.md`
- 重点：冻结 `note_id` / `user_id`、`explore_detail_tab` / `profile_tab`、auto target-tab pinning baseline，以及四对象输入 ownership

### 阶段 3：风险与研究边界收口

- 产出：`research.md`、`risks.md`、`TODO.md`
- 重点：锁定 current implementation 证据、formal 冲突来源与 `#505` 的 deferred scope，避免后续实现 PR 混入 detail identity

### 阶段 4：spec review PR 准备

- 产出：spec-only Draft PR、纯度门禁记录、PR 结构化元数据
- 重点：确保 PR 只承载 `FR-0025` formal suite 与 issue-sync map，不混 runtime/extension/tests 实现

## 实现约束

- 不修改 runtime、extension、CLI、测试实现或真实执行路径代码。
- 不改写 `FR-0023` 的四对象契约，也不新增第二套授权输入。
- 不冻结 `xhs.detail` canonical identity，不碰 `image_scenes` / `CRD_PRV_WEBP`。
- 不在当前 PR 中混入 `#500` 修复、`#445` rerun、live evidence 或 closeout comment。
- 不修改 `FR-0024` search-only formal freeze，只允许引用其 deferred-scope 结论。
- 不改写 `#504/#505` 的 issue 角色。

## 测试与验证策略

- 规约对照：
  - 对照 `src/commands/xhs-runtime.ts`，确认 current main 已公开注册 `xhs.detail` / `xhs.user_home`
  - 对照 `src/commands/xhs-input.ts` 与相关 tests，确认 `note_id` / `user_id`、`target_page`、四对象输入消费方式与 current implementation 一致
  - 对照 `FR-0005` research/TODO，确认该 FR 只把“命令面缺失”降级为 dated historical fact，而不提前关闭 `#445`
  - 对照 `FR-0023`，确认 command-level ownership 不发明第二套授权输入
- 文档门禁：
  - `bash scripts/docs-guard.sh`
  - `bash scripts/spec-guard.sh`
  - `bash scripts/check-pr-purity.sh docs/FR-0025-xhs-detail-user-home-command-surface-baseline main`
  - `git diff --check`
- PR 校验：
  - `Closing=Refs #504`
  - `gate_applicability.review_lane=formal_spec_review_pr`
  - `live_evidence_record=N/A`

## TDD 范围

- 当前 formal suite 不进入实现代码 TDD。
- 后续实现 PR 至少应补齐以下测试矩阵：
  - `xhs.detail` / `xhs.user_home` 的 current command surface 不回退
  - `note_id` / `user_id` 缺失时的入口失败
  - target-page mismatch 与 auto target-tab resolution
  - canonical upstream objects 存在时的 `request_admission_result` / `execution_audit` ownership
  - legacy path 下 `request_admission_result` / `execution_audit` 为 `null` 时的兼容行为

## 并行 / 串行关系

- 可并行：
  - `#505` 的 formal 准备工作
  - 其他不触碰 `FR-0025` 套件的 formal / implementation 事项
- 串行 / 依赖：
  - 后续实现 PR 必须等待 `FR-0025` 与 `#505` 都完成 formal freeze 后再创建
  - `#445` closeout 不能在本 FR 合并后立即重开，仍需等待新实现 PR merge 与 latest-main rerun
  - `#501` 的 superseded 状态只能在新实现 PR 建立后收口

## 进入实现前条件

- FR-0025 spec review 通过。
- reviewer 确认 `xhs.detail` / `xhs.user_home` 已冻结为 current public CLI command surface。
- reviewer 确认 `note_id` / `user_id`、`explore_detail_tab` / `profile_tab` 的 baseline 无阻断歧义。
- reviewer 确认两个命令的四对象输入 ownership 与 current implementation 对齐，且没有第二套授权输入。
- reviewer 确认 `request_admission_result` / `execution_audit` 的 command-level ownership 已冻结。
- reviewer 确认 detail identity 与 `image_scenes` 已显式转交 `#505`。
- 后续实现 issue / PR 已明确为替代 `#501` 的新链路，而不是继续在 `#501` 上补丁。
