# WebEnvoy 技术选型预调研报告

> 日期：2026年03月16日
> 来源：基于 `docs/research/ref/` 下 17 份竞品深度调研报告的综合提炼
> 目的：在 Phase 1 开发前，针对"网页读写如何实现"这一核心技术问题，完成从竞品经验到 WebEnvoy 选型决策的知识转化

> **⚠️ 归档声明**：本文档为预调研阶段产出，核心结论已正式化入以下架构文档，如有冲突**以架构文档为准**：
> - 技术选型决策 → `docs/dev/architecture/system-design.md`（§附录 ADR）
> - 反检测架构 → `docs/dev/architecture/anti-detection.md`
> - 架构约束与原则 → `docs/dev/architecture/ARCHITECTURE_PRINCIPLES.md`
>
> 以下条目在架构文档中已有修正，请注意：
> 1. **TLS 指纹**（§6）：预调研建议使用 Node `tls-client`，但架构文档已确认 Content Script `fetch()` 天然携带真实浏览器 TLS 指纹，**无需额外 tls-client 库**（该库仅在浏览器外部发包时才有意义）。
> 2. **签名机制**（§8）：预调研的"MediaCrawlerPro 路径"仅作推导参考，WebEnvoy 最终方案更简洁（见 system-design.md §4.1）。
>
> 本文档保留作为技术决策的**推导过程记录**，不得作为实现依据。

---

## 一、核心问题拆解

本次预调研需要回答 5 个具体的技术问题：

1. **用什么浏览器运行时？**（Playwright / 原生 CDP / 其他）
2. **如何读取网页数据？**（页面抓取 / API 复用 / 内存窃取）
3. **如何写入内容（发布）？**（富文本编辑器 / 媒体上传）
4. **如何管理账号登录态？**（Session 持久化 / 多账号隔离）
5. **如何对抗反爬检测？**（指纹伪装 / 行为模拟）

---

## 二、问题一：浏览器运行时选型

### 候选方案

| 方案 | 代表项目 | 优点 | 缺点 |
|---|---|---|---|
| **TypeScript + Playwright** | browser-use, scrapling | 生态成熟、文档完备、TS 原生 | Stealth 停留在 JS 注入层，可被高防识别 |
| **Go + chromedp（原生 CDP）** | PinchTab | 并发性能优异、内存占用低 | 生态小、Stealth 脚本编写繁琐 |
| **Node.js + 原生 CDP** | bb-browser | 最高控制权、零封装开销 | 样板代码多、需手写全量 CDP 协议 |
| **Python + Camoufox** | camoufox | C++ 内核级伪装，最强防风控 | 不支持 Profile 持久化（重启丢 Session） |

### 选型结论

**主运行时：TypeScript + Playwright**

理由：
- 项目已确定技术栈为 TypeScript/Node，与架构一致
- Playwright 提供完整的 CDP Session 访问接口（`page.context().newCDPSession(page)`），可以桥接所有需要原生 CDP 的场景（如 ghost-cursor 鼠标模拟）
- Stealth 层完全可通过 `evaluateOnNewDocument` 前置 JS 注入覆盖（PinchTab 的方案已证明有效）

**极端高防场景补丁：Camoufox（一次性任务专用）**

Camoufox 的 C++ 内核级 WebGL/Canvas 伪装不可替代，但因其不支持 `user_data_dir` 状态恢复，**只能用于无需保持登录态的一次性侦察任务**，不作为主运行时。

> ⚠️ **关键约束（camoufox_analysis.md）**：Camoufox 源码中 `test_should_restore_state_from_userDataDir` 被明确标记 `skip`，注释：*"Not supported by Camoufox"*。任何账号保活场景不得使用 Camoufox。

---

## 三、问题二：网页数据读取

竞品分析揭示了三条技术路径，对应 L1/L2/L3 三层：

### 路径 A：L3 — API 直连（最快，适合已逆向的平台）

来源：**bb-browser** Tier 1/2/3 拆解

