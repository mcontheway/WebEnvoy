# FR-0016 风险与回滚

## 风险 1：专项门禁触发集合再次漂移

- 触发条件：
  - 根级规范、开发区规范、review 基线、guardian 常驻审查摘要与 PR 模板对适用范围写出不同集合
  - “以 live evidence 请求 merge 放行”再次被遗漏
- 影响：
  - 作者、reviewer 与 guardian 会基于不同前提做判断
  - live evidence 门禁再次出现可绕过空间
- 缓解：
  - formal contract 中显式冻结触发原因枚举
  - 后续治理落库 PR 必须逐项对照同一集合，并同步更新 `docs/dev/review/guardian-review-addendum.md`
- 回滚：
  - 阻断治理落库 PR，回到 formal spec 层修正 shared contract

## 风险 2：最低字段不够支撑 latest head / 执行面复核

- 触发条件：
  - `latest_head_sha`、`execution_surface` 或等价核心字段被删除、降格或改成可选
- 影响：
  - reviewer 无法稳定判断 evidence 是否来自当前 latest head
  - guardian 无法稳定判断 evidence 是否来自真实浏览器执行面
- 缓解：
  - 在 shared contract 中把这两个字段冻结为最低必填字段
  - 任何删减都视为阻断性改动
- 回滚：
  - 保持 `refs_only` 与 `merge_ready=false`，直到字段恢复

## 风险 3：`N/A` 被误用为规避披露

- 触发条件：
  - 落入专项门禁的 PR 仍把 live evidence 区块写成 `N/A`
  - 模板或 review 规则没有写清 `N/A` 只适用于非专项门禁 PR
- 影响：
  - 作者可以形式上“满足模板”，但 reviewer 实际拿不到必要信息
  - live evidence 元数据门禁失效
- 缓解：
  - formal spec 明确 `N/A` 只适用于 `in_scope=false`
  - reviewer / guardian 在 `in_scope=true` 且 `N/A` 出现时直接阻断
- 回滚：
  - 将该 PR 退回 `blocked`，并要求重填最低字段

## 风险 4：stub / fake host / 控制面信号继续被误写成有效 evidence

- 触发条件：
  - review 基线没有把 `runtime.ping`、`runtime.bootstrap`、stub/fake host 写成默认无效 evidence
- 影响：
  - PR 可能在没有真实浏览器闭环的情况下被错误放行
- 缓解：
  - 在 formal spec、contract 与治理落库文案中同时冻结“默认无效 evidence”集合
  - 将此类情况定义为直接阻断，而不是建议补充
- 回滚：
  - 继续使用 `Refs #...`
  - 保持 `merge_ready=false`

## 风险 5：formal spec review 与治理落库 PR 混线

- 触发条件：
  - 高风险治理事项在同一 PR 中同时新增 formal spec 与落库文案
- 影响：
  - reviewer 无法先冻结契约，再判断实现是否符合契约
  - 当前 blocker 会反复出现
- 缓解：
  - formal spec review PR 与治理落库 PR 强制拆开
  - 治理落库 PR 在 spec review 通过前默认阻断
- 回滚：
  - 拆分 PR，保留 formal spec 主链，把治理落库改动移到后续 PR

## 最小门禁矩阵

### ready

- PR 落入专项门禁
- latest head 新鲜有效 evidence 已补齐
- `execution_surface=real_browser`
- reviewer / guardian 未标记 evidence 缺失、失效或边界不符

### blocked

- 缺少 latest head 新鲜复验
- evidence 来源不是 `real_browser`
- 只有控制面信号
- 最低字段缺失
- formal spec review 未通过

### not_applicable

- PR 明确不以真实 live evidence 作为关闭或放行依据
- PR 属于 formal spec / 治理前置 / 纯文档 / 纯研究范围

## 最小恢复路径

- formal 输入缺失：
  - 先补 FR-0016 套件并完成 spec review
  - 再恢复治理落库 PR 审查
- 字段缺失或 `N/A` 误用：
  - 回到 PR 描述补齐最低字段
  - 重新触发 reviewer / guardian 复核
- 证据来源错误或控制面信号不足：
  - 重新执行 latest head live 复验
  - 替换为真实浏览器执行面证据后再申请放行

## stop-ship 条件

- 高风险治理落库 PR 仍未经过 formal spec review
- reviewer / guardian 任一侧缺少统一触发集合
- 最低字段清单删掉 `latest_head_sha` 或 `execution_surface`
- `N/A` 仍可被落入专项门禁的 PR 用来规避披露
