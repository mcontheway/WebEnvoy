# FR-0024 实施计划

## 实施目标

冻结 XHS read path 的统一 request-shape truth，把 `xhs.search`、`xhs.detail`、`xhs.user_home` 的 request-context 边界从局部启发式修补提升为 formal contract，为后续新实现 PR 提供可直接执行的共享输入。

## 分阶段拆分

### 阶段 1：共享 blocker 与范围归属冻结

- 产出：shared blocker issue `#502`、`FR-0024` 目录与 canonical issue 绑定
- 重点：明确 `#445` 继续 closeout-only，`#489/#500` 继续作为 blocker，`#501` 只保留为既有实现尝试与 review 证据来源

### 阶段 2：single truth contract 冻结

- 产出：`spec.md`、`contracts/request-context-shape.md`
- 重点：冻结 `RequestShape`、`RequestShapeKey`、`CapturedRequestTemplateRecord`、`TemplateLookupResult`、`RequestContextMissReason`

### 阶段 3：data model、风险与研究收口

- 产出：`data-model.md`、`risks.md`、`research.md`、`TODO.md`
- 重点：明确 page-local runtime artifact 边界、guardian 驳回轨迹、fail-closed 规则与实现前 review blockers

### 阶段 4：spec review PR 准备

- 产出：spec-only Draft PR、纯度门禁记录、PR 结构化元数据
- 重点：确保 PR 只承载 `FR-0024` formal suite，不混入 runtime 实现、guardian rerun、live rerun 或 closeout 回写

## 实现约束

- 不修改 runtime、extension、CLI、测试实现或真实执行路径代码。
- 不把 `CapturedRequestTemplateRecord` 扩写为持久化 replay/store truth。
- 不改变 public CLI/API surface。
- 不在当前 formal spec review PR 中混入 `#489/#500` 的实现修复、`#445` closeout 或 rerun 证据。
- 不继续在 `#501` 上叠补丁；后续实现必须新开 PR。
- explicit reacquire 不属于当前 FR 范围。

## 测试与验证策略

- 规约对照：
  - 对照 `vision.md`，确认本 FR 仍属于浏览器内执行与稳定可集成契约边界，不越界成平台无关 replay/store 设计
  - 对照 `docs/dev/architecture/system-design/read-write.md`，确认 request template 仍然属于页面内真实请求上下文，而非外部 HTTP 出口
  - 对照 `FR-0018`，确认 page-local captured template 不会漂移成 replay truth
  - 对照 `#502`、`#489`、`#500`、`#501` 的 blocker 语义，确认 formal suite 没有提前宣称实现完成
- 文档门禁：
  - `bash scripts/docs-guard.sh`
  - `bash scripts/spec-guard.sh`
  - `bash scripts/check-pr-purity.sh docs/FR-0024-xhs-request-shape-truth main`
  - `git diff --check`
- PR 校验：
  - `Closing` 必须使用 `Refs #502`
  - `gate_applicability.review_lane=formal_spec_review_pr`
  - `live_evidence_record=N/A`
  - `integration_check` 按本仓库 local-only spec review 路径填写

## TDD 范围

- 当前 formal suite 不进入实现代码 TDD。
- 后续实现 PR 至少应优先补齐以下表驱动测试：
  - `xhs.search` 在 `keyword/page/page_size/sort/note_type` 维度上的 exact match / mismatch
  - `xhs.detail` 在 `source_note_id + image_scenes` 维度上的 body 兼容性
  - `xhs.user_home` 在 `user_id` 维度上的 exact match / mismatch
  - page-local namespace 隔离，不同页面现场即使 `shape_key` 相同也不能互相命中
  - rejected-attempt diagnostics 到 `rejected_source` 的可达路径
  - synthetic request 污染、failed request 污染、freshness miss、fail-closed 行为
  - `RequestShapeKey` 稳定序列化与 lookup/eligibility 共用同一 truth

## 并行 / 串行关系

- 可并行：
  - 其他不触碰 `FR-0024` 套件的 formal / implementation 事项
  - `#445` 的 closeout 准备性整理，但不得承载这次 request-context 设计修复
- 串行 / 依赖：
  - 新实现 PR 必须等待 `FR-0024` spec review 通过后再创建
  - `#489/#500` 只能在新实现 PR 合并并完成 latest-main live rerun 后关闭
  - `#445` 的 credible Go 必须等待 request-context blocker 真正消失，不能用当前 formal suite 直接 closeout
  - `#501` 不再作为继续补丁的载体；其 superseded 状态需在新实现 PR 建立后收口

## 进入实现前条件

- FR-0024 spec review 通过。
- reviewer 确认 `capture -> cache key -> lookup -> eligibility` 四阶段共享同一份 `RequestShape` truth。
- reviewer 确认有效缓存身份显式包含 page-local namespace，而不是把裸 `shape_key` 当成跨页面全局主键。
- reviewer 确认 `xhs.search` canonical identity 至少覆盖 `keyword/page/page_size/sort/note_type`。
- reviewer 确认 `note_type` 在进入 `RequestShapeKey` 前已冻结为单一 canonical integer 表示。
- reviewer 确认 `xhs.detail` canonical identity 显式包含 `image_scenes`，不再允许 body 整包混用。
- reviewer 确认 `xhs.detail` 当前 baseline 的 `image_scenes` 派生规则已冻结，且可在网络活动前导出稳定 shape。
- reviewer 确认 `xhs.user_home` 当前 identity 只包含 `user_id`，且 query/header 变体不会被误写成 identity。
- reviewer 确认 exact template miss 的正式规则是 fail closed，而不是 silent synthetic fallback。
- reviewer 确认 `incompatible` 与 `rejected_source` 都具有 shape-level、可实现的数据来源，而不是不可达分支。
- reviewer 确认 page-local captured template 与 `FR-0018` replay truth 的 ownership 边界无阻断歧义。
- 后续实现 issue / PR 已明确为新的实现链路，而不是回到 `#501` 继续叠补丁。
