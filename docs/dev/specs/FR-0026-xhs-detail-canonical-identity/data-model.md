# FR-0026 数据模型边界

## 结论

本 FR 不新增 SQLite 表、迁移或新的持久化真相源。它只冻结 current v1 `xhs.detail` identity 与 non-identity context 的边界。

## 共享对象

### 1. canonical identity

| 对象 | 角色 | 持久化要求 |
| --- | --- | --- |
| `XhsDetailCanonicalIdentityV1` | current v1 detail identity 真相源 | 不持久化 |

字段：

| 字段 | 角色 |
| --- | --- |
| `command` | 固定为 `xhs.detail` |
| `note_id` | current v1 唯一 canonical identity 字段 |

### 2. non-identity context

| 字段 | 角色 |
| --- | --- |
| `image_scenes` | diagnostics / compatibility context |
| `CRD_PRV_WEBP` | diagnostics / compatibility context |

约束：

- 这些字段都不得进入 current v1 identity
- 不得参与 `shape` / `shape_key` / eligibility

## 不属于本 FR 的对象

- detail command surface
- target-page baseline
- 四对象输入 ownership
- detail/user_home request-context baseline

这些对象属于 `#504`，不在本 FR 重新定义。