操作原理：
```
Tier 1：eval("fetch('/api/...', {credentials:'include'})") → 带 Cookie 直接调接口
Tier 2：用 CDP Network 域抓包 → 提取 Bearer Token → 重放 API 请求
Tier 3：eval("JSON.stringify(window.__pinia.state.value)") → 直读前端内存 State
```

> ⚠️ **关键修正（bb-browser_analysis.md）**：Tier 1/2/3 **不是运行时自动降级**，而是开发阶段逆向研究的分类。每个平台适配器必须在开发期由人工研究后**手动硬编码**决策路径，不能期望系统自动判断。

### 路径 B：L2 — DOM 结构化提取（稳健，适合已知平台 UI 操作）

来源：**browser-use**（5 阶段净化管线）、**page-agent**（FlatDomTree）、**pinchtab**（AX Tree + RefCache）

三个项目共同指向同一个最优实践：

```
不要用原始 DOM → 用无障碍树（Accessibility Tree）
CDP: Accessibility.getFullAXTree
     ↓
过滤掉 Ignored / generic / none 节点
     ↓
给可交互节点分配短 ID（e0, e1...）→ RefCache
     ↓
LLM 只看到极简结构，返回 {"action": "click", "target": "e1"}
     ↓
从 RefCache 查 BackendDOMNodeID → 原生 CDP 点击
```

这是目前业界对 AI Agent 交互协议的最优解，Token 消耗最低、UI 改版容错性最强。

附加 Trick（来自 browser-use）：
- **Paint Order 过滤**：通过 `DOMSnapshot.captureSnapshot` 获取绘制顺序，剔除被弹窗遮挡的"幽灵元素"，防止 LLM 点不可见区域
- **JS 事件嗅探**：注入脚本抓取 `click`/`mousedown` 的真实绑定节点，覆盖非标准组件

### 路径 C：L1 — AI 视觉漫游（兜底，未知平台）

来源：**ui-tars**（VLM 视觉定位）、**nanobrowser**（Planner + Navigator 双轴）

最终兜底路径：
- 当 DOM 和 API 均无法穿透时（如 Canvas 验证码、WebGL 界面），截图 → 发给 VLM → 获取坐标 → 物理点击
- Token 成本极高，延迟大，只作为最后手段

---

## 四、问题三：写入内容（发布操作）

### 4.1 富文本编辑器输入

来源：**MultiPost-Extension**（已适配小红书、抖音、B 站等）

**核心问题**：现代社媒平台（小红书、抖音）的编辑器是自研 React/Vue 组件，直接 `.value =` 赋值或 `.dispatchEvent(new InputEvent(...))` **无效**。

正确方案：合成完整的原生事件链

```typescript
// 合成事件链（针对 contenteditable 或自定义编辑器）
await element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
await element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))
await element.dispatchEvent(new FocusEvent('focus', { bubbles: true }))
// 对于中文输入：
await element.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
await element.dispatchEvent(new CompositionEvent('compositionupdate', { data: text, bubbles: true }))
await element.dispatchEvent(new CompositionEvent('compositionend', { data: text, bubbles: true }))
await element.dispatchEvent(new InputEvent('input', { data: text, bubbles: true }))
```

> ⚠️ **高风险点（MultiPost-Extension_analysis.md）**：脚本派发的事件 `isTrusted = false`，高防平台可能严格校验此属性。回退方案：走 L3 直接调平台的草稿保存 API。

### 4.2 媒体文件上传

来源：**MultiPost-Extension**（DataTransfer 方案）

**核心问题**：文件选择框不能被脚本简单地触发，需要"欺骗"前端框架的上传监听器。

DataTransfer 上传方案（适用于 `<input type="file">`）：

```typescript
// 1. 下载远程图片为 Blob
const blob = await fetch(imageUrl).then(r => r.blob())
const file = new File([blob], 'image.jpg', { type: 'image/jpeg' })

// 2. 塞入 DataTransfer 并赋值给 input
const dt = new DataTransfer()
dt.items.add(file)
inputElement.files = dt.files

// 3. 触发框架监听器
inputElement.dispatchEvent(new Event('change', { bubbles: true }))
inputElement.dispatchEvent(new InputEvent('input', { bubbles: true }))
```

