# FR-0023 上游授权请求契约

## 边界

本契约定义上游系统进入 WebEnvoy 的第一版正式输入对象：

1. `action_request`
2. `resource_binding`
3. `authorization_grant`
4. `runtime_target`

这些对象共同构成“上游授权输入与请求期 admission 接缝”的正式主骨架。它们服务于 request-time admission，不替代 `FR-0010`、`FR-0011`、`FR-0014` 已冻结的内部 gate、admission evidence、session rhythm 对象。

本契约不定义：

- `dry_run / recon / live_*` 的内部 execution mode
- `FR-0010.gate_input` / `gate_outcome` / `approval_record` / `audit_record`
- `FR-0011.approval_admission_evidence` / `audit_admission_evidence`
- `FR-0014.session_rhythm_*`
- 上游账号运营产品、审批 UI 或长期资源状态机

## 总体约束

1. 上游正式协议必须以“动作 + 资源 + 授权 + 现场”为中心，而不是以内部 execution mode 为中心。
2. `runtime_target` 是现场约束，不是权限主体。
3. `account_ref` / `subject_ref` 只作为治理引用，第一版不得替代 `anonymous_context` 或 `profile_session` 成为执行主体。
4. WebEnvoy 必须在 request-time admission 前验证四个对象彼此一致。
5. 若任一对象缺失、冲突或超出当前 formal 边界，WebEnvoy 必须返回请求级阻断事实。

## action_request

```json
{
  "action_request": {
    "request_ref": "upstream_req_001",
    "action_name": "xhs.read_search_results",
    "action_category": "read",
    "intent": "fetch_search_results",
    "constraint_refs": ["grant_rule_search_read"],
    "requested_at": "2026-04-14T10:00:00Z"
  }
}
```

约束：

1. `action_request` 只表达上游业务动作、动作类别、请求意图与可选约束引用。
2. `action_category` 至少允许：
  - `read`
  - `write`
  - `irreversible_write`
3. `action_category` 与 `FR-0010.gate_input.action_type` 语义兼容，但不直接暴露 `requested_execution_mode`。
4. `action_request` 不得包含 `dry_run`、`recon`、`live_read_limited`、`live_read_high_risk`、`live_write` 等 WebEnvoy 内部 mode。
5. 同一业务动作可在后续由 WebEnvoy 映射到不同内部 execution mode，但该映射不属于上游授权对象本身。

## resource_binding

```json
{
  "resource_binding": {
    "binding_ref": "binding_001",
    "resource_kind": "anonymous_context",
    "profile_ref": null,
    "subject_ref": "subject_xhs_reader_01",
    "account_ref": "account_xhs_reader_01",
    "binding_constraints": {
      "anonymous_required": true,
      "reuse_logged_in_context_forbidden": true
    }
  }
}
```

约束：

1. `resource_kind` 第一版只允许：
  - `anonymous_context`
  - `profile_session`
2. `profile_ref` 仅在 `resource_kind=profile_session` 时允许必填；`anonymous_context` 时必须为空。
3. `subject_ref` / `account_ref` 只允许作为上游治理引用；WebEnvoy 不得仅凭这些字段猜测执行主体。
4. 当 `resource_kind=anonymous_context` 时：
  - `anonymous_required=true`
  - `reuse_logged_in_context_forbidden=true`
  - WebEnvoy 若检测到目标站点当前现场已登录，必须阻断
5. 当 `resource_kind=profile_session` 时：
  - `profile_ref` 必须指向已有本地执行容器 / 会话载体
  - WebEnvoy 可以在已登录上下文下继续进入内部 gate / admission 语义
6. `profile_session` 不扩张为账号矩阵、健康评分、冷却运营或长期资源状态主体。

## authorization_grant

```json
{
  "authorization_grant": {
    "grant_ref": "grant_001",
    "allowed_actions": ["xhs.read_search_results"],
    "binding_scope": {
      "allowed_resource_kinds": ["anonymous_context"],
      "allowed_profile_refs": []
    },
    "target_scope": {
      "allowed_domains": ["www.xiaohongshu.com"],
      "allowed_pages": ["search_result_tab"],
      "allowed_tab_ids": [924]
    },
    "resource_state_snapshot": "paused",
    "grant_constraints": {
      "manual_approval_required": true,
      "cooldown_window_required": true,
      "max_frequency_hint": "1_per_window"
    },
    "approval_refs": ["approval_admission_001"],
    "audit_refs": ["audit_admission_001"],
    "granted_at": "2026-04-14T10:00:00Z"
  }
}
```

约束：

1. `authorization_grant` 只表达上游授予的动作范围与约束。
2. `allowed_actions` 必须显式列出上游允许的业务动作；缺失目标动作时必须阻断。
3. `binding_scope` 必须显式表达 grant 适用的资源范围，至少包括：
  - `allowed_resource_kinds`
  - `allowed_profile_refs`
4. `target_scope` 必须显式表达 grant 适用的现场范围，至少包括：
  - `allowed_domains`
  - `allowed_pages`
  - `allowed_tab_ids`
5. `resource_state_snapshot` 只允许作为上游输入事实，当前至少兼容：
  - `active`
  - `cool_down`
  - `paused`
6. WebEnvoy 不得把 `resource_state_snapshot` 当成自己拥有权威的长期资源状态机。
7. `approval_refs` / `audit_refs` 可以映射到 `FR-0011.approval_admission_evidence` / `audit_admission_evidence` 的第一版兼容承载。
8. `grant_constraints` 只表达上游限制，不直接表达 WebEnvoy 内部 execution mode。
9. 若上游只传入 `account_ref` 而未同时给出合法 `resource_binding.resource_kind`，grant 不得生效。
10. 当 `resource_binding` 或 `runtime_target` 超出 grant 的 `binding_scope` / `target_scope` 时，请求必须阻断，不得降级为“近似匹配”。

## runtime_target

```json
{
  "runtime_target": {
    "target_ref": "target_001",
    "domain": "www.xiaohongshu.com",
    "page": "search_result_tab",
    "tab_id": 924,
    "url": "https://www.xiaohongshu.com/search_result?keyword=camping"
  }
}
```

约束：

1. `runtime_target` 是现场约束，不是权限主体。
2. `domain`、`page`、`tab_id` 与 `url` 用于与当前现场做一致性校验。
3. `domain`、`page`、`tab_id` 必须保持与 `FR-0010.target_domain`、`target_page`、`target_tab_id` 的兼容映射。
4. 若当前现场与 `runtime_target` 不一致，必须在 request-time admission 直接阻断。
5. `runtime_target` 不得被长期持有为资源授权主体，也不得替代 `resource_binding`。

## 兼容映射锚点

1. `action_request.action_category -> FR-0010.gate_input.action_type`
2. `resource_binding.resource_kind + profile_ref -> FR-0010.gate_input.profile` 与后续内部上下文选择
3. `authorization_grant.approval_refs / audit_refs -> FR-0011.approval_admission_evidence / audit_admission_evidence`
4. `runtime_target.domain / page / tab_id -> FR-0010.gate_input.target_domain / target_page / target_tab_id`

## 兼容性

1. 新增字段只允许向后兼容追加可选字段。
2. 若要把 `account_ref` 升级为正式执行主体，必须重新进入独立 spec review。
3. 若要把任何内部 execution mode 暴露为上游正式对象字段，必须重新进入独立 spec review。
4. 若要扩展新的主执行主体、资源状态枚举或现场语义，必须同步更新 `spec.md` 与请求级结果契约。
