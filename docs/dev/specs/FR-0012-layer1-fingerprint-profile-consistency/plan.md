# FR-0012 实施计划

## 实施目标

为 `#235` 冻结 Layer 1 JS 指纹补全与 profile 一致性的正式输入，确保后续实现 PR 能围绕统一的 profile 指纹包、补丁清单、环境绑定约束和审计衔接落地，而不是再次从架构文档中拆需求。

## 分阶段拆分

### 阶段 A：契约冻结与边界收口

- 产出：
  - `contracts/fingerprint-profile-contract.md`
  - `data-model.md`
  - `spec.md` 中的正式范围/非目标/验收场景
- 重点：
  - 冻结 `fingerprint_profile_bundle`
  - 冻结 `fingerprint_patch_manifest`
  - 明确哪些字段是稳定机器边界，哪些只是实现细节

### 阶段 B：P0 实现切片准备

- 目标补丁：
  - `AudioContext`
  - Battery API
  - `navigator.plugins`
  - `navigator.mimeTypes`
  - profile 指纹种子持久化与启动加载
- 产出：
  - P0 实现 PR 的最小输入
  - P0 验证矩阵与阻断项
- 依赖：
  - 阶段 A 契约冻结完成
  - `FR-0010/0011` 继续作为门禁与状态机前置

### 阶段 C：P1/P2 补丁切片准备

- 目标补丁：
  - `hardwareConcurrency`
  - `deviceMemory`
  - `screen.colorDepth`
  - `screen.pixelDepth`
  - `performance.memory`
  - `Permissions API`
  - `navigator.connection`
- 产出：
  - 后续补丁切片的稳定字段依赖
  - 可增量实现的优先级顺序
- 依赖：
  - P0 约束已经冻结，避免后续字段语义反复变更

### 阶段 D：环境绑定与验收收口

- 产出：
  - profile 环境强绑定判定标准
  - 失配时的阻断/降级方向
  - 指纹检测站点与结构化验证口径
- 依赖：
  - profile 指纹包与补丁清单语义已冻结

## 实现约束

1. 本 FR 只产出正式规约，不提交任何运行时代码。
2. 不修改 `FR-0010` / `FR-0011` 的对象语义或状态机定义。
3. 不把 Layer 2/3/4 能力混入 Layer 1 实现范围。
4. 不新增账号健康评分、行为人格、长期冷却或矩阵调度字段。
5. 不把 Worker 线程盲区伪装成“本 FR 将一并解决”的承诺。
6. 不允许 profile 缺字段时临时随机生成伪稳定值后继续高风险 live。

## 测试与验证策略

- 规约阶段校验：
  - `bash scripts/docs-guard.sh`
  - `bash scripts/spec-guard.sh`
  - `git diff --check`
- 实现阶段默认验证方向：
  - profile 元数据读写与字段完整性测试
  - patch manifest 构造测试
  - 环境绑定失配判定测试
  - patch 注入前置缺失时的结构化错误测试
- 指纹效果验证：
  - `bot.sannysoft.com`
  - `fingerprintjs.com/demo`
  - `abrahamjuliot.github.io/creepjs`
  - `browserleaks.com`
- 回归对齐：
  - 验证 Layer 1 失败不会绕开 `FR-0010/0011` 的门禁/审计链路

## TDD 范围

- 后续实现 PR 默认纳入 TDD：
  - profile 指纹包解析与校验
  - patch manifest 构造
  - 环境绑定一致性判定
  - 补丁前置缺失时的错误分类/返回
- 不强制在自动化测试中直接验证第三方站点的最终评分结果：
  - 检测站点验证作为集成证据，不替代确定性单元测试

## 并行 / 串行关系

- 串行前置：
  - `FR-0010` 与 `FR-0011` 已作为已冻结前置存在
  - `FR-0012` spec review 通过前，不进入实现 PR
- 可并行：
  - P0 补丁的实现准备可与 P1/P2 详细技术拆分并行收集
  - 检测站点样本采集可与实现设计并行
- 串行后置：
  - `fingerprint_profile_bundle` 字段未冻结前，不进入 patch 实现
  - 环境绑定判定未冻结前，不放行跨节点/跨 OS 运行相关实现

## 进入实现前条件

1. FR-0012 规约 PR 完成 spec review 且无阻断项。
2. `contracts/fingerprint-profile-contract.md` 中两个稳定对象语义无歧义：
  - `fingerprint_profile_bundle`
  - `fingerprint_patch_manifest`
3. `data-model.md` 已明确 `__webenvoy_meta.json` 中哪些字段是稳定契约字段，哪些不是。
4. `risks.md` 已明确 profile 缺字段、补丁缺失、环境失配时的 stop-ship 与回滚方向。
5. 已明确本 FR 只消费 `FR-0010/0011` 既有门禁与状态机对象，不新增并行 gate/status 结果对象。
6. 后续实现 PR 已明确本次交付的优先级切片（P0 或 P1/P2），不得模糊宣称“完成全部 Layer 1”。