**DataTransfer 方案局限性**：
- `isTrusted = false` 的平台会拦截
- 平台改用 `File System Access API` 后失效
- 部分平台（如 Bilibili）用 `window.postMessage` 内部协议，需单独适配

**更稳健的备选方案（L3）**：直接逆向平台的 OSS 预签名上传接口，绕过前端 UI 直接调接口上传。

### 4.3 拟人化鼠标操作（高防写操作必须）

来源：**ghost-cursor**（贝塞尔 + Fitts 定律 + 过冲）

在对抗 Datadome、Akamai 等行为生物识别系统时，**瞬间转移式的 click 必须被替换为贝塞尔曲线鼠标路径**。

ghost-cursor 的数学模型：
1. **贝塞尔曲线插值**：起点到终点之间生成双随机控制锚点，产生自然弧线
2. **菲茨定律控速**：距离越远 → 速度越快；接近目标 → 减速对准
3. **过冲模拟**：超过阈值距离时刻意越过目标再回拉，模拟人类肌肉惯性

> ⚠️ **集成约束（ghost-cursor_analysis.md）**：
> - 不支持 TouchEvent（仅鼠标事件）
> - 无原生 Playwright 接口，需通过 `page.context().newCDPSession(page)` 桥接 CDP，手动发送 `Input.dispatchMouseEvent`

---

## 五、问题四：账号登录态管理

### 确定方案：Named Profile 物理目录隔离

来源：**PinchTab**（Named Profile）、**Steel Browser**（SessionStorage 快照）

架构模型：

```
profiles/
  ├── xhs_account_001/   ← 小红书账号A的 UserDataDir
  │     ├── Default/Cookies
  │     ├── Default/Local Storage/
  │     └── Default/IndexedDB/
  ├── xhs_account_002/   ← 小红书账号B的 UserDataDir
  └── douyin_account_001/
```

每次启动对应账号的任务：
```typescript
const context = await browser.launchPersistentContext(
  `./profiles/${accountId}`,
  { headless: false, ...stealthOptions }
)
```

**关键能力**：
- 同一站点多账号完全隔离（Cookies、IndexedDB 互不干扰）
- 一次登录，永久复活（只要 Cookie 未过期）
- Profile 目录可整体备份/云端迁移

**Steel Browser 补充**：对于依赖 LocalStorage/SessionStorage 做前端鉴权的 SPA（如某些 React App），除了 Cookies 外，还需额外提取并恢复 `localStorage` 快照，否则重启后仍然处于"未登录"状态。

**账号保活不得使用 Camoufox**（重申：不支持持久化 Profile）

---

## 六、问题五：反爬检测对抗

### 必须覆盖的 8 个检测维度

来源：**Scrapling StealthyFetcher**（完整补丁清单）、**PinchTab Stealth**、**nanobrowser**

| 检测维度 | 泄漏点 | 修复方案 |
|---|---|---|
| WebDriver 标志 | `navigator.webdriver = true` | 强制重写为 `undefined` |
| Chrome 上下文 | `window.chrome` 为空 | 注入 `window.chrome = { runtime: {} }` |
| Canvas 指纹 | Canvas 像素哈希唯一 | 注入细微随机噪声 |
| 字体度量指纹 | `TextMetrics` 字宽稳定可追踪 | 注入字体度量随机扰动 |
| WebGL 供应商 | 暴露真实 GPU 型号 | 伪造为通用 "Intel Inc." |
| WebRTC | 绕代理泄露真实 IP | 在 CDP 层直接禁用 |
| 时区不一致 | 系统时区与 UA 地区不符 | CDP `Emulation.setTimezoneOverride` |
| CDP 特征暴露 | `chrome.debugger` 留下痕迹 | `evaluateOnNewDocument` 前置注入掩盖 |

### ShadowDOM 强拆（来自 nanobrowser）

部分反爬系统藏在 Closed ShadowDOM 中，普通 DOM 遍历无法触达：

