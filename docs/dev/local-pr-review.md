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

## 7. 当前限制

- 这是一套“本机执行”的工作流，因此机器需要在线。
- 它依赖本机 `codex` 和 `gh` 的登录态，不具备 GitHub Actions 的云端持续可用性。
- “是否允许合并”的最终裁决虽然由脚本执行，但底层仍建议配合 GitHub Branch Protection 一起使用，避免人为绕过。
