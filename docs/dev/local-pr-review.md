# 本机按需 PR Review / Merge

本文档定义 WebEnvoy 的本机按需 PR 审查方案。目标不是定时轮询，而是由本机已登录的 Codex 账号在需要时执行审查，并在规则满足时决定是否允许合并。

## 1. 适用场景

- 你不希望把 OpenAI API Key 放到 GitHub Secrets。
- 你希望利用当前本机已登录的 Codex 账号完成 PR 审查。
- 你希望保留“按需触发”的控制感，而不是定时自动巡检。

## 2. 组成

- `scripts/pr-guardian.sh`
  - `review <pr-number>`：本机执行审查并打印结果
  - `merge-if-safe <pr-number>`：审查通过且检查通过时执行 `squash merge`
- `.codex/pr-review.prompt.md`
  - 审查规则与重点
- `.codex/pr-review-result.schema.json`
  - 机读输出结构，保证脚本可以据此决定是否允许合并

## 3. 前置条件

1. 本机已安装并登录 `codex`
2. 本机已安装 `gh`
3. 本机已安装 `jq`
4. 本机已完成 `gh auth login`

如果 `gh auth status` 失败，脚本会直接拒绝继续执行。

## 4. 使用方式

仅查看审查结论：

```bash
scripts/pr-guardian.sh review 123
```

查看结论并回写到 PR：

```bash
scripts/pr-guardian.sh review 123 --post-review
```

审查通过后自动执行 squash merge：

```bash
scripts/pr-guardian.sh merge-if-safe 123
```

审查通过后自动合并，并删除分支：

```bash
scripts/pr-guardian.sh merge-if-safe 123 --post-review --delete-branch
```

按需轮询自动 review，且只检查目标分支为 `main` 的 PR：

```bash
bash scripts/pr-review-poller.sh --base-branch main
```

## 5. 合并门禁

`merge-if-safe` 只有在以下条件全部满足时才会执行合并：

1. PR 不是 Draft
2. Codex 给出 `APPROVE`
3. `safe_to_merge = true`
4. GitHub 将 PR 判定为 `MERGEABLE`
5. `gh pr checks --required` 中所有必需检查均通过

只要其中任一项不满足，脚本就会终止，不会调用 merge。

## 6. Review 文本风格

脚本回写到 GitHub PR 的正文会尽量贴近人工 code review：

- 先给出 `APPROVE` 或 `REQUEST_CHANGES`
- 明确标出“是否允许合并”
- 用中文摘要概括风险
- 按严重性列出真正影响合并的问题
- 单独列出合并前必须完成的动作

这样既方便人在 PR 页面快速阅读，也方便后续脚本继续解析结构化结论。

如果当前登录用户正好是 PR 作者，脚本不会尝试提交 `APPROVE` review，而是自动降级为普通 PR 评论。这是为了兼容 GitHub “不能批准自己 PR” 的平台限制。

## 7. Review 范围

本机 review 默认至少覆盖以下内容：

- 需求与意图
  - 是否真的在解决正确的问题，是否符合 `vision.md`、`docs/dev/AGENTS.md`、架构文档与相关 spec/TODO
- 设计与边界
  - 是否存在职责混乱、模块边界失衡、抽象退化、接口设计别扭或未来难维护的问题
- 行为正确性与回归风险
  - 是否存在明显 bug、边界条件遗漏、自动化误判、状态流转错误、兼容性问题或已有能力回退
- 风险与副作用
  - 是否影响兼容性、性能、并发、缓存、回滚、数据迁移、可观测性、发布与恢复路径
- 测试与验证证据
  - 是否提供了与风险相匹配的测试、脚本验证、CI 结果或其他可复核证据
  - 测试本身是否有效，而不是只测 happy path、过度 mock 或绑定实现细节
- 安全与滥用面
  - 是否引入提示词注入、命令注入、越权执行、错误自动合并、敏感信息泄露或对不可信输入的错误信任
- 流程与元数据合规
  - 是否满足提交信息规范、PR 描述规范、`Fixes #...` 关联、目标分支、Required Checks 和 Squash Merge 要求

自动门禁优先负责吃掉低层问题，例如单元测试、集成测试、lint、type check、contract test、基础安全扫描与 CI 健康；本机 review 则重点判断“这段改动是否值得进入主干”。

以下变更默认按高风险 PR 处理，需要更严格审查：

- `.github/workflows/`
- `scripts/`
- 自动 review / merge 守卫
- 账号、权限、执行引擎、适配器协议
- 数据读写、schema、迁移
- 公共接口语义
- 并发、缓存、安全、风控链路

只要上述任一项存在高风险问题、关键验证缺失或证据不足，就应输出 `REQUEST_CHANGES`，而不是乐观放行。

## 8. 当前限制

- 这是一套“本机执行”的工作流，因此机器需要在线。
- 它依赖本机 `codex` 和 `gh` 的登录态，不具备 GitHub Actions 的云端持续可用性。
- “是否允许合并”的最终裁决虽然由脚本执行，但底层仍建议配合 GitHub Branch Protection 一起使用，避免人为绕过。
- 如果正式合入目标是 `main`，但远端暂时还没有创建 `main`，轮询脚本会直接跳过，不会回退去审查 `dev` 或其他分支。