```javascript
// 强制所有 ShadowDOM 为 open 模式（在 evaluateOnNewDocument 中注入）
const originalAttachShadow = Element.prototype.attachShadow
Element.prototype.attachShadow = function(options) {
  return originalAttachShadow.call(this, { ...options, mode: 'open' })
}
```

### TLS 指纹（L3 专用引擎）

来源：**Scrapling**（`curl-cffi`）

L3 专用引擎在发送 HTTP 请求时，**不得使用标准 `axios` 或 `fetch`**，必须使用支持 JA3/HTTP2 指纹定制的库：

- Python 生态：`curl-cffi`（支持 HTTP/3 + TLS 指纹伪造）
- Node/TypeScript 生态：需调研 `tls-client`（基于 Go tls-client 的 Node 绑定）

---

## 七、技术选型决策总表

| 能力域 | 选型方案 | 备注 |
|---|---|---|
| **浏览器运行时（主）** | TypeScript + Playwright | 与项目 TS 技术栈一致 |
| **浏览器运行时（高防一次性）** | Camoufox（Python 胶水调用） | 仅用于无需保活的侦察任务 |
| **DOM 读取** | CDP `Accessibility.getFullAXTree` + RefCache | 参考 PinchTab 实现 |
| **数据抓取（结构化）** | L3: `fetch` API 复用 Cookie → L2: DOM 提取 → L1: VLM | 按平台逆向深度选择 |
| **写入（文本）** | 合成事件链（CompositionEvent + InputEvent） | 针对自研编辑器 |
| **写入（媒体）** | DataTransfer 注入 → 或 L3 直调上传 API | 按平台防风控强度选择 |
| **拟人鼠标** | ghost-cursor 数学模型 + CDP 桥接 | 需手写 Playwright CDP Session 适配层 |
| **账号保活** | Named Profile（UserDataDir 目录隔离） | 参考 PinchTab 实现 |
| **Stealth 层** | `evaluateOnNewDocument` 前置 8 维注入 | 参考 Scrapling + PinchTab |
| **TLS 指纹（L3）** | Node 版 `tls-client` 或 Go 微服务 | 待进一步调研 |
| **AI 漫游兜底** | VLM 截图 + 坐标点击（参考 UI-TARS） | 仅 L1 Fallback 最后手段 |

---

## 八、架构核心机制：Content Script 内发包（关键结论）

> 本节基于对 MediaCrawlerPro 参考实现的深度分析，补充并修正了初版调研中"需要逆向签名算法"的误判。

### 问题的本质

MediaCrawlerPro-SignSrv 的 `XhsPlaywrightSign` 揭示了签名生成的真实方式：

```python
# 它并非破解了签名算法，而是在浏览器里调用了 XHS 自己的函数：
encrypt_params = await page_obj.evaluate(
    "([url, data]) => window._webmsxyw(url, data)", [req.uri, req.data]
)
```

`window._webmsxyw` 是小红书页面 JS 中本来就有的签名函数。SignSrv 只是借用 Playwright 浏览器来调用它。

### WebEnvoy 不需要 SignSrv

WebEnvoy 本身就是浏览器扩展（Chrome Extension），Content Script 运行在平台页面内部。这意味着：

**当 Content Script 在 `xiaohongshu.com` 页面内运行时：**
- Cookie 天然可用（同源，无需任何提取操作）
- `window._webmsxyw` 天然存在（XHS 自己加载的 JS）
- `fetch('/api/sns/web/v1/search/notes', {credentials: 'include'})` 天然不受 CORS 限制

```
MediaCrawlerPro 路径（间接，需要 3 个独立服务）：
  爬虫(httpx) → RPC → SignSrv → Playwright 浏览器 → window._webmsxyw → 签名 → httpx 发包

WebEnvoy 路径（直接，在同一个浏览器进程内）：
  CLI → NativeMessaging → Extension Background → Content Script（已在 XHS 页内）
                                                        ↓
                              window._webmsxyw(url, data)  [平台自己的签名函数]
                                                        ↓
                              fetch('/api/...', {credentials:'include'})
                                                        ↓
                              结构化数据 → Background → CLI → SQLite
```

