# FR-0025 研究记录

## 研究问题

`#504` 要解决的不是 search request-shape，而是：

1. current main 上 `xhs.detail` / `xhs.user_home` 是否已经属于公共命令面
2. 它们当前如何消费 `FR-0023` 四个顶层对象输入
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
  - `parseAbilityEnvelopeForContract()` 当前仍要求 caller-facing `ability.id/layer/action` envelope
  - legacy public CLI path 当前只校验 `ability.layer` / `ability.action` 为合法枚举值，不把 non-`L3/read` 作为通用硬阻断
  - `parseXhsCommandInputForContract()` 当前按 `command` 分派到 detail / user_home shared parser，而不是在 legacy path 先强制校验 canonical ability id
  - `xhs.note.detail.v1` 只允许 `explore_detail_tab`
  - `xhs.user.home.v1` 只允许 `profile_tab`
  - `normalizeGateOptionsForContract()` 在 legacy public CLI contract 下要求显式 `target_domain`、`target_tab_id`、`target_page`、`requested_execution_mode`
  - `normalizeGateOptionsForContract()` 在 canonical top-level `FR-0023` path 下继续从 `runtime_target` 派生 `target_domain`、`target_tab_id`、`target_page`，并推导 `requested_execution_mode`
  - `ACTION_NAME_COMMAND_MISMATCH` 只在 canonical top-level `FR-0023` path 下执行 command-to-action 对齐，不构成 legacy path 的通用 ability-mismatch 阻断

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
- legacy public CLI path 的 `ability.layer` / `ability.action` 只能冻结为 caller-facing envelope 存在性与枚举合法性；`L3/read` 只适合冻结在 canonical top-level path 与 current shared runtime / contract output metadata 的对齐边界。
- 当前 formal freeze 只能冻结两条现有入口的真实边界：
  - legacy public CLI path：`target_domain`、`target_tab_id`、`target_page`、`requested_execution_mode` 仍需显式提供
  - canonical top-level path：shared gate fields 继续从 `runtime_target` 与 current parser 行为派生，不另起第二套输入
- canonical shared-path ability 映射当前存在，但 formal 只能把它冻结为 canonical top-level path 与 current runtime / contract output 的对齐边界；legacy path 上观察到的非 canonical `ability.id` 行为只能保留为实现观测，不能被 formal 申报为受支持公共契约

### 4. current implementation 已消费 FR-0023 四个顶层对象输入

- `src/commands/xhs-input.ts`
  - detail/user_home 通过同一套 caller-facing envelope 消费 canonical top-level `FR-0023` 四个对象
  - `XHS_COMMAND_ACTION_NAMES` 只为 `xhs.detail::xhs.note.detail.v1` 与 `xhs.user_home::xhs.user.home.v1` 提供 canonical action-name 映射；canonical top-level path 下非 canonical `ability.id` 会直接触发 `ABILITY_COMMAND_UNSUPPORTED`
  - current parser 会把这四个顶层对象归一化到 `options.upstream_authorization_request` 供下游消费；这个 nested mirror 已经是 current command/runtime payload 的现有调用路径之一，不能在 formal 中被降格为 internal-only
  - command-level action mapping 已对齐 `xhs.read_note_detail` / `xhs.read_user_home`
  - canonical top-level path 下若 `ability.action` 与 upstream `action_request.action_category` 投影出的 read-side action 不一致，会触发 `ACTION_NAME_COMMAND_MISMATCH`
  - `requested_execution_mode` 在 canonical top-level path 下继续由 parser / runtime 推导，而不是 `FR-0023` top-level object family 的新增正式字段
- `src/commands/xhs-runtime.ts`
  - 若 bridge payload 已产出 `request_admission_result` / `execution_audit`，summary / error details 会按 current implementation 透传到 canonical slot
- `tests/content-script-handler.xhs-read.contract.test.ts`
  - canonical top-level path 下已存在 `request_admission_result` 为 allowed 但 `execution_audit` 仍为 `null` 的 current behavior

结论补充：

- canonical top-level path 的四对象 ownership 已存在，但它不是 detail/user_home 唯一的 command-level input model
- legacy public CLI path 在 current main 上仍然存在，formal 只能把四对象 ownership 限定为“当 canonical top-level path 存在时”的规则
- canonical top-level path 的 `ability.id` / `ability.action` 约束比 legacy path 更严格：它必须命中 canonical shared-path ability，并与 upstream read action 对齐
- 当前仓库没有证据支持把 nested `options.upstream_authorization_request` 写成可替代四个顶层对象 ownership truth 的独立 formal object family
- `request_admission_result` / `execution_audit` 在 current compatibility behavior 中允许对象 / 显式 `null` / 缺失三种结果形态；formal 只能冻结 canonical slot / 位置约束，不能把显式 `null` 收窄为非法

### 5. 与 FR-0005 的 formal 冲突

- `docs/dev/specs/FR-0005-xhs-read-spike/research.md`
  - fixed sample 中仍把“detail/user_home 无公开命令面”记作 dated historical fact
- `docs/dev/specs/FR-0005-xhs-read-spike/TODO.md`
  - 仍把“提供或维持正式命令面与 replay 路径”写成未完成事项

结论：

- 这些表述必须被降格为 fixed sample head `eca28babebe929821aa20fbb113b2f94d6ce4f49` 的 dated historical fact，不能继续充当 current main command-surface truth
- 当前 FR 会连同同 PR 内的最小 `FR-0005` backwrite，一并把 `#504` 的 command-surface / request-context baseline 收成单一 formal truth
- `#445` 的正式收口仍待后续 latest-main fresh rerun 与 headers matrix 证据补齐；本 FR 不改写其 live blocker 语义

## 对 #505 的输入

本研究只证明：

- current main 的 command surface 已存在
- command-level ownership 已存在

本研究不证明：

- `xhs.detail` canonical identity 应包含哪些字段
- `image_scenes` 是否需要进入 shape

这些问题必须继续转交 `#505`。
