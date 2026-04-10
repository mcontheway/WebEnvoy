# FR-0020 实施计划

## 实施目标

把 `#239` 从横切主线 issue 收口为正式 FR，冻结反风控验证与 baseline 评估的最小共享对象，供 `FR-0012/0013/0014` 与后续 Layer 4 复用。

## 分阶段拆分

### 阶段 1：规约冻结

- 产出：`spec.md`、`contracts/`、`data-model.md`
- 重点：冻结验证请求、structured sample、baseline snapshot、baseline registry entry、validation record、共享视图

### 阶段 2：spec review 收口

- 产出：review 结论、范围澄清、与 `FR-0015/0016` 的边界确认
- 重点：阻断把 PR gate 或 runtime migration 混进本 FR，并冻结 baseline replacement 的唯一真相源、execution mode 分区与 `browser_channel` 的当前 canonical label

### 阶段 3：实现前冻结

- 产出：最小 Work Item 切片、验证入口、回归检查点
- 重点：确定哪类探针、样本和视图先落地

## 实现约束

- 不改写 `FR-0016` 的 PR / reviewer / guardian 门禁对象。
- 不把 `FR-0015` runtime migration、安装器或 readiness 对象混入本 FR。
- 不承诺当前阶段已经拿到最新 live evidence，只冻结正式输入。
- 不把账号长期运营、健康系统、行为人格写成本 FR 正式范围。

## 测试与验证策略

- 规约阶段：
  - 对照 `anti-detection.md`、`roadmap.md` 与 `#239` 检查是否仍存在第二棵父树心智
  - 对照 `FR-0012/0013/0014/0016/0015` 检查继承边界是否清楚
  - 检查 `browser_channel` 是否已在本 FR 内冻结当前 canonical label，且与 `FR-0015/0016` 保持同值
- 校验：
  - `bash scripts/docs-guard.sh`
  - `bash scripts/spec-guard.sh`

## TDD 范围

- 当前只冻结规约，不进入实现代码 TDD。
- 后续实现时优先覆盖：
  - baseline snapshot 解析/持久化
  - validation record 投影
  - drift 计算与共享视图读取

## 并行 / 串行关系

- 可并行：
  - 与 `FR-0021`、`FR-0022` 的 formal 套件起草
  - 与 GitHub 单一结构治理链
- 串行 / 依赖：
  - `FR-0012/0013/0014` 的后续实现 Work Item 需要消费本 FR 的正式结论
  - Layer 4 与后续实现只能消费 `AntiDetectionBaselineRegistryEntry` 提供的 active baseline 判定
  - 下游实现不得绕过 `AntiDetectionStructuredSample` 私自定义 `sample_ref` 载体
  - 若 review 发现 `FR-0015` 或 `FR-0016` 边界冲突，必须先收口本 FR 再继续实现

## 进入实现前条件

- FR-0020 spec review 通过。
- `#239` 已被确认为 canonical FR 容器，而不是横切主线 issue。
- GitHub 单一结构治理链已落地，后续 Work Item 可明确挂到 `Phase 2 -> FR-0020` 下。
- baseline snapshot 与 validation record 的最小字段无阻断争议。
- baseline replacement 的 active/superseded 判定来源无阻断争议。
- `sample_ref` 指向的结构化 sample payload 与 execution mode 分区无阻断争议。
- validation record 的完整作用域键与 `baseline_status` 的 closed enum 无阻断争议。
- validation request 的稳定 identity / lifecycle 与 request-sample-record 的相关性无阻断争议。
- `browser_channel` 的 canonical label 已在本 FR 内闭合，不再依赖 `FR-0015` 尚未冻结的枚举真相。
