# FR-0026 数据模型边界

## 结论

本 FR 不新增 SQLite 表、迁移或新的持久化真相源。它只冻结 current v1 `xhs.detail` identity 与 exclusion boundary；observed request/artifact 字段继续保持未冻结状态。

## 共享对象

### 1. canonical identity

| 对象 | 角色 | 持久化要求 |
| --- | --- | --- |
| `XhsDetailCanonicalIdentityV1` | current v1 detail identity 真相源 | 不持久化 |

字段：

| 字段 | 角色 |
| --- | --- |
| `note_id` | current v1 唯一 canonical identity 字段 |

### 2. observed request/artifact field

| 对象 | 当前 formal 状态 |
| --- | --- |
| `/api/sns/web/v1/feed` request body `source_note_id` | current-detail artifact observed field; resolves to canonical `note_id` value when consumed as an admitted detail artifact, but does not become a second identity field |

约束：

- 当前 formal 只冻结它在 current-detail artifact 中到 canonical `note_id` 的最小值解析关系
- 不新增第二个 identity 字段
- 不冻结更广 transport alias、placement、route admission、compatibility 或其他 normalization 语义

### 3. exclusion boundary

| 候选字段 | 当前 formal 状态 |
| --- | --- |
| `image_scenes` | not-in-identity |

约束：

- 本 FR 只冻结这些候选字段当前不得进入 current v1 identity
- 本 FR 不冻结这些字段的 placement、输出位置或其他非 identity shape
- 不得参与 current v1 formal identity derivation

## 不属于本 FR 的对象

- detail command surface
- target-page baseline
- 四对象输入 ownership
- detail/user_home request-context baseline
- 更广 `source_note_id` transport alias / placement / route admission / normalization 规则
- compatibility、rejected-source matching、template reuse 等 request-context 行为

其中前四项已由 `#504` / FR-0025 冻结；后两项必须由后续实现 FR / 实现 PR 在消费 `#504 + #505` 后继续回答，不在本 FR 重新定义。
