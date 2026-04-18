# FR-0026 风险与边界

## 风险 1：过早把 image_scenes 写成正式 identity

- 表现：
  - 后续实现 PR 直接把 `image_scenes` 写入 `shape` / `shape_key`
- 影响：
  - 把未验证字段写成正式真相
  - 新实现可能围绕错误 identity 收敛
- 缓解：
  - 当前 FR 明确冻结 `note_id` only identity
  - 明确 `image_scenes` 只属于 non-identity context

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
