# Code Review Standard

本文档定义 WebEnvoy 仓库的代码审查标准。所有代码审查默认以“先找问题，再决定是否放行”为原则，不因测试通过而降低审查强度。

## 默认审查立场

- 先验证需求是否被正确实现，再看实现是否优雅
- 先看行为风险，再看代码风格
- 证据不足默认不放行
- 发现高概率错误、关键验证缺失或流程违背时，默认结论为 `REQUEST_CHANGES`

## 必查项

- 需求是否正确
- 设计与边界是否合理
- 是否存在行为回归或兼容性风险
- 是否有足够测试与验证证据
- 是否引入安全或滥用面问题
- 流程与元数据是否合规

## 高风险改动

以下目录或主题默认视为高风险：

- `.github/workflows/`
- `scripts/`
- 执行引擎
- 账号体系
- 适配器协议
- 数据读写
- 安全与风控相关代码

高风险改动必须额外检查以下内容：

- 副作用是否可识别
- 回滚路径是否清晰
- 验证证据是否充分
- 是否扩大了滥用面、误用面或维护面

## 审查输出要求

- 明确指出问题所在文件与原因
- 优先指出会导致错误、回归、安全问题或流程失真的问题
- 区分“必须修改”与“可选优化”
- 如果证据不足，应直接指出缺失了哪些验证

## 放行条件

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

## 本机按需 Review / Merge

本仓库默认支持“本机按需触发”的 PR 审查与合并流程。目标不是定时轮询，而是由本机已登录的 Codex 账号在需要时执行审查，并在规则满足时决定是否允许合并。

### 适用场景

- 你不希望把 OpenAI API Key 放到 GitHub Secrets
- 你希望利用当前本机已登录的 Codex 账号完成 PR 审查
- 你希望保留“按需触发”的控制感，而不是定时自动巡检

### 组成

- `scripts/pr-guardian.sh`
  - `review <pr-number>`：本机执行审查并打印结果
  - `merge-if-safe <pr-number>`：审查通过且检查通过时执行 `squash merge`
- `.codex/pr-review.prompt.md`
  - 审查规则与重点
- `.codex/pr-review-result.schema.json`
  - 机读输出结构，保证脚本可以据此决定是否允许合并

### 前置条件

1. 本机已安装并登录 `codex`
2. 本机已安装 `gh`
3. 本机已安装 `jq`
4. 本机已完成 `gh auth login`

如果 `gh auth status` 失败，脚本会直接拒绝继续执行。

### 使用方式

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

### Review 文本风格

- 先给出 `APPROVE` 或 `REQUEST_CHANGES`
- 明确标出“是否允许合并”
- 用中文摘要概括风险
- 按严重性列出真正影响合并的问题
- 单独列出合并前必须完成的动作

如果当前登录用户正好是 PR 作者，脚本不会尝试提交 `APPROVE` review，而是自动降级为普通 PR 评论，以兼容 GitHub “不能批准自己 PR” 的平台限制。

### 当前限制

- 这是一套本机执行的工作流，因此机器需要在线
- 它依赖本机 `codex` 和 `gh` 的登录态，不具备 GitHub Actions 的云端持续可用性
- “是否允许合并”的最终裁决虽然由脚本执行，但底层仍建议配合 GitHub Branch Protection 一起使用，避免人为绕过
- 如果正式合入目标是 `main`，但远端暂时还没有创建 `main`，轮询脚本会直接跳过，不会回退去审查 `dev` 或其他分支

## 本机审查入口

- `scripts/pr-guardian.sh`
- `scripts/pr-review-poller.sh`
