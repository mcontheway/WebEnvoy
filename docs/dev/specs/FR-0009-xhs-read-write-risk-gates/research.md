# FR-0009 研究记录（读写路径风险审查）

## Spike Charter

- Decision question：在出现平台风险预警后，XHS 读写路径应如何建立统一门禁，才能在不扩张风险的前提下继续推进 `#208` 与后续读写事项。
- Timebox：FR-0009 spec review 前完成规约收口；live 恢复判断留待后续门禁实现与复核。
- Primary unknowns：
  - U1：`#209` 已落地读路径当前是否存在可复核的高风险自动化特征
  - U2：`#208` 写路径最小验证在何种前置下才可恢复 live
  - U3：读域/写域分离后，哪些门禁是共性，哪些必须分域处理
  - U4：如何定义“默认停高风险 live”的恢复条件，避免口头放行
- Candidate options：
  - O1：暂停所有高风险 live，默认 dry-run/侦察，仅做规约与证据归档
  - O2：读路径有限放行、写路径继续暂停
  - O3：继续按既有节奏推进 `#208` live 验证

## 当前基线

- `#209` 已闭环并合并：读路径具备可用性，但不代表 live 风险可忽略。
- `#208` 仍未闭环：最小页面交互验证尚未完成。
- 风险事实：已出现平台侧账号风险预警样本。
- 架构基线：`anti-detection.md` 强调账号安全与行为层风险，不支持“只看功能跑通”。

## 代码级风险发现（当前仓库可复核）

### C1：页面内签名 + 同源直打 API（读路径主行为）

- 证据：
  - `/Users/mc/Desktop/同步空间/coding/WebEnvoy/src/commands/xhs.ts`（`xhs.search` 命令入口）
  - `/Users/mc/Desktop/同步空间/coding/WebEnvoy/extension/content-script-handler.ts`（主世界签名调用与页面内 `fetch`）
  - `/Users/mc/Desktop/同步空间/coding/WebEnvoy/extension/xhs-search.ts`（`/api/sns/web/v1/search/notes` 请求组装、trace 标识、执行失败分类）
- 为什么是风险：
  - 该路径会把 CLI 调用直接映射为已登录页面上下文下的程序化请求，风控视角是“工具驱动式接口访问”，不是自然浏览派生请求。
  - 当前无 live 风险门禁强制前置（本 FR 正在补齐）。

### C2：background 自动扫 tab 并转发命令

- 证据：
  - `/Users/mc/Desktop/同步空间/coding/WebEnvoy/extension/background.ts`（`#resolveTargetTabId` 对 `xhs.search` 的 URL 模式匹配与自动选页）
  - `/Users/mc/Desktop/同步空间/coding/WebEnvoy/tests/extension.service-worker.contract.test.ts`（将自动选页行为固化为契约）
- 为什么是风险：
  - 行为语义是“后台探测并命中可执行页”，不是“用户显式指定目标页再执行”，会扩大误用面与异常执行面。
  - 在真实账号会话里更接近工具后台任务流量模式。

### C3：主世界脚本注入 + CustomEvent 回传签名结果

- 证据：
  - `/Users/mc/Desktop/同步空间/coding/WebEnvoy/extension/content-script-handler.ts`（`mainWorldCall`、`CustomEvent` 回传）
- 为什么是风险：
  - 虽然当前实现已做编码与最小防护，但这仍是页面可观测的“扩展主世界注入 + 事件桥”执行痕迹，不等同于普通用户行为。
  - 在账号已预警状态下应被纳入高风险 live 面控，不应默认放行。

### C4：写路径候选依赖 `dispatchEvent` / `DataTransfer`

- 证据：
  - `/Users/mc/Desktop/同步空间/coding/WebEnvoy/docs/dev/architecture/system-design/read-write.md`（富文本合成事件链、上传注入路径与局限）
  - `/Users/mc/Desktop/同步空间/coding/WebEnvoy/docs/dev/specs/FR-0008-xhs-write-spike/spec.md`
  - `/Users/mc/Desktop/同步空间/coding/WebEnvoy/docs/dev/specs/FR-0008-xhs-write-spike/risks.md`
- 为什么是风险：
  - 这些路径在文档层已明确存在 `isTrusted` 与平台拦截风险，且当前仍是候选/侦察态，不是可默认 live 的稳定路径。
  - 与账号预警事实叠加时，继续扩大 live 写实验会直接放大处罚风险。

