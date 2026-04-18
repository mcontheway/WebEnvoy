# FR-0025 研究记录

## 研究问题

`#504` 要解决的不是 search request-shape，而是：

1. current main 上 `xhs.detail` / `xhs.user_home` 是否已经属于公共命令面
2. 它们当前如何消费 `FR-0023` 四对象输入
3. 为什么 `FR-0005` 里“缺失公开命令面”的表述不能继续作为 current blocker

## 当前仓库证据

### 1. current main 已公开注册两个命令

- `src/commands/xhs-runtime.ts`
  - 已注册 `xhs.detail`
  - 已注册 `xhs.user_home`

### 2. current main 已冻结 canonical command input 与 target-page baseline

- `src/commands/xhs-input.ts`
  - `parseDetailInputForContract()` 要求 `note_id`
  - `parseUserHomeInputForContract()` 要求 `user_id`
  - `parseXhsCommandInputForContract()` 当前按 `command` 分派到 detail / user_home shared parser，而不是在 legacy path 先强制校验 canonical ability id
  - `xhs.note.detail.v1` 只允许 `explore_detail_tab`
  - `xhs.user.home.v1` 只允许 `profile_tab`
  - `normalizeGateOptionsForContract()` 在 legacy public CLI contract 下要求显式 `target_domain`、`target_tab_id`、`target_page`、`requested_execution_mode`
  - `normalizeGateOptionsForContract()` 在 canonical `upstream_authorization_request` path 下继续从 `runtime_target` 派生 `target_domain`、`target_tab_id`、`target_page`，并推导 `requested_execution_mode`
  - `ACTION_NAME_COMMAND_MISMATCH` 只在 canonical `upstream_authorization_request` path 下执行 command-to-action 对齐，不构成 legacy path 的通用 ability-mismatch 阻断

### 3. current tests 已证明 command surface 与 unified read path 存在

- `tests/content-script-handler.xhs-read.contract.test.ts`
  - `xhs.detail` / `xhs.user_home` 通过 unified read execution path
- `tests/extension.service-worker.gate-approval.suite.ts`
  - 存在 background/extension direct path 的 tab resolution 行为
- `src/commands/__tests__/xhs.test.ts`
  - wrong target-page 会被 reject
- `tests/extension.contract.test.ts`
  - bundled classic module 和 live-read path 都已覆盖 detail/user_home

结论补充：

- 上述 background/extension direct path 行为不能直接提升为 public CLI 输入契约。
- 当前 formal freeze 只能冻结两条现有入口的真实边界：
  - legacy public CLI path：`target_domain`、`target_tab_id`、`target_page`、`requested_execution_mode` 仍需显式提供
  - canonical upstream path：shared gate fields 继续从 `runtime_target` 与 current parser 行为派生，不另起第二套输入
- canonical shared-path ability 映射当前存在，但 formal 只能把它冻结为 canonical upstream path 与 current runtime / contract output 的对齐边界；legacy path 上观察到的非 canonical `ability.id` 行为只能保留为实现观测，不能被 formal 申报为受支持公共契约

### 4. current implementation 已消费 FR-0023 四对象输入

- `src/commands/xhs-input.ts`
  - detail/user_home 通过同一套 envelope 消费 canonical `upstream_authorization_request`
  - command-level action mapping 已对齐 `xhs.read_note_detail` / `xhs.read_user_home`
- `src/commands/xhs-runtime.ts`
  - 若 bridge payload 已产出 `request_admission_result` / `execution_audit`，summary / error details 会按 current implementation 透传到 canonical slot
- `tests/content-script-handler.xhs-read.contract.test.ts`
  - canonical upstream path 下已存在 `request_admission_result` 为 allowed 但 `execution_audit` 仍为 `null` 的 current behavior

结论补充：

- canonical upstream path 的四对象 ownership 已存在，但它不是 detail/user_home 唯一的 command-level input model
- legacy public CLI path 在 current main 上仍然存在，formal 只能把四对象 ownership 限定为“当 canonical upstream request 存在时”的规则

### 5. 与 FR-0005 的 formal 冲突

- `docs/dev/specs/FR-0005-xhs-read-spike/research.md`
  - fixed sample 中仍把“detail/user_home 无公开命令面”记作 dated historical fact
- `docs/dev/specs/FR-0005-xhs-read-spike/TODO.md`
  - 仍把“提供或维持正式命令面与 replay 路径”写成未完成事项

结论：

- 这些表述只能继续保留为 historical fact
- 它们不能再作为 current main 的 command-surface blocker
- 但它们也不等于 `#445` 已可 closeout；`#445` 仍受 live primary success 与 headers matrix 阻断

## 对 #505 的输入

本研究只证明：

- current main 的 command surface 已存在
- command-level ownership 已存在

本研究不证明：

- `xhs.detail` canonical identity 应包含哪些字段
- `image_scenes` 是否需要进入 shape

这些问题必须继续转交 `#505`。
