# Live Evidence 治理门禁契约

## 边界与适用范围

本契约定义 FR-0016 的稳定共享对象，用于统一作者、reviewer、guardian 与 merge-ready 判定之间的 live evidence 口径。

本契约不定义：

- runtime 实现或验证脚本
- 页面交互行为本身
- GitHub Action / bot 的具体实现
- `#308` / `#309` 的 runtime 契约

## 共享对象

门禁共享输出至少包含以下对象：

1. `gate_applicability`
2. `gate_verdict`

`live_evidence_record` 是条件必选对象：

- 当 `gate_applicability.in_scope=true` 或 `gate_applicability.n_a_allowed=false` 时，必须提供完整 `live_evidence_record`
- 当 `gate_applicability.in_scope=false` 且 `gate_applicability.n_a_allowed=true` 时，允许省略 `live_evidence_record` 或将其置为 `null`，以对应 PR 模板整块填写 `N/A` 的路径

## gate_applicability

描述 PR 是否落入 live evidence 专项门禁。

```json
{
  "gate_applicability": {
    "in_scope": true,
    "trigger_reasons": [
      "merge_unblock_by_live_evidence",
      "real_runtime_claim"
    ],
    "n_a_allowed": false
  }
}
```

非适用 PR 的最小示例：

```json
{
  "gate_applicability": {
    "in_scope": false,
    "trigger_reasons": [],
    "n_a_allowed": true
  }
}
```

触发枚举至少包含：

- `real_runtime_claim`
- `real_page_interaction_claim`
- `live_read_write_claim`
- `issue_closure_by_live_evidence`
- `completion_claim_by_live_evidence`
- `merge_unblock_by_live_evidence`

约束：

1. `in_scope=true` 时，`trigger_reasons` 必须非空。
2. `in_scope=true` 时，`n_a_allowed` 必须为 `false`。
3. `in_scope=false` 时，`trigger_reasons` 必须为空数组。
4. `in_scope=false` 时，`n_a_allowed` 必须为 `true`，以便 formal spec / 治理前置 / 纯文档 / 纯研究 PR 可以稳定填写 `N/A`，避免被默认值误挡。

## live_evidence_record

描述作者在 PR 中提供的最低 live evidence 元数据。

```json
{
  "live_evidence_record": {
    "latest_head_sha": "0227c64a11d58660cff87d153c79648b87664bff",
    "profile": "prod-xhs-a",
    "browser_channel": "Google Chrome stable",
    "execution_surface": "real_browser",
    "page_url": "https://example.com/editor",
    "target_tab_id": 321,
    "run_id": "run_20260401_001",
    "relay_path": "cli->native-messaging->extension->content-script",
    "editor_locator": "[data-testid='editor']",
    "success_signals": [
      "editor_updated",
      "page_reflected_change"
    ],
    "minimum_replay": "Open the page and replay the same write flow on latest head.",
    "artifact_log_ref": "actions://run/123/artifacts/live-evidence.log",
    "failure_reason": "N/A",
    "blocker_level": "N/A"
  }
}
```

非适用 PR 且 `n_a_allowed=true` 时，允许省略该对象，或显式写为：

```json
{
  "live_evidence_record": null
}
```

`execution_surface` 枚举至少包含：

- `real_browser`
- `stub`
- `fake_host`
- `other`

约束：

1. `latest_head_sha` 必须对应当前 PR latest head。
2. `execution_surface=real_browser` 才可能成为有效 live evidence；其余枚举默认无效。
3. 当 evidence 成功时，`failure_reason` 与 `blocker_level` 必须填写 `N/A`。
4. 当 evidence 失败或阻断时，`failure_reason` 与 `blocker_level` 必须为非空，且不得用 `N/A` 规避。
5. `success_signals` 必须描述真实页面交互或真实闭环结果，不能只写控制面存活信号。
6. 仅当 `gate_applicability.in_scope=true` 或 `gate_applicability.n_a_allowed=false` 时，以上字段约束才对 `live_evidence_record` 生效；`in_scope=false && n_a_allowed=true` 的非适用 PR 可以不提供该对象。

## gate_verdict

描述 reviewer / guardian 基于同一契约得出的门禁结论。

```json
{
  "gate_verdict": {
    "status": "blocked",
    "closing_semantics": "refs_only",
    "merge_ready": false,
    "blocking_reasons": [
      "missing_latest_head_fresh_evidence",
      "invalid_execution_surface"
    ]
  }
}
```

`status` 枚举：

- `not_applicable`
- `ready`
- `blocked`

`closing_semantics` 枚举：

- `n_a`
- `refs_only`
- `fixes_allowed`

`blocking_reasons` 至少覆盖：

- `missing_latest_head_fresh_evidence`
- `invalid_execution_surface`
- `control_plane_only_signal`
- `missing_required_fields`
- `stale_head_or_artifact`
- `spec_review_not_completed`

约束：

1. 只要 `blocking_reasons` 非空，`status` 就必须为 `blocked`；不得因为 `gate_applicability.in_scope=false` 而把 `spec_review_not_completed` 等阻断原因降格为 `not_applicable`。
2. `status=blocked` 时，`closing_semantics` 必须为 `refs_only`，且 `merge_ready=false`。
3. 只有 `status=ready` 时，`closing_semantics` 才允许为 `fixes_allowed`。
4. `status=not_applicable` 时，`blocking_reasons` 必须为空，且 `gate_applicability.in_scope=false`。
5. formal spec review 未通过时，治理落库 PR 即使 `gate_applicability.in_scope=false`，也必须在 `blocking_reasons` 中包含 `spec_review_not_completed`，并产出 `status=blocked`。

## 兼容性约束

1. 新增触发原因或阻断原因只能追加，不能改变既有语义。
2. `live_evidence_record` 的最低字段清单只允许追加；不得删除、重命名或降格为可选本契约已冻结的任一字段，包括 `latest_head_sha`、`profile`、`browser_channel`、`execution_surface`、`page_url`、`target_tab_id`、`run_id`、`relay_path`、`editor_locator`、`success_signals`、`minimum_replay`、`artifact_log_ref`、`failure_reason`、`blocker_level`。
3. 若未来新增自动校验器，也必须消费同一套共享对象，而不是自创另一套触发集合。
