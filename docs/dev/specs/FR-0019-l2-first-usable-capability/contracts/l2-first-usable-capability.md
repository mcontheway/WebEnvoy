# FR-0019 契约：L2 首次可用能力

## 1. `l2_first_usable_request`

```ts
interface L2FirstUsableRequest {
  target_url: string
  goal_kind: "read" | "write" | "download"
  goal_hint?: string
  allowed_actions: Array<"navigate" | "snapshot" | "click" | "type" | "extract" | "wait_settled">
}
```

约束：

- `goal_kind` 必须与 Phase 2 共享能力面保持一致：`read` / `write` / `download`。
- 本 FR 中的最小基础交互统一归入 `write`，但不等于恢复高风险 live 写路径或账号敏感提交。
- `download` 在当前 FR 中允许保持模型预留，但不得从对象边界中缺位。

## 2. `l2_first_usable_result`

```ts
interface L2FirstUsableResult {
  success: boolean
  result_summary?: Record<string, unknown>
  first_usable_trace?: string[]
  interaction_trace?: string[]
  capture_hints?: Record<string, unknown>
  candidate_shell_seed?: Record<string, unknown>
  failure_class?: "insufficient_semantic_structure" | "target_not_located" | "state_not_settled" | "risk_gate_blocked" | "requires_l1_fallback"
}
```

约束：

- `candidate_shell_seed` 只作为进入 `FR-0017` 的 handoff 输入。
- `success=true` 时，必须同时具备结构化结果与 handoff 输入。
- `failure_class` 只表达最小失败大类，不替代低层错误码或诊断全文。
