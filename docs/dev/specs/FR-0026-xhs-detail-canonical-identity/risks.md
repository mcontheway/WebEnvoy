# FR-0026 风险与边界

## 风险 1：过早把 image_scenes 写成正式 identity

- 表现：
  - 后续实现 PR 直接把 `image_scenes` 写入 identity derivation
- 影响：
  - 把未验证字段写成正式真相
  - 新实现可能围绕错误 identity 收敛
- 缓解：
  - 当前 FR 明确冻结 `note_id` only identity
  - 明确 `image_scenes` 当前只被冻结为 not-in-identity，不扩写 placement 或其他非目标语义

## 风险 2：把“当前不纳入”误解成“永远不纳入”

- 表现：
  - 后续 reviewer 或实现者把 current v1 结论错误理解为永久架构约束
- 影响：
  - 如果未来证据成立，团队会错误地拒绝必要修订
- 缓解：
  - 当前 FR 明确 future revision gate：新证据 + 新 spec 修订

## 风险 3：detail identity 与 #504 scope 混线

- 表现：
  - 后续讨论把 command surface / target-page baseline 与 identity 问题重新混在同一个 PR
- 影响：
  - formal scope 再次漂移
- 缓解：
  - 当前 FR 只回答 identity
  - `#504` 继续负责 command surface 与 request-context baseline

## 风险 4：把 request/artifact 字段误冻结成 current v1 formal truth

- 表现：
  - 后续实现 PR 把 `source_note_id` 的 canonical mapping / alias / derivation 关系，或把 `image_scenes` 直接写成 current v1 formal truth
- 影响：
  - detail canonical identity 被错误扩张
  - `#505` 再次偏离“note_id only + image_scenes not-in-identity + source_note_id 不进入 admitted canonical mapping freeze”的主结论
- 缓解：
  - 当前 FR 只冻结 `note_id` only identity 与 `image_scenes` not-in-identity
  - 明确 `source_note_id` 的 canonical mapping、transport truth、alias、artifact-side derivation、placement、request-context 行为与其他 mapping relation 仍待 future admission-ready 证据和新 spec 修订
  - 明确 detail request-shape truth、shape_key、lookup slotting、route eligibility 与 reuse 语义也必须先经过 `#508` 对应的 formal spec review，不能由单独实现 PR 越权冻结
