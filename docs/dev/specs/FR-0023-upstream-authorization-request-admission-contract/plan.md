# FR-0023 实施计划

## 实施目标

把 `#470` 的决策结论冻结成 `#472` 可 review 的 formal suite，明确上游授权输入、资源绑定、请求期 admission 与请求级执行审计的正式边界，为后续实现建立不需要再次口头补充的 mapping 输入。

## 分阶段拆分

### 阶段 1：外部 contract 冻结

- 产出：`spec.md`、`contracts/upstream-authorization-request-contract.md`
- 重点：冻结 `action_request`、`resource_binding`、`authorization_grant`、`runtime_target`

### 阶段 2：请求级结果与内部语义收口

- 产出：`contracts/request-admission-result.md`
- 重点：冻结 `request_admission_result`、`execution_audit`，并明确 `dry_run / recon / live_*`、request-time admission、session rhythm 仍归 WebEnvoy 内部运行时

### 阶段 3：兼容迁移与风险收口

- 产出：`research.md`、`risks.md`、`TODO.md`
- 重点：明确 `FR-0010/0011/0014` 的迁移映射、匿名约束、上游状态归属与实现前 review 关注点

### 阶段 4：spec review 准备

- 产出：spec review PR、验证记录、纯度门禁结果
- 重点：确保 PR 只承载 `FR-0023` formal suite，不混入实现代码、治理文件、`FR-0016` 或 rerun / bugfix 范围

## 实现约束

- 不修改实现代码、脚本逻辑、runtime command surface 或现有 live 路径行为。
- 不修改 `FR-0016` 或治理五文件。
- 不把 `#445` fresh rerun、`#468` 修复或 live evidence closeout 混入本 FR。
- 不把上游资源策略状态扩写成 WebEnvoy 长期运营状态机。
- 第一版主执行主体只冻结 `anonymous_context` 与 `profile_session`；`account_ref` / `subject_ref` 只保留为上游治理引用。

## 测试与验证策略

- 规约对照：
  - 对照 `#470` 决策纪要，确认 4 个外部对象与资源边界一致
  - 对照 `FR-0010/0011/0014`，确认内部 gate / admission evidence / session rhythm 仍保持既有 ownership
  - 对照 `vision.md` 与架构文档，确认本 FR 未越界成账号运营产品
  - 对照 integration 锚点 `#464`，确认本 FR 作为 `runtime_modes` 共享契约事项的 integration-gated 口径仍成立
- 门禁校验：
  - `bash scripts/docs-guard.sh`
  - `bash scripts/spec-guard.sh`
  - `bash scripts/check-pr-purity.sh docs/472-upstream-authorization-contract-spec main`
- PR 校验：
  - `integration_check` 使用 integration-gated 口径，并绑定本地 integration issue `#464`
  - `gate_applicability.review_lane=formal_spec_review_pr`
  - `live_evidence_record=N/A`

## TDD 范围

- 当前只冻结正式规约，不进入实现代码 TDD。
- 后续实现时优先为以下 mapping 层补测试：
  - 上游 4 对象到 `FR-0010.gate_input` 的归一化映射
  - 匿名请求命中登录态时的阻断逻辑
  - `authorization_grant` 到 `FR-0011` admission evidence 的兼容映射
  - request-time admission 与 `FR-0014` session rhythm 的追溯一致性

## 并行 / 串行关系

- 可并行：
  - `#468` 的实现修复工作
  - 其他不触碰 `FR-0023` 套件的 formal / implementation 事项
- 串行 / 依赖：
  - `#472` 的后续实现必须等待本 FR spec review 通过
  - 本 FR 合并前必须再次核对 integration issue `#464` 的状态与联动语义
  - `#445` rerun 只能在实现修复与授权输入 mapping 同时具备后重开
  - 若 reviewer 发现与 `FR-0010/0011/0014` 的 ownership 冲突，必须先收口本 FR 再继续实现

## 进入实现前条件

- FR-0023 spec review 通过。
- reviewer 确认第一版主执行主体只包含 `anonymous_context` 与 `profile_session`，`account_ref` 仍是治理引用。
- reviewer 确认匿名请求不得落入目标站点已登录上下文的约束已无阻断歧义。
- reviewer 确认上游资源策略状态与 WebEnvoy 请求级事实之间的边界已清楚。
- reviewer 确认 `FR-0010/0011/0014` 的兼容迁移表无阻断争议。
- 后续实现 issue 已按“contract mapping -> runtime admission mapping -> legacy compatibility”拆分，而不是直接修改运行时代码闭眼收口。
