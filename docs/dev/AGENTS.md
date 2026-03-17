# WebEnvoy AI 深度协同开发规范 (The Funnel Flow)

本文档是 WebEnvoy 项目管理的最高法则。我们采用**测试驱动（TDD）、迭代驱动（Sprint）配合单向漏斗发版**的现代化工程管线。

---

## 📂 一、工程管理目录树结构

所有开发态的核心文档均位于 `docs/dev/` 目录下。该目录是严格的**静谧区**，所有文档遵循"按关注点分离"原则。

```text
docs/dev/
 ├── roadmap.md              # [路线图] Phase 阶段划分与 FR 交付列表（按 Phase → Category 平铺）
 ├── architecture/           # [架构蓝图] 系统底层运转与抽象模型设计（按组件拆分）
 └── specs/                  # [法定契约] 正式特性的完整规约套件（按 FR 编号建子目录）
      └── FR-001-native-messaging/ # 每个 Feature 一个独立子目录
           ├── spec.md        # [必须] 功能规格：用无技术偏见的独立语言描述"做什么"与验收标准 (AC)
           ├── plan.md        # [必须] 技术实现计划：技术选型与方案组装，连接需求到代码的桥梁
           ├── TODO.md        # [必须] 任务拆解与进度：跨会话管理该 FR 的细粒度实现进度
           ├── research.md    # [可选] 技术调研：针对拿不准的工具库或兼容性问题的调研结论
           ├── data-model.md  # [可选] 数据模型：实体关系图与数据库宽表设计，避免撑爆 plan
           └── contracts/     # [可选] 接口契约：前后端在写第一行代码前敲定的 API/JSON 规范
```

---

## ⚙️ 二、需求流转的"单向漏斗"机制 (The Funnel)

项目**绝不采用**本地 Markdown 与 GitHub Issues 的"双向同步"策略。WebEnvoy 严格遵循以下"三层单向数据流"生命周期：

### 阶段 1：需求池与冲刺规划 (GitHub Issues / Projects)
*   **动作**：所有的灵感、Bug、待办事项（Backlog）以及冲刺规划（Sprint）全部在远端 GitHub 上进行。
*   **自动化管理**：AI Agent 拥有调用 `gh` CLI 工具的权限。人类只需用自然语言下达指令（如："帮我把 FR-001 和 FR-002 建为 Issue，并放入 Sprint 1 的 Milestone 中"），AI 将自动执行 GitHub 的建卡与状态流转。
*   **铁律**：本地代码库中**绝不保留** `backlog.md` 或 `sprints/` 目录。绝不在本地文件中打勾、划线追踪进度。GitHub 是唯一的进度与状态真理。

### 阶段 2：立项与契约敲定 (Local Specs)
*   **动作**：当决定在一个 Sprint 中真正实现某个**核心/复杂特性**时，在 **`docs/dev/specs/`** 下以 `FR-XXXX-语义名称` 为名建立子目录，并在其中逐步创建规约套件（至少包含 `spec.md`、`plan.md`、`TODO.md`）。
*   **唯一事实来源 (SSOT)**：所有关于"要做什么/做成什么样"的具体定义，永远只能以本目录下的特性规约文件为唯一准入基准。
*   **铁律**：`spec.md` 一旦合并进入主干，即成为法律文件。如需修订，必须通过独立 PR 并在 Commit Message 中说明修订原因，不得静默覆盖。*(注：日常的 Bugfix 或微小特性不需要写 Spec，直接在 Issue 中描述即可)*。

### 阶段 3：自动化派发 (Sync)
*   **单向推送**：我们通过 GitHub Action 监听 `docs/dev/specs/` 目录的新增或变更。一旦被推入保护干道，Action 脚本会自动在 GitHub 上生成同名或同编号 Issue，添加关联标签以建立池子。
*   **铁律**：本地 `docs` 负责提供最高准则说明书 (What & How)，云端 Issue 页面仅承担分发指派与进度更新 (To Whom & When)。

### 阶段 4：全托管开发与 Git 流转 (Auto-Pilot)
*   **人类角色（审批者）**：人类只需用自然语言下达宏观指令（如"开始做 FR-001"、"设计没问题，合并 PR"），**无需手动执行任何 Git 或 GitHub 命令**。
*   **Agent 角色（执行者）**：AI Agent 负责全权接管底层工程操作。包括：自动拉取分支、提交符合规范的中文 Commit、推送远端、使用 `gh` CLI 创建 PR、并在获得人类授权后使用 `gh pr merge` 自动合并。
*   **跨会话状态管理**：对于需要跨越多个会话才能完成的大型 FR，AI 自动更新该 FR 目录下的 `TODO.md` 来记录细粒度的实现进度，防止上下文丢失。
*   **代码合入语法**：AI 在提交 PR 时，自动带上连结语法词（如 `Fixes #1`），利用 GitHub 机制自动清账。

---



## 🤖 三、AI Agent 上下文加载顺序

认知全景在前，AI Agent 在开始任何工作前，必须严格按以下顺序加载上下文，不得跳步，不得反序：

1. **`vision.md`**（根目录）— 产品底线与不可逾越的约束，优先级最高
2. **`docs/dev/roadmap.md`** — 全局阶段划分，明确当前所处 Phase 与优先级排序
3. **架构文档**（`docs/dev/architecture/`）— 明确系统底层运转与抽象模型设计
4. **对应 Feature 的 Spec 套件**（`docs/dev/specs/FR-XXXX-*/`）— 任务契约，执行基准（如果有）
5. **当前分支对应的 `TODO.md`** — 恢复跨会话的细粒度实现记忆（如果有）
6. **用户当前提供的 GitHub Issue/任务描述** — 明确当前会话的具体执行目标

> **关于需求池与状态**：本地代码库中**不包含** `backlog.md` 或 `sprints/` 目录。所有的需求池（Backlog）、冲刺规划（Sprint）和进度状态（Todo/Done）都在远端 GitHub (Issues/Projects) 中管理。AI 仅需关注当前会话中用户分配的具体任务。
