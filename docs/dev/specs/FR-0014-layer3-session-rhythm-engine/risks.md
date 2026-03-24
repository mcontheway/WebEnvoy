# FR-0014 风险与回滚

## 风险 1：并发 session 造成窗口状态双写

- 场景：
  - 两个 session 同时使用同一 profile/platform/issue_scope，分别推进自己的节律窗口。
- 影响：
  - 冷却、恢复探测、稳定窗口相互覆盖，导致同一 profile 的风险状态失真。
- 缓解：
  - 同一 profile/platform/issue_scope 只允许一个可写窗口真相源。
  - 节律写入必须带 session ownership / fencing 语义。
  - 并发冲突时默认冻结为更保守状态，不做乐观放行。
- 回滚：
  - 发现双写时，将对应 profile 强制回退到 `paused`，并要求重新收敛窗口状态。

## 风险 2：状态漂移导致恢复条件被误判

- 场景：
  - `audit_record`、窗口状态、`runtime.audit` 投影之间时间顺序不一致或存在晚到事件。
- 影响：
  - 系统把未完成冷却误判为可恢复，或把稳定窗口误判为已通过。
- 缓解：
  - 底层真相源必须记录 `recorded_at`、`window_started_at`、`window_deadline_at` 与来源事件。
  - `runtime.audit` 仅投影，不参与写回。
  - 信号冲突时默认回退到更保守状态。
- 回滚：
  - 停止窗口自动推进，保留审计链，人工重算后再恢复。

## 风险 3：误放行 live 动作

- 场景：
  - 恢复探测或稳定窗口条件判断过宽，导致 `limited/paused` 状态下提前放行 live。
- 影响：
  - 账号风险扩大，且与 `FR-0010/0011/#226` 的门禁承诺冲突。
- 缓解：
  - `paused -> limited`、`limited -> allowed` 必须同时满足窗口条件与完整 `approval_record`。
  - 恢复探测失败必须显式延长冷却，不得静默重试。
  - 所有状态升级必须产生可检索的审计事件。
- Stop-ship：
  - 一旦出现“缺审计或缺 approval 仍放行”的实现，直接阻断合并。

## 风险 4：错误恢复导致 session 卡死或反复抖动

- 场景：
  - 浏览器断开、控制平面失联、重复 start/stop/retry 后，窗口状态与运行时真实状态不一致。
- 影响：
  - 节律窗口永远停在恢复中，或在 `paused/limited` 之间抖动。
- 缓解：
  - 恢复判断不得依赖单一 liveness 信号。
  - 需要结合控制信号、执行信号、审计进展与窗口截止时间。
  - 采用失败注入矩阵验证 stale lock / dead controller / alive browser 等组合。
- 回滚：
  - 无法判定时默认冻结 mutating action，仅保留查询，并回退到 `paused`。

## 风险 5：审计失真

- 场景：
  - 新增节律对象后，`audit_record` 与 `session_rhythm_event` 各写一套相近但不一致的信息。
- 影响：
  - reviewer 与上层系统无法判断哪条记录才是正式依据。
- 缓解：
  - `audit_record` 继续承担门禁/审批/状态迁移审计。
  - `session_rhythm_event` 只记录节律事件，不重述已有 approval/audit 语义。
  - 两者通过 `run_id/session_id/profile/source_event_id` 关联。
- Stop-ship：
  - 若实现 PR 出现并行语义重复写入，视为阻断项。

## 风险 6：回滚路径不清晰

- 场景：
  - FR-0014 实现后若发现窗口模型不稳定，但已经改动 `runtime.audit`、存储层和门禁链路。
- 影响：
  - 难以快速回到 `#226` 的最小稳定基线。
- 缓解：
  - 回滚单位应以“新增节律窗口/事件/状态视图”为边界，而不是回退 `FR-0010/0011/#226` 基线。
  - 实现 PR 必须保证关闭新增 Layer 3 引擎后，最小 `risk_state_output` 仍可独立工作。
- 回滚：
  - 关闭新增窗口推进逻辑和 `session_rhythm_status_view` 投影，保留 `#226` 最小状态机输出。