这与 bb-browser 的 Tier 1 机制完全一致（`eval("fetch('/api/...', {credentials:'include'})")`），只是 WebEnvoy 以 Extension Content Script 的形式实现，更稳定、更安全。

### 读写机制最终定型

**读操作 — 两档策略（优先档 → 兜底档）**

| 档位 | 触发条件 | 实现机制 |
|---|---|---|
| **优先：Content Script 主动发包** | 已知平台 API 端点 | 在平台页面内 `fetch()` + 平台自有签名函数 |
| **兜底：被动拦截自然流量** | API 结构未知 / 写操作附带读取 | `webRequest` API 拦截平台自然产生的响应 |

**写操作 — 真实页面交互**

```
CLI 指令 → Content Script 驱动：
  导航到发布页 → 合成事件链填入富文本（CompositionEvent + InputEvent）
  → DataTransfer 注入媒体文件 → 触发 onChange
  → ghost-cursor 贝塞尔轨迹点击发布
  → 拦截发布成功响应 → 返回笔记 ID / URL
```

### MediaCrawlerPro 与 WebEnvoy 能力对比

| 组件 | MediaCrawlerPro 方式 | WebEnvoy 等价方案 |
|---|---|---|
| 请求签名 | 独立 SignSrv 微服务（Playwright 或 JS 补环境） | **天然具备** — Content Script 在平台页内直接调用 |
| Cookie 获取 | CookieBridge 插件同步到爬虫服务 | **天然具备** — 插件就在浏览器内，同源 Cookie 直接可用 |
| 多账号管理 | MySQL / Excel + IP 代理池 | Named Profile（UserDataDir 目录隔离） |
| 数据存储 | MySQL / SQLite（独立进程） | SQLite（CLI 进程内） |
| 发包方式 | Python httpx（外部进程） | fetch()（Content Script 内，同源免 CORS） |

**结论：WebEnvoy 的 Chrome Extension 架构天然消除了 SignSrv 的存在必要。**

---

## 九、已确认的知识盲区（需要 Spike）

以下问题仍需通过实际验证工作补充，但规模远小于"逆向签名算法"：

### Spike A：小红书平台 API 端点确认（Phase 1 前置必做）

不需要逆向签名算法，但需要确认以下内容（可通过 DevTools Network 直接观察）：

- [ ] 搜索、详情、用户主页等核心 API 的 URL 端点与请求体结构
- [ ] `a1` / `webId` / `gid` 等追踪字段的生命周期（在 Content Script 内如何获取）
- [ ] 富文本发布编辑器的 DOM 结构与 Composition 事件响应机制
- [ ] 图片上传流程（是否走 DataTransfer 或有独立上传接口）

### Spike B：抖音平台 API 端点确认（Phase 1 前置必做）

- [ ] 视频流、用户信息、搜索等核心 API 端点
- [ ] 创作服务台（发布页）的视频上传接口结构
- [ ] 抖音是否有额外的环境检测 JS 需要在 Content Script 注入前处理

### Spike C：Extension ↔ Content Script 通信性能验证

- [ ] 大体量 JSON 数据（如100条搜索结果）通过 `chrome.runtime.sendMessage` 传递的延迟与限制
- [ ] 是否需要分片传输或改用 `chrome.storage` 作为中转

---

## 十、结论与下一步建议

**技术路线已完全收敛**：

1. 核心架构：**TypeScript + Chrome Extension + Native Messaging + CLI（Node.js）**
2. 读写机制：**Content Script 内发包（主）+ webRequest 被动拦截（辅）**
3. 签名问题：**已解决，无需 SignSrv，Content Script 直调平台自有函数**
4. 账号管理：**Named Profile（UserDataDir 隔离）**

**建议的下一步顺序**：

1. **立即**：将上述架构决策补充进 `docs/dev/architecture/AGENTS.md`，固化选型
2. **Phase 1 前置**：完成 Spike A（小红书 API 端点观察），确认 Content Script 内发包路径可行
3. **然后**：基于 Spike 结论，编写 `docs/dev/specs/FR-XXXX-*/` 下的第一批 spec
