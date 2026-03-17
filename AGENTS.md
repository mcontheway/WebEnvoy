# AGENTS.md

## 核心纪律与入口导航

所有 AI Agent 在操作此项目前，必须严格遵守以下法则。

- **项目愿景与产品边界**：请首先阅读 `vision.md` 以了解 WebEnvoy 的宏观目标与核心哲学。
- **详细文档与后续导航**：各目录架构树与研究报告指引请参见 `docs/AGENTS.md`。

### 全局开发纪律

1. **分支与 PR 机制**：**严禁直推主分支**！所有的需求开发和文档修改必须凭依 FR 说明书拉取独立的分支（如 `dev`，`feat/FR-0012`）完成，并通过 Pull Request 测试拦截门禁后再合入主干。
2. **持续整洁的提交线**：提交信息（Commit Message）**必须使用中文且符合 Conventional Commits 规范**。向主分支合入 PR 时，必须采用 **Squash（压缩）合并**，以保持主干历史日志的绝对清晰与干净。
3. **测试代码物理位置**：单元测试 (Unit Tests) 遵循同目录分离放置原则（归拢于被测源文件同级的 `__tests__/` 子目录下，如 `__tests__/[name].test.ts`）；验收 Spec AC 的核心端到端/集成测试 (E2E/Integration) 必须统一收拢于项目根目录的 `tests/` 下，以便 CI 后续执行门禁拦截。

### AI-Native 项目管理机制 (全托管模式)

本项目采用**人类决策 + AI 全托管执行**的极简工作流，AI 需利用 `git` 和 `gh` CLI 自动完成所有底层操作，人类仅用自然语言下达指令：

1. **立项与设计**：人类下达指令 -> AI 自动拉取 `docs/FR-*` 分支，在 `docs/dev/specs/` 下编写 `spec.md` 与 `TODO.md` -> AI 自动提 PR。
2. **自动化派发**：人类合并设计 PR -> CI 脚本 (`spec-issue-sync.yml`) 自动在 GitHub 生成 Issue 编号。
3. **编码与清账**：人类下达编码指令 -> AI 自动拉取 `feat/FR-*` 分支 -> 依据 `TODO.md` 跨会话执行 -> AI 自动提 PR 并带上 `Fixes #Issue编号` -> 人类合并 PR 自动关闭 Issue。

**铁律：本地代码库中绝不保留任何进度追踪文件（如 backlog），GitHub Issue 是唯一的进度真理。**

> 👉 **所有的工作流与技术规范，请前往查阅核心指南：[`docs/dev/AGENTS.md`](./docs/dev/AGENTS.md)**
