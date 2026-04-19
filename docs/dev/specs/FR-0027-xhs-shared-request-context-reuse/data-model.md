# FR-0027 数据模型边界

## 结论

本 FR 不新增持久化表或迁移。它只冻结 page-local request-context reuse model 的共享实体与状态边界。

## 共享对象

### 1. request-context namespace 与 route bucket

| 对象 | 角色 | 持久化要求 |
| --- | --- | --- |
| `page_context_namespace` | page-local / document-local namespace token | 不持久化 |
| `route bucket` | namespace 内同 route family 的候选容器 | 不持久化 |

字段：

| 字段 | 角色 |
| --- | --- |
| `page_context_namespace` | 页面现场隔离键，不得退化成 command-family 枚举 |
| `route_scope` | `command + method + pathname` 组成的 route family，也是 route bucket identity 的一部分 |

### 2. request-context shape slot

| 对象 | 角色 | 持久化要求 |
| --- | --- | --- |
| `shape slot` | route bucket 内的 exact-shape 容器 | 不持久化 |

字段：

| 字段 | 角色 |
| --- | --- |
| `shape_key` | canonical shape 的稳定 key，也是 shape slot identity 的一部分 |

约束：

- route bucket identity 是 `page_context_namespace + route_scope`。
- shape slot identity 是 `page_context_namespace + shape_key`。
- `route_scope` 只负责当前 namespace 内的 route bucket 选择，不得被并列写成第二套 shape slot identity。

### 3. bucket state

| 对象 | 角色 |
| --- | --- |
| shape slot `admitted_template` | 可复用 page-local admitted template |
| shape slot `rejected_observation` | 最近 rejected source observation |
| route bucket `incompatible_observation` | 最近 incompatible observation |
| `available_shape_keys` | 当前 route bucket 下可诊断 sibling shapes |

约束：

- `admitted_template` 与 `rejected_observation` 只存在于同一 namespace / route bucket / shape slot 下。
- `incompatible_observation` 只存在于同一 namespace / route bucket 下。
- synthetic / failed source 不得进入 `admitted_template`。
- `captured_at` 是 `admitted_template` 的最小 freshness 字段。
- `admitted_template.request_status` 必须固定为 `completion="completed"` 且 `http_status` 为非空 2xx。
- `observed_at` 是 `rejected_observation` / `incompatible_observation` 的最小 observation 时间字段，需与 `FR-0024` 对齐。
- shape-slot `rejected_observation` 的最小字段是显式 `shape` / `shape_key` 锚点、`source_kind`、非空 machine-readable `rejection_reason` 与 `request_status`。
- shape-slot `rejected_observation` 的合法配对必须固定为：`synthetic_request_rejected <-> source_kind=\"synthetic_request\"`，`failed_request_rejected <-> source_kind=\"page_request\"`。
- route-bucket `incompatible_observation` 的最小字段是显式 `shape` / `shape_key` 锚点、`source_kind="page_request"`、`incompatibility_reason="shape_mismatch"` 与 success-only `request_status`。
- `available_shape_keys` 只反映当前 namespace / route bucket 内可诊断 shape，不构成跨 namespace 共享键。
- rejected-only sibling shape 也必须继续出现在 `available_shape_keys` 中；即使没有 success-only `incompatible_observation`，lookup 仍要保留 `shape_mismatch` 的 fail-closed 诊断面。

### 4. read-family canonical shape

| 对象 | 当前 formal 状态 |
| --- | --- |
| `xhs.detail` reuse-shape | `note_id` only |
| `xhs.user_home` reuse-shape | `user_id` only |
| shared observation `shape` | 只允许 `RequestShape` / `XhsDetailReuseShapeV1` / `XhsUserHomeReuseShapeV1` |
| shared observation `shape_key` | 只允许对应 canonical variant 的稳定序列化结果 |

约束：

- search-only canonical shape 继续由 `FR-0024` 承载。
- detail identity 继续由 `#505` 承载；本 FR 只冻结其 reuse-shape 和 slotting 语义。
- detail capture-side canonical `note_id` derivation 当前仍保持 deferred，并已转交 `#510`；`research.md` 只承接“为什么现在还不能 formalize”。
- shared bucket state 中的 `shape` / `shape_key` 不得退化成未约束的 `Record<string, unknown>` / 任意字符串组合。
