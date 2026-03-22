# FR-0011 风险与回滚

## 风险 1：门禁仍停留在文档，未形成执行约束

- 触发条件：实现阶段绕过 FR-0011 契约对象，继续口头放行 live。
- 影响：`#208/#209` 恢复路径失真，账号风险继续放大。
- 缓解：
  - 以 `contracts/anti-detection-execution.md` 作为实现前置。
  - 在进入实现前条件中要求状态机与模式规则可测试。
- 回滚：
  - 恢复默认 `dry_run/recon`。
  - 阻断任何高风险 live 开关。

## 风险 2：插件层门禁责任不清导致实现漂移

- 触发条件：把核心门禁下沉到 CLI 参数层或散落在多个模块。
- 影响：审计不可追踪，执行行为不可控。
- 缓解：
  - 明确 background/content-script/main world 责任边界。
  - 禁止 “CLI 主判定” 语义。
- 回滚：
  - 回到 `plugin_gate_ownership` 契约重审后再进实现。

## 风险 3：状态机定义过粗导致误放行

- 触发条件：仅有状态名，没有迁移条件和硬阻断对象。
- 影响：`paused` 状态仍可能执行高风险动作。
- 缓解：
  - 冻结最小迁移规则与 `hard_block_when_paused`。
  - 将缩减阻断项视为 spec review 阻断。
- 回滚：
  - 强制恢复到 `paused` 并仅允许 `recon`。

## Stop-Ship 条件

- FR-0011 spec review 未通过却启动实现 PR。
- `paused` 状态仍允许高风险 live 写动作。
- `#208` 在未接入 FR-0011 前置前恢复 live 正式验证。
