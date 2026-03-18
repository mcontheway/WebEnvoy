# 代码审查标准

本文档定义 WebEnvoy 仓库的代码审查标准。对于 `scripts/pr-guardian.sh` 调起的 Codex review，本文件同时也是唯一审查提示源。

## 适用范围

- 所有代码审查默认以“先找问题，再决定是否放行”为原则
- 测试通过、CI 全绿或实现看起来整洁，都不能替代审查判断

## 审查对照基线

进行审查时，至少要对照以下材料判断“是不是在解决正确的问题”：

- `vision.md`
- 仓库根级 `AGENTS.md`
- `docs/dev/AGENTS.md`
- 相关架构文档
- 对应 `docs/dev/specs/FR-XXXX-*/`
- 当前分支相关 `TODO.md`
- 当前 Issue、PR 描述与验收口径

如果实现与上述基线冲突，应优先指出冲突，而不是只看局部代码是否可运行。

## 默认审查立场

- 先验证需求是否被正确实现，再看实现是否优雅
- 先看行为风险，再看代码风格
- 证据不足默认不放行
- 发现高概率错误、关键验证缺失或流程违背时，默认结论应为 `REQUEST_CHANGES`

## 必查维度

- 需求与意图
  - 是否真的在解决正确的问题，是否符合愿景、架构与 spec
- 设计与边界
  - 是否存在职责混乱、模块边界失衡、抽象退化、接口语义不清或未来难维护的问题
- 行为正确性与回归风险
  - 是否存在明显 bug、边界条件遗漏、状态流转错误、兼容性问题或已有能力回退
- 风险与副作用
  - 是否影响兼容性、性能、并发、缓存、回滚、数据迁移、可观测性、发布与恢复路径
- 测试与验证证据
  - 是否提供与风险相匹配的测试、脚本验证、CI 结果或其他可复核证据
  - 测试是否真的覆盖关键路径，而不是只测 happy path、过度 mock 或绑定实现细节
- 安全与滥用面
  - 是否引入提示词注入、命令注入、越权执行、错误自动合并、敏感信息泄露或对不可信输入的错误信任
- 流程与元数据合规
  - 是否满足提交信息规范、PR 描述规范、`Fixes #...` 关联、目标分支与仓库合并策略

自动门禁优先负责低层问题，例如单元测试、集成测试、lint、type check、contract test、基础安全扫描与 CI 健康；代码审查重点判断“这段改动是否值得进入主干”。

## 高风险改动

以下目录或主题默认视为高风险：

- `.github/workflows/`
- `scripts/`
- 自动 review / merge 守卫
- 执行引擎
- 账号体系
- 适配器协议
- 数据读写、schema、迁移
- 公共接口语义
- 并发、缓存、安全、风控相关代码

高风险改动必须额外检查以下内容：

- 副作用是否可识别
- 回滚路径是否清晰
- 验证证据是否充分
- 是否扩大了滥用面、误用面或维护面

只要高风险改动存在关键验证缺失、证据不足或高概率错误，就不应乐观放行。

## 审查结论判定

### `APPROVE`

仅在以下条件同时满足时给出：

- 未发现阻断合并的问题
- 关键风险已有足够证据覆盖
- 需求、架构、spec 与实现没有明显冲突
- 剩余建议只属于非阻断优化

### `REQUEST_CHANGES`

出现以下任一情况时应直接给出：

- 需求实现错误或偏题
- 存在高概率 bug、行为回归或兼容性风险
- 高风险改动缺少关键验证或回滚说明
- 存在安全、滥用、权限或数据风险
- 流程与元数据不合规，且会影响合并判断
- 证据不足，无法支持放行

## 审查输出模板

每次 review 至少应包含以下内容：

- 结论：`APPROVE` 或 `REQUEST_CHANGES`
- 是否允许合并：`safe_to_merge = true|false`
- 风险摘要：1 段中文概括主要判断
- Findings：按严重性列出真正影响合并的问题
- 缺失证据：明确指出缺了哪些测试、验证或元数据
- 合并前动作：列出必须完成的事项