### C5：Layer 3/4 行为节律仍空白，和 live 扩展存在张力

- 证据：
  - `/Users/mc/Desktop/同步空间/coding/WebEnvoy/docs/dev/architecture/anti-detection.md`（主流风控重心、覆盖现状）
- 为什么是风险：
  - 架构已承认平台主检测面在 Session/行为层，而当前工程主线尚未补齐；继续扩大 live 读写实验会在“功能可运行但行为约束不足”的状态下累积风险信号。

## 插件模式定位分析（定位张力）

### 事实执行形态（已落地）

- 当前 `xhs.search` 的实际执行链是：
  - CLI 触发
  - Native Messaging 转发
  - Extension Background 选页与桥接
  - Content Script / MAIN World 执行签名与请求
- 结论：插件已经是事实执行枢纽，不是旁路组件。

### 产品叙事形态（当前口径）

- `roadmap` 仍以 CLI-first 作为阶段主叙事，插件更多被描述为执行底层。
- 结论：存在“执行现实（插件中枢）”与“叙事现实（CLI 主导）”张力。

### 为什么影响风险门禁与治理

- 若叙事仍把插件当底层细节，风险门禁容易只落在 CLI 输入侧，忽略插件层真实风险面（选页策略、注入行为、页面执行模式）。
- 因此本 FR 要求把插件层风险对象显式入模，而不是仅做命令层口头约束。

## 反风控设计 vs Phase 1 实现差距（Gap 清单）

| 维度 | 文档已设计 | Phase 1 已落地 | 仍未落地 | 与风险预警关系 |
|---|---|---|---|---|
| 读路径模式 | `API primary + page fallback + 被动拦截辅路径` | `xhs.search` 的 API 主路径已实现并合入 | 被动拦截辅路径尚未成为 XHS 主执行收敛策略 | 当前 live 行为更集中在“工具驱动 API 请求”，行为侧风险更聚焦 |
| 写路径交互 | 真实点击优先、必要时合成事件回退、上传候选路径分级 | 尚无正式写运行时代码合入 `main` | 写路径仍停在 Spike/候选层（`FR-0008`） | 在证据不足时继续 live 写实验，风险放大且难归因 |
| 行为层反风控（Layer 3/4） | 文档明确为重点 | 无统一门禁实现落地 | session 节律、行为比例、恢复策略尚未形成运行时硬约束 | “能跑通”不等于“行为可控”，容易触发平台行为判定 |
| 插件中枢治理 | 执行链客观上由插件承载 | 插件桥接/执行已落地 | 插件层门禁模型与产品叙事尚未完全对齐 | 门禁若只在 CLI 口径表达，会漏掉插件层核心风险面 |
| 读写域边界 | 已明确 `www` 与 `creator` 分离 | 风险讨论已开始分域 | 统一读写门禁尚未通过审查并实施 | 单域成功误推另一域放行，会直接扩大误放行风险 |

## 证据矩阵

| ID | Claim/Unknown | Evidence Artifact | Method | Maturity | Confidence | Notes |
|---|---|---|---|---|---|---|
| U1 | 读路径也在风险审查对象内，不能豁免 | `#209` + 风险预警事实 | 事项交叉审查 | M2 | 85% | 已落地不等于可无限 live 扩展 |
| U2 | `#208` live 正式验证应先被门禁阻断 | `#208` + `#213` | 依赖关系审查 | M2 | 90% | 需写入正式前置条件 |
| U3 | 读域/写域必须分离审查 | 域名事实 + 现有讨论结论 | 边界审查 | M2 | 95% | `www` 与 `creator` 不能混推 |
| U4 | 默认停高风险 live 更安全 | 风险预警 + 账号安全原则 | 风险优先决策 | M1 | 75% | 仍需后续证据支持恢复条件 |

## Gate Status

- Fallback viability：PASS
  - 可在不执行高风险 live 的前提下推进规约、证据归档与门禁设计。
- Implementation readiness：BLOCKED
  - 门禁实现尚未开始，恢复 live 的证据闭环尚未完成。
  - 上述 gap 清单中的未落地项在进入 live 恢复前必须显式评审。

## 决策

- Outcome：Continue spike at spec layer
- Rationale：
  - 当前最优先是风险收敛与门禁冻结，而非继续扩 live 实验。
  - `#208` 与后续读写事项都需要先接入本 FR 的安全前置。
- Effective date：2026-03-22
