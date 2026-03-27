# 执行策略层

> 所属文档：[系统设计（战术层）](../system-design.md) › 第三章
> 覆盖章节：§三 三级执行模型 · §三.2 执行层安全等级

---

## 三级执行模型

对每个平台操作，按以下三级顺序选择执行路径：

```
L3 专用引擎（已知平台，硬编码适配器）
    · 成功率目标：95%+
    · 速度：最快（毫秒级）
    · 触发：平台 Adapter 已定义且未失效

         ↓ L3 失效（平台改版/Adapter 未覆盖）

L2 通用半定制（DOM + AX Tree 操控）
    · 成功率目标：80%+
    · 速度：中（秒级）
    · 触发：平台有稳定 DOM 结构，但无 L3 Adapter

         ↓ L2 失效（反爬封 DOM / 纯 Canvas 界面）

L1 AI 视觉漫游（VLM + 物理点击）
    · 成功率预期：60% 左右
    · 速度：慢（秒到十秒级，Token 成本高）
    · 触发：L1/L2 均失效时的最后兜底
```

> **关键约束**：三级之间的降级切换**不是运行时自动触发**的，而是在 Adapter 开发阶段由人工确定后硬编码到平台规则文件中。运行时只执行已确定的策略，不做自动感知与切换。

---

## official Chrome 137+ 主运行时基线

对 official branded Google Chrome 137+，在 profile 已完成 WebEnvoy 扩展持久安装并进入正式运行阶段后，WebEnvoy 的主路径已不再建立在 `--load-extension` 的 per-run staged extension 上，而是建立在以下前提之上：

- WebEnvoy 扩展作为 **profile 内持久安装资产** 存在
- 浏览器启动只负责复用该 profile，并建立本次 run/session 所需的 runtime bootstrap
- run/session 级上下文通过显式运行时输入进入已安装扩展，而不是打包进扩展文件内容

这里必须明确区分两层资产：

- **静态扩展资产**：扩展代码、权限、content script、background、Native Messaging 权限与其他与单次 run 无关的内容
- **运行时上下文**：`run_id`、`runtime_context_id`、`profile`、`fingerprint_runtime`、`fingerprint_patch_manifest`、`main_world_secret` 等 run/session 级输入，统一归入 `runtime_bootstrap_envelope` 一类对象

额外边界：

- Chromium / Chrome for Testing 只保留为开发、调试和验证 fallback，不得描述成 official Chrome stealth 主路径
- `developer mode / unpacked`、`External Extensions JSON`、Windows 外部安装/注册表、Chrome Web Store / 合规上架只属于安装/分发候选路径；它们不能替代本节冻结的 runtime / identity / bootstrap 正式边界
- 本文档只冻结安装完成后的运行时边界，不设计最终安装器或分发实现
- 首次 profile 安装、首次登录引导与候选分发路径选择属于后续事项；它们不应被误解为 `runtime.start` / `runtime.login` 之前已经定稿的正式安装前置

---

## 执行层安全等级（浏览器启动方式 × 操控方式）

「三级执行模型」回答的是"用什么逻辑做事"，本节回答的是"用什么物理手段做事"。两个维度正交组合，构成完整的执行安全模型。

### Playwright/CDP 的真实风险

Playwright 启动 Chrome 时必须打开 `--remote-debugging-port`，这会留下可被检测的痕迹：

| 风险来源 | 可否缓解 | 缓解手段 |
|---|---|---|
| `navigator.webdriver = true` | ✅ 可消除 | Stealth 补丁覆盖 |
| `window.chrome` 行为异常 | ✅ 可消除 | Stealth 补丁覆盖 |
| Canvas / WebGL 指纹 | ✅ 可消除 | Stealth 补丁覆盖 |
| CDP 调试端口（`--remote-debugging-port`）| ✅ 基本可消除 | 端口本身对页面 JS 不可见（同源策略阻止 localhost 探测）；唯一的副作用是 `navigator.webdriver=true` 等标志，均可通过 Stealth 补丁覆盖 |
| `isTrusted = false`（JS 合成事件）| ✅ 可解，有多条路径 | **Content Script `dispatchEvent`** → `isTrusted = false`；**CDP `Input.dispatchMouseEvent`**（Playwright `page.click()`）→ `isTrusted = true`（Blink C++ 层注入）；**OS 级输入**（CGEvent / SendInput）→ `isTrusted = true` |

### Playwright 在本架构中的两类职责

1. **浏览器进程管理**（始终存在）：启动 Chrome、加载 Named Profile、复用该 Profile 中已持久安装的 WebEnvoy Extension，并提供崩溃恢复与超时检测。
2. **物理级输入通道**（默认档使用）：通过 `newCDPSession().send('Input.dispatchMouseEvent')` 向 Blink C++ 层注入鼠标/键盘事件，产生 `isTrusted = true` 的真实输入事件（ghost-cursor 贝塞尔轨迹经此通道发送）。

**业务逻辑编排**（导航决策、API 发包、数据结构化、富文本合成）则完全由 **Extension Content Script** 执行，后者在平台视角下与真实用户安装的任何扩展（油猴脚本、广告屏蔽器）无法区分——这是最核心的反检测优势。

> 对 official Chrome 主路径，Playwright 不再承担“每次启动临时 staging 扩展”的职责；启动阶段只消费已冻结的 profile / extension identity 边界和本次 `runtime_bootstrap_envelope` 输入。

最高安全模式下，第 2 类职责改由 OS 级输入引擎（nut.js）承担，Playwright 仅保留第 1 类职责（进程管理）。

### 三档执行层安全策略

| 档位 | 浏览器启动方式 | 页面操控方式 | 鼠标/键盘方式 | 适用场景 |
|---|---|---|---|---|
| **最高安全** | 直接 `spawn` Chrome 二进制（无 CDP 端口） | Extension Content Script | OS 级输入（macOS `CGEvent` / Windows `SendInput`） | Cloudflare Turnstile、FingerprintJS Pro 等极端高防平台 |
| **默认**（推荐） | Playwright `launchPersistentContext` + Stealth 补丁 | Extension Content Script | ghost-cursor + CDP `Input.dispatchMouseEvent` | 小红书、抖音等主流平台（当前防护级别下足够） |
| **高效率** | Playwright `launchPersistentContext` | CDP 直接控制（`evaluate` / `click`） | CDP `Input.dispatchMouseEvent` | 风控宽松平台，或用户明确接受风险 |

```
安全等级：最高安全 > 默认 > 高效率
执行速度：最高安全 < 默认 < 高效率
```

**最高安全模式的实现代价**：失去 Playwright 对浏览器进程的精细管控（超时检测、崩溃恢复等需自行实现），鼠标操作依赖系统权限（macOS 需在系统偏好设置中授予辅助功能权限）。因此该模式不作为默认值，由用户按需开启（`--mode safe`）。

> **Phase 1 决策**：首个平台（小红书）使用「默认」档，待高防场景出现后再实现「最高安全」档。「高效率」档按需实现。
