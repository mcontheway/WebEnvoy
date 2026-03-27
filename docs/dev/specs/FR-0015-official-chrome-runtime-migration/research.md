# FR-0015 研究继承说明

## 研究来源

本 FR 不重新做 evidence spike，而是显式继承以下已存在输入：

- `#280`：official Chrome 137+ persistent extension / bootstrap decoupling spike
- PR `#282`：`#280` 的文档化冻结载体
- `#279`：architecture freeze issue
- PR `#283`：`#279` 的正式 roadmap / architecture 冻结

## 已继承结论

### 1. primary

- official branded Google Chrome 137+ 的正式 stealth 主路径，应迁移到 `profile` 内持久安装扩展 + runtime bootstrap/context 解耦。
- `stable extension_id + Native Messaging allowed_origins + profile` 是正式持久 identity 边界。
- `runtime_bootstrap_envelope` 是 run/session 级输入，而不是静态扩展资产或 profile 永久元数据。

### 2. candidate

- `developer mode / unpacked`
- External Extensions JSON
- Windows 外部安装/注册表 + 用户确认

这些路径仍可作为安装/分发候选或过渡路径，但不能在 `FR-0015` 中被升级为当前正式主方案。

### 3. fallback

- Chromium / Chrome for Testing 仅保留为开发、调试和验证 fallback，不再作为 stealth 主运行时答案。

### 4. admission-ready

经过 `#279/PR #283` 冻结后，可直接进入 implementation-prep 的输入只有：

- 主路径方向
- persistent identity 边界
- runtime bootstrap 解耦边界
- candidate / fallback 的分级边界

当前仍需在本 FR 内继续冻结、才能进入实现的内容：

- bootstrap transport contract
- readiness 状态语义
- stop-ship / rollback 边界

## 未解决问题

- runtime bootstrap 的正式 message/ack contract 仍未写成可实现共享契约
- runtime readiness 多信号冲突时的收敛状态仍未正式冻结
- 后续若需要持久化 identity/install state，还未达到直接增改 schema 的证据充分度

## 对本 FR 的影响

- 本 FR 应继续停留在 formal implementation-prep，不直接进入代码实现
- 本 FR 需要新增 `contracts/` 与 `risks.md`
- 本 FR 不应回头重新讨论主路径方向或候选路径优先级