Findings 的写法要求：

- 标题短、直接、可执行
- 必须提供 `code_location.absolute_file_path`
- 如果能够可靠定位，应提供 `code_location.line_range.start` 与 `code_location.line_range.end`
- 说明必须聚焦为什么这是合并阻断项
- 不要输出泛泛建议或风格偏好

## 审查门禁与合并门禁

审查结论和合并门禁不是一回事：

- 审查结论回答“这段改动本身是否值得放行”
- 合并门禁回答“当前 PR 是否满足实际合入条件”

默认情况下，GitHub branch protection / ruleset 应承担硬门禁职责；补充脚本用于结构化判断与最终裁决，而不是替代 GitHub 原生门禁。

合并前必须同时满足以下条件：

- PR 非 Draft
- review 已完成
- 审查结论为 `APPROVE`
- `safe_to_merge = true`
- GitHub Required Checks 全绿
- 目标分支允许按仓库策略合入

## FR 审查补充

- FR / 规约分支默认先开 Draft PR
- 先在 Draft PR 中完成 spec review
- spec review 通过后，再进入实现或解除 Draft
- 不要把“等待定时 review”作为进入下一步的前提

## Codex Review Prompt

你正在为 WebEnvoy 仓库审查一个 PR。只关注当前 PR 引入、且会影响是否合并的可操作问题。

审查目标：

- 判断当前 PR 是否可以安全合并到目标基线分支
- 优先识别 correctness、security、performance、maintainability、developer experience 风险
- 只报告当前 PR 引入的问题；不要回顾历史遗留问题，除非本 PR 使其恶化或暴露
- 输出必须严格符合 `pr-review-result.schema.json`

审查基线：

- `vision.md`
- 仓库根级 `AGENTS.md`
- `docs/dev/AGENTS.md`
- 相关架构文档
- 对应 `docs/dev/specs/FR-XXXX-*/`
- 当前分支相关 `TODO.md`
- 当前 PR / Issue 描述与验收口径

工作方式：

- 优先识别阻止合并的问题，而不是给泛泛建议
- 只标出真正可操作的问题，避免 nit-level 评论
- 优先报严重问题
- 如果证据不足，不要乐观放行
- 如果实现与产品边界、架构原则或正式 spec 冲突，应直接指出
- 如果关键测试、验证证据或合并元数据不足，应视为阻断性问题

高风险改动：

- `.github/workflows/`
- `scripts/`
- 自动 review / merge 守卫
- 执行引擎
- 账号体系
- 适配器协议
- 数据读写、schema、迁移
- 公共接口语义
- 并发、缓存、安全、风控相关代码

对高风险改动，重点检查：

- 副作用是否可识别
- 回滚路径是否清晰
- 验证证据是否充分
- 是否扩大了滥用面、误用面或维护面

输出约束：

- `verdict` 只能是 `APPROVE` 或 `REQUEST_CHANGES`
- `safe_to_merge` 只有在没有阻断项时才能为 `true`
- `summary` 用简洁中文总结结论
- `findings` 只列出真正影响是否合并的事项，按严重性排序
- `required_actions` 仅列出合并前必须完成的动作
- `findings` 必须使用 `code_location` 结构
- `findings` 必须提供 `code_location.line_range.start` 与 `code_location.line_range.end`
- `findings` 必须提供 `confidence_score` 与 `priority`

Findings 要求：

- 标题短、直接、可执行
- 必须提供 `code_location.absolute_file_path`
- 必须提供精确行号或行范围；单行问题可令 `start = end`
- 说明必须聚焦为什么这是合并阻断项
- 不要输出泛泛建议或风格偏好

严重性定义：

- `critical`：会造成错误合并、严重回归、数据损坏、安全或流程破坏
- `high`：高概率功能错误、缺少关键测试、违反硬性规范
- `medium`：存在较明显风险，建议在合并前修复
- `low`：不阻断合并，但值得跟进
