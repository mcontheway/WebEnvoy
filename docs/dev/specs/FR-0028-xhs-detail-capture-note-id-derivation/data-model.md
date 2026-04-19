# FR-0028 数据模型边界

## 结论

本 FR 不新增 SQLite 表、迁移或新的持久化真相源。它只冻结 current v1 `xhs.detail` capture admission 在导出 canonical `note_id` 时可接受与不可接受的 derivation source 边界。

## 共享对象

### 1. admitted derivation source

| 对象 | 角色 | 持久化要求 |
| --- | --- | --- |
| `XhsDetailAdmittedCanonicalNoteIdSourceV1` | detail admitted template 的唯一 formal derivation source | 不持久化 |

字段：

| 字段 | 角色 |
| --- | --- |
| `source_kind` | 固定为 `response_candidate_record` |
| `identifier_field` | 当前只允许 `note_id` / `noteId` / `id` |
| `derived_note_id` | trim 后非空 canonical `note_id` |

### 2. candidate-only observation

| 对象 | 当前 formal 状态 |
| --- | --- |
| request-side `source_note_id` | candidate-only |
| `referrer` | candidate-only |
| response metadata / wrapper 上的 note-id-like field | candidate-only |

约束：

- 它们可以保留为 rejected / incompatible observation 的说明性证据。
- 它们不构成 admitted canonical `note_id` truth。
- 它们与 slotting、miss-state、reuse 的正式关系不在本 FR 冻结。

## 不属于本 FR 的对象

- `xhs.detail` canonical identity 本体
- detail request-shape / shape_key / route bucket / lookup slotting
- exact-match / stale / rejected-source / reuse semantics
- candidate observation 的持久化 schema、生命周期与状态机

其中第一项由 `FR-0026` 冻结，其余由 `#508` 承接。
