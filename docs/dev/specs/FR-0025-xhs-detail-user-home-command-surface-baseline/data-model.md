# FR-0025 数据模型边界

## 结论

本 FR 不新增 SQLite 表、迁移或新的持久化实体。它只冻结 current main 上 `xhs.detail` / `xhs.user_home` command surface 与 command-level request-context baseline。

## 共享对象

### 1. command baseline view

| 对象 | 角色 | 持久化要求 |
| --- | --- | --- |
| `xhs.detail` command baseline | current public command surface 的正式视图 | 不持久化 |
| `xhs.user_home` command baseline | current public command surface 的正式视图 | 不持久化 |

### 2. canonical command input

| 字段 | 命令 | 角色 |
| --- | --- | --- |
| `note_id` | `xhs.detail` | 唯一 required canonical command input |
| `user_id` | `xhs.user_home` | 唯一 required canonical command input |

### 3. request-level result view

| 对象 | 角色 | 持久化要求 |
| --- | --- | --- |
| `request_admission_result` | 请求级 admission 结果 | 不新增持久化真相源 |
| `execution_audit` | 请求级执行证据 | 不新增持久化真相源 |

约束：

- 二者只保留 command-level ownership
- 不升级成长期资源状态或 replay/store truth

## 不属于本 FR 的对象

- `xhs.detail` canonical identity
- `image_scenes`
- `CRD_PRV_WEBP`
- detail/user_home request-shape truth

这些对象全部属于 `#505` 或后续实现 FR，而不是本 FR。
