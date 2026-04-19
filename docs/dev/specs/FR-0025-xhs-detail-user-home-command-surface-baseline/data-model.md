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
| `ability.id` / `ability.layer` / `ability.action` | `xhs.detail` / `xhs.user_home` | caller-facing public CLI ability envelope |
| `note_id` | `xhs.detail` | 唯一 required canonical command input |
| `user_id` | `xhs.user_home` | 唯一 required canonical command input |

### 3. canonical top-level FR-0023 object set

| 对象 | 角色 | 持久化要求 |
| --- | --- | --- |
| `action_request` | canonical caller-facing upstream action object | 不持久化 |
| `resource_binding` | canonical caller-facing upstream binding object | 不持久化 |
| `authorization_grant` | canonical caller-facing upstream grant object | 不持久化 |
| `runtime_target` | canonical caller-facing runtime target object | 不持久化 |

约束：

- 四个对象在 current caller-facing CLI baseline 中保持顶层输入形态
- canonical top-level path 下，`ability.id` 必须继续映射到 `xhs.detail -> xhs.note.detail.v1`、`xhs.user_home -> xhs.user.home.v1`
- canonical top-level path 下，`ability.action` 必须继续与 upstream `action_request.action_category=read` 对齐
- `options.upstream_authorization_request` 继续保留为 current command/runtime payload 的兼容 mirror 与现有调用路径
- 它不得替代四个顶层对象 ownership truth，也不构成新的独立 formal object family

### 4. request-level result view

| 对象 | 角色 | 持久化要求 |
| --- | --- | --- |
| `request_admission_result` | 请求级 admission 结果 | 不新增持久化真相源 |
| `execution_audit` | 请求级执行证据 | 不新增持久化真相源 |

约束：

- 二者只保留 command-level ownership
- current compatibility behavior 中允许对象 / 显式 `null` / 缺失三种结果形态
- 不升级成长期资源状态或 replay/store truth

## 不属于本 FR 的对象

- `xhs.detail` canonical identity
- `image_scenes`
- `CRD_PRV_WEBP`
- detail/user_home request-shape truth
- successor detail implementation path 的 shared request-context minimal invariants
- successor detail implementation path 的 detail capture-side canonical `note_id` derivation / admitted-derivation truth

其中 `xhs.detail` canonical identity baseline 由 `#505` 冻结；shared request-context minimal invariants 与 successor implementation shared gate 由 `#508` 承接；`#510` 继续只作为 successor detail implementation path 的 required detail-path gate 引用，本 FR 不在此重述其 owning suite scope。后续实现 PR 必须在消费 `#504 + #505` merged baselines 的前提下继续等待 `#508 + #510`，而不是由单独实现 PR 越权定义这些内容。
