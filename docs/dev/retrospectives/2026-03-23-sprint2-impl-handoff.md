# Sprint 2 实施交接与运行时会话加固检查

## 1) Task and Current Status
- Task goal: 在 `FR-0010` / `FR-0011` 合入后，切换到 Sprint 2 实施阶段，优先推进 `#218` 与 `#219`，并把运行时 / 会话生命周期的硬约束提前固化到实施入口。
- Current status: `#242` 与 `#243` 已合入 `origin/main`；本地 `main` 已 fast-forward 到 `63658ff`；旧 docs worktree 与本地 docs 分支已清理；`#218/#219/#221/#223` 仍为 `OPEN`。
- Progress estimate: 95%
- Active branch and worktree path: `main` / `/Users/mc/Desktop/同步空间/coding/WebEnvoy`
- Target issue, PR, and FR suite:
  - Next implementation issues: `#218`, `#219`
  - Follow-up issues: `#221`, `#223`
  - Formal suite: `docs/dev/specs/FR-0010-xhs-risk-gates-hardening/`
- Latest pushed or local HEAD commit: `63658ff6a2fd0bf0a6a7cb6d0a43763b2dac2a63`
- Last guard/check command run and verdict:
  - `gh pr checks 242` -> all green
  - `gh pr checks 243` -> all green
  - `gh pr merge 243 --squash` -> merged
  - `gh pr merge 242 --squash` -> merged
- Current blocker class: `implementation`

## 2) Stop Point
- Last completed step: 更新本地 `main` 到最新远端主干，移除旧 docs worktree，删除本地 docs 分支，并开始清理远端 docs 分支。
- Why this is a safe pause boundary: 规约评审闭环已完成，仓库不处于半编辑或半合并状态；下一步是独立的实施分支初始化。
- Explicitly not done yet:
  - 尚未为 `#218` / `#219` 创建实现 worktree / 分支
  - 尚未开始任何实现代码修改
  - 尚未把 runtime/session hardening 要求翻译成实现期测试或 guard

## 3) Minimal State Snapshot
- Current frontier (first action after resume): 基于最新 `main` 为 `#218` 和 `#219` 创建两个独立实现 worktree，先对齐 `FR-0010` 冻结字段和运行时会话边界。
- Key artifacts (files/outputs/logs):
  - [FR-0010 spec](/Users/mc/Desktop/同步空间/coding/WebEnvoy/docs/dev/specs/FR-0010-xhs-risk-gates-hardening/spec.md)
  - [FR-0010 contract](/Users/mc/Desktop/同步空间/coding/WebEnvoy/docs/dev/specs/FR-0010-xhs-risk-gates-hardening/contracts/risk-gate-execution.md)
  - [FR-0010 data model](/Users/mc/Desktop/同步空间/coding/WebEnvoy/docs/dev/specs/FR-0010-xhs-risk-gates-hardening/data-model.md)
  - [FR-0011 spec](/Users/mc/Desktop/同步空间/coding/WebEnvoy/docs/dev/specs/FR-0011-xhs-min-anti-detection-execution/spec.md)
  - [FR-0011 contract](/Users/mc/Desktop/同步空间/coding/WebEnvoy/docs/dev/specs/FR-0011-xhs-min-anti-detection-execution/contracts/anti-detection-execution.md)
  - runtime-session-hardening skill references used during this handoff: `references/webenvoy.md`, `references/hardening-checklist.md`, `references/test-matrix.md`
- Decisions already made:
  - `#218` 与 `#219` 是 Sprint 2 第一实施组，可并行。
  - `#221` 可以后接，但必须消费 `FR-0010` 已冻结对象，不能先发明私有审批对象。
  - `#223` 是后置集成项，不能提前并入 `#218/#219` 首批实现。
  - `FR-0010` 统一冻结字段为：`target_domain`、`target_tab_id`、`target_page`、`action_type`、`requested_execution_mode`、`effective_execution_mode`、`gate_decision`、`gate_reasons`。
  - 所有门禁请求都必须显式携带 `target_tab_id` 与 `target_page`，不能只在 `live_*` 请求中补齐。
  - `FR-0011` 已把读路径 live 枚举统一为 `live_read_limited` / `live_read_high_risk`，审批与审计字段口径已收紧。
- Assumptions in effect:
  - 接下来会继续保持“spec PR 已合并，实施 PR 单独走 review”。
  - `#218/#219` 的实现会落在同一运行时 / 扩展执行链，不允许各自定义互不兼容的会话判定。
- Required environment/preconditions:
  - `gh` 已登录
  - 本地 hooks 可用
  - 从 [main](/Users/mc/Desktop/同步空间/coding/WebEnvoy) 新建实现分支
  - 不混入用户当前工作区之外的临时 `/tmp` 产物
- Local noise that must not be committed:
  - `/tmp/webenvoy-pr242-fix`
  - `/tmp/webenvoy-pr243-fix`
  - 任何 `webenvoy-pr-guardian.*` 临时目录

