# FR-0017 风险与回滚

## 主要风险

### 1. 临时样本被误写成正式能力

- 风险：一次临时成功路径缺少最小契约与来源证据，却被长期保存并当作正式候选能力使用。
- 缓解：
  - 冻结 `draft_candidate` / `candidate_ready` 的最小区分
  - 强制 `capture_run_id`
  - `capture_artifact_refs` 仅作为补充 evidence refs，不提前假定上游 artifact carrier 已冻结

### 2. L3 / L2 双轨协议漂移

- 风险：L3 和 L2 分别发明自己的能力描述协议，后续验证与交付无法统一。
- 缓解：
  - `capture_origin` 与 `execution_layer_support` 只作为单模型内的差异字段

### 3. 过早混入验证与交付语义

- 风险：候选能力描述被扩张成验证记录、导入协议或版本治理对象，导致 Phase 2 范围失控。
- 缓解：
  - 在 `spec.md`、`plan.md`、`contracts/` 中明确非目标

### 4. 下载能力在模型层缺位

- 风险：当前主闭环集中在读/写，下载能力被遗漏，后续再次形成特殊分支。
- 缓解：
  - 在 `ability_kind` 中冻结 `download`

## 回滚原则

- 若 reviewer 认为候选能力描述仍与验证/导入耦合过深，应回退到只冻结最小字段，不强推更宽的生命周期。
- 若 reviewer 认为下载能力当前不应进入统一模型，必须先给出与 roadmap 一致的替代安排；不能直接删除统一表达要求。
