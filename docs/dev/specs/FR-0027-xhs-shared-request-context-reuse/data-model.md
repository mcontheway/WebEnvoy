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
| `route_scope` | `command + method + pathname` 组成的 route family |

### 2. request-context shape slot

| 对象 | 角色 | 持久化要求 |
| --- | --- | --- |
| `shape slot` | route bucket 内的 exact-shape 容器 | 不持久化 |

字段：

| 字段 | 角色 |
| --- | --- |
| `shape_key` | canonical shape 的稳定 key |

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
- `captured_at` 是三类 observation 的最小 freshness 字段。
- `source_kind`、`rejection_reason` 与 `request_status` 是 `rejected_observation` / `incompatible_observation` 的最小 rejected-source 诊断字段。
- `available_shape_keys` 只反映当前 namespace / route bucket 内可诊断 shape，不构成跨 namespace 共享键。

### 4. read-family canonical shape

| 对象 | 当前 formal 状态 |
| --- | --- |
| `xhs.detail` reuse-shape | `note_id` only |
| `xhs.user_home` reuse-shape | `user_id` only |

约束：

- search-only canonical shape 继续由 `FR-0024` 承载。
- detail identity 继续由 `#505` 承载；本 FR 只冻结其 reuse-shape、artifact-side derivation source 和 slotting 语义。