## 4) Next Step
- Immediate next action: 为 `#218` 与 `#219` 各建独立实现 worktree，并先做实现前基线扫读：`vision.md`、`docs/dev/roadmap.md`、`docs/dev/architecture/system-design/read-write.md`、`docs/dev/architecture/system-design/execution.md`、`docs/dev/specs/FR-0010-xhs-risk-gates-hardening/*`。
- Success signal:
  - 两个实现 worktree 创建成功且基于 `63658ff`
  - `#218` / `#219` 的实现切分与 `FR-0010` 字段冻结口径一致
  - 已列出运行时 / 会话生命周期的最小状态机与测试入口
- If fails, fallback action:
  - 若 worktree 创建失败，先执行 `git worktree list --porcelain` 检查残留占用
  - 若实现切分不清，先起草仅内部使用的实施任务清单，不直接动代码

## 5) Blockers and Risks
- Active blocker(s): 无硬 blocker。
- Dependency or owner (if known):
  - `#218` / `#219` 由当前实施分支直接推进
  - `#221` / `#223` 暂不并入首批代码修改
- Risk if unresolved:
  - 如果 `#218/#219` 不先对齐运行时会话状态机，后续容易出现“控制器活着但浏览器死了”“锁还在但会话已失真”的假存活问题。
  - 如果 live / dry-run / recon 只看单一信号，后续 `#223` 会把错误状态固化进统一风险状态机。
  - 如果 `stop/start/retry` 没有 idempotency 语义，后续审批门禁可能被重复执行或产生孤儿浏览器。
- Temporary workaround (if any): 先把运行时 hardening 规则写成实施前 checklist 和测试矩阵入口，即使代码本轮不全部实现，也要在 PR 中明确边界。

## 6) Noise to Ignore
- Irrelevant logs/artifacts:
  - 已过时的 PR #242 / #243 review comments
  - `/tmp` 下临时 clone
  - guardian 生成的 detached worktree
- Dead-end paths already tried:
  - 按 issue 编号机械拆 spec / contract 边界，已证明会导致 `#223` 归属和字段口径漂移
  - 在旧 head 上重复看 stale review comment，没有价值
- Unverified ideas (label as hypothesis):
  - hypothesis: 远端 docs 分支删不删不会影响 `#218/#219` 实施，但删掉能降低噪音
  - hypothesis: `#218` 与 `#219` 共享的 runtime/session hardening 代码可能会落到同一公共模块，而不是各自独立实现

## 7) Restart Checks
- Check 1: `git status --short --branch`
- Check 2: `git worktree list --porcelain`
- Check 3: `gh issue view 218 --json state,title,url` 与 `gh issue view 219 --json state,title,url`
- Check 4: 确认最近一次 guard 结论仍对应最新合并后的 `main`
- Check 5: 实施前用以下 runtime/session hardening 视角做一次基线自检：
  - session state 是否显式
  - lock / owner / fencing token 是否存在
  - liveness 是否至少 2 信号判定

## 8) Common Failure Modes to Avoid
- Likely mistake 1: 用单一信号判断运行时存活，例如只看 controller PID、browser PID、ready marker 或锁文件其中之一。
- Likely mistake 2: 在 `stop` 时无 fencing / ownership 校验就杀锁持有者，导致误杀同 run 或重试路径。
- Likely mistake 3: 把 `#218` / `#219` 做成两套并行但不兼容的门禁对象，之后再试图靠 `#223` 强行统一。
- Likely mistake 4: 把 mock-browser 覆盖误写成“真实浏览器路径已验证”。
- Likely mistake 5: 忽略 orphan browser / disconnected controller 场景，导致 `RUNNING` 假阳性。

## Runtime/Session Hardening Focus For Sprint 2
- Required session contract for implementation planning:
  - `NEW`
  - `STARTING`
  - `RUNNING`
  - `DEGRADED`
  - `STOPPING`
  - `STOPPED`
  - `RECOVERING`
  - `FAILED`
- Minimum WebEnvoy liveness evidence before any live gate decision:
  - control-plane: lock heartbeat / lease freshness
  - execution-plane: browser process and controller process bounded probe
  - data-plane: recent progress marker or fresh ready marker for current launch
  - optional external signal: extension / native messaging control still responsive
- Mandatory hardening rules for upcoming implementation:
  - never use controller-alive as browser-alive proxy
  - never use ready marker without freshness for current launch
  - preserve same-run valid locks on duplicate start / retry
  - orphan cleanup must be explicit, two-phase, and auditable
  - any conflicting liveness signal should move state to `UNKNOWN` / fenced behavior, not silently stay `RUNNING`
- Minimum test matrix to thread into `#218/#219` implementation review:
  - stale lock + alive runtime
  - alive lock + dead runtime
  - duplicate `runtime.start`
  - `runtime.stop` against stale or partially dead state
  - stale marker + fast relaunch
  - disconnect during write path
