# WebEnvoy 反风控技术架构

> 版本：v1.0
> 日期：2026年03月16日
> 定位：本文档描述 WebEnvoy 的反检测/反风控完整技术体系，作为 `system-design.md` 中反检测章节的深度展开。

---

## 一、检测层级模型

现代高防平台（XHS、抖音、Cloudflare）的风控系统是多层独立计分、汇总判定的体系。理解这个层级是选择正确投入方向的前提。

```
┌──────────────────────────────────────────────────────────┐
│  Layer 5：C++ 内核级指纹                                  │
│  Canvas/WebGL 像素在显卡驱动层被采集，JS 层拦不住        │
│  • 代表技术：Camoufox、BrowserOS 修改 Chromium 源码      │
│  • WebEnvoy 定位：极端场景下集成 Camoufox，不自建         │
├──────────────────────────────────────────────────────────┤
│  Layer 4：平台行为模型                                    │
│  账号在该平台的历史操作模式与正常用户统计分布的偏离度    │
│  • 检测维度：操作速度分布、功能使用比例、活跃时间段      │
│  • 当前市场：无任何工具系统化解决   ← WebEnvoy 重点      │
├──────────────────────────────────────────────────────────┤
│  Layer 3：Session 级行为模式                              │
│  单次 session 内的整体行为轨迹是否符合真实用户画像       │
│  • 检测维度：阅读停顿、回头翻看、空闲间隙、操作节奏     │
│  • 当前市场：无任何工具系统化解决   ← WebEnvoy 重点      │
├──────────────────────────────────────────────────────────┤
│  Layer 2：事件级行为模拟                                  │
│  单个交互事件的物理真实性                                 │
│  • 检测维度：鼠标轨迹曲线、键盘节奏、点击位置分布       │
│  • 当前市场：ghost-cursor 解决了鼠标，键盘部分覆盖       │
├──────────────────────────────────────────────────────────┤
│  Layer 1：动态 JS 指纹                                    │
│  页面 JS 可探测的浏览器属性与 API 行为                   │
│  • 检测维度：navigator.webdriver、Canvas 哈希等 10+ 项   │
│  • 当前市场：各 Stealth 库已覆盖大部分  ← 补全遗漏维度   │
├──────────────────────────────────────────────────────────┤
│  Layer 0：网络层指纹                                      │
│  TLS/JA3 握手特征、HTTP/2 帧、请求头顺序                │
│  • Content Script fetch() 使用浏览器原生 TLS，天然解决   │
└──────────────────────────────────────────────────────────┘
```

**当前方案覆盖情况**：Layer 0 ✅ 天然解决 / Layer 1 ✅ 大部分 / Layer 2 ⚠️ 部分 / Layer 3-4 ❌ 空白 / Layer 5 ⚠️ 极端场景用 Camoufox

**主流平台风控重心**：已从 Layer 1 迁移至 Layer 3/4。这是「打了所有 webdriver 补丁还是被封号」的根本原因。

---

## 二、Layer 1：JS 指纹完整覆盖

### 2.1 当前 8 维补丁（已有）

在 `document_start` + MAIN World Content Script 中注入：

> **⚠️ JS Hook 的根本盲区：Worker 线程**
> Content Script 的 `Object.defineProperty` 覆盖只在**主线程**生效。`ServiceWorker` 和 `WebWorker` 中的 `navigator` 是独立的全局对象，不受主线程 hook 影响——这意味着在 Worker 内查询 `navigator.userAgent` 或 `navigator.hardwareConcurrency` 时，仍会返回真实值。
> 高防平台（如 Cloudflare Bot Management）已开始在 Worker 线程内采集指纹进行交叉验证。**这是 JS 层补丁的硬上限，只有 Camoufox 级别的 C++ 内核修改才能彻底解决。**

| 维度 | 泄漏点 | 修复方案 |
|---|---|---|
| WebDriver 标志 | `navigator.webdriver = true` | 强制重写为 `undefined` |
| Chrome 上下文 | `window.chrome` 为空 | 注入 `window.chrome = { runtime: {} }` |
| Canvas 指纹 | Canvas 像素哈希唯一 | `getImageData` 输出注入细微随机噪声 |
| 字体度量指纹 | `TextMetrics` 字宽稳定可追踪 | `measureText` 返回值注入扰动 |
| WebGL 供应商 | 暴露真实 GPU 型号 | 伪造为 `"Intel Inc." / "Intel Open Source Technology Center"` |
| WebRTC | 绕代理泄露真实 IP | 拦截 `RTCPeerConnection`，屏蔽本地 IP 候选 |
| 时区不一致 | 系统时区与 UA 地区不符 | `Date` API 返回值统一覆盖 |
| ShadowDOM 封闭 | Closed ShadowDOM 无法遍历 | `Element.prototype.attachShadow` 强制 `mode: 'open'` |

### 2.2 补全遗漏维度（新增）

| 维度 | 检测原理 | 修复方案 | 优先级 |
|---|---|---|---|
| **AudioContext 指纹** | 对特定频率振荡器的采样输出做哈希，每台设备唯一 | 在 `OfflineAudioContext.startRendering()` 结果的 `getChannelData()` 上注入 ±0.0001 量级随机扰动 | P0 |
| **Battery API** | `navigator.getBattery()` 返回的电量/充电状态可作为跨站追踪标识 | 伪造固定的电量值（如 `0.73`）和充电状态（`charging: false`），与 Profile 绑定 | P0 |
| **`navigator.plugins`** | 真实 Chrome 有默认插件列表（PDF Viewer 等），自动化环境通常为空 | 注入标准 Chrome 插件列表 | P0 |
| **`navigator.mimeTypes`** | 同上，与 plugins 联动 | 注入标准 mimeType 列表 | P0 |
| **`window.performance.memory`** | 自动化环境内存读数分布与真实用户不同 | 注入合理范围内的随机化读数（`usedJSHeapSize` 等） | P1 |
| **`navigator.hardwareConcurrency`** | 与 UA 声称的设备类型不符 | 与 Profile 的设备型号元数据一致（如 M2 MacBook = 8） | P1 |
| **`navigator.deviceMemory`** | 同上 | 与 Profile 绑定（如 `8` GB） | P1 |
| **`screen.colorDepth` / `pixelDepth`** | 与 UA 声称的显示器类型不符 | 与 Profile 的显示器配置一致 | P1 |
| **`navigator.connection`** | 网络类型（wifi/4g）和速度可作为环境信号 | 伪造为 `{ effectiveType: '4g', downlink: 10, rtt: 50 }` | P2 |
| **`Permissions API`** | 权限状态（notification、camera 等）的组合可作为指纹 | 统一返回 `denied` 或 `prompt` | P2 |

### 2.3 指纹一致性约束（Profile 级别）

每个配置空间在创建时生成一次 `fingerprint_seed`，并将以下值固化到 `__webenvoy_meta.json`：

```jsonc
{
  "fingerprint": {
    "ua": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)...",
    "hardwareConcurrency": 8,
    "deviceMemory": 8,
    "screen": { "width": 1440, "height": 900, "colorDepth": 30 },
    "battery": { "level": 0.73, "charging": false },
    "timezone": "Asia/Shanghai",
    "audioNoiseSeed": 0.000047231,   // 固定噪声种子
    "canvasNoiseSeed": 0.000083154
  }
}
```

**关键约束一**：噪声种子必须固定（不每次随机生成）。随机变化的指纹比稳定指纹更易被识别为自动化——真实用户的指纹是稳定的。

**关键约束二：Profile 与运行环境强绑定（跨平台迁移禁止）**

固定噪声种子只能保证"在同一台机器上每次叠加的扰动相同"，但 Canvas 渲染和 AudioContext 浮点运算的基准值本身依赖底层环境：

- **Canvas**：字体栅格化引擎因 OS 不同而异（macOS Core Text / Linux FreeType / Windows DirectWrite），相同绘图指令在不同系统产生不同基准像素值。固定种子叠加到不同的基准上，最终哈希仍然漂移。
- **AudioContext**：浮点运算精度依赖 FPU 实现，跨硬件架构（x86 vs ARM）或跨 OS 会产生尾数级差异。

**结论**：在 macOS 上创建的 Profile，禁止迁移到 Linux 节点运行，否则底层渲染差异叠加固定噪声，导致指纹发生突变，极易触发风控。

云端部署场景必须保证所有节点使用完全一致的容器镜像（同 OS 发行版版本、同 GPU 驱动），不能假设"相同种子 = 相同指纹结果"。

---

## 三、Layer 2：事件级行为模拟

### 3.0 关于 `isTrusted` 的根本约束

**在进入具体实现前，必须厘清三条路径各自的 `isTrusted` 结果。**

```
路径 A：JS 层 dispatchEvent（Content Script / 页面内脚本）
  element.dispatchEvent(new MouseEvent('click'))
  → isTrusted = false   ← 浏览器引擎强制标记，JS 层无法覆盖

路径 B：CDP Input 域（Input.dispatchMouseEvent / Input.dispatchKeyEvent）
  Playwright page.click() / page.type() 底层机制
  → isTrusted = true    ← 事件在 Blink C++ 层注入，走真实用户输入管线

路径 C：OS 级输入（macOS CGEvent / Windows SendInput）
  nut.js 等系统级工具
  → isTrusted = true    ← 硬件中断路径，完全真实
```

**关键区分**：CDP 并不只有「执行 JS 代码」（`Runtime.evaluate`）一种模式。`Input` 域是独立的低层次协议，在 Chrome 的原生输入处理管线（`RenderWidgetHostImpl::ForwardMouseEvent`）中模拟物理设备输入，产生的 DOM 事件被浏览器标记为可信（`isTrusted = true`）。这与通过 `Runtime.evaluate` 在 JS 层创建事件是本质不同的两件事。

**实践含义**：
- 对于需要触发框架状态更新的**点击和键盘输入**，应优先使用 Playwright `page.click()` / `page.type()`（路径 B），而非 Content Script `dispatchEvent`（路径 A）
- Content Script 的 `dispatchEvent` 用于富文本编辑器的 `CompositionEvent` 等无法通过 CDP Input 域合成的场景，此时 `isTrusted = false` 是已知风险
- OS 级输入（路径 C）与 CDP Input 域（路径 B）在 `isTrusted` 上等价，区别在于：路径 B 需要 CDP 连接（Playwright 启动），路径 C 不需要但依赖系统权限且难以并发

**对于 XHS、抖音当前风控级别**，路径 B 已经足够应对 `isTrusted` 检测。路径 C（最高安全档）的存在价值主要是消除 CDP 连接本身的其他痕迹，而非进一步提升 `isTrusted`。

### 3.1 鼠标移动（ghost-cursor 数学模型）

已在 `system-design.md §5.3` 描述，核心三要素：

- **贝塞尔曲线插值**：双随机控制点产生自然弧线
- **菲茨定律控速**：距离越远速度越快，接近目标则减速
- **过冲模拟**：超过阈值距离时刻意越过目标再回拉

**额外要求**（ghost-cursor 未覆盖）：

- 点击前的「悬停确认」：在目标元素上停留 80-200ms 再点击，不要到达即点
- 偶发性「错过」行为：极低概率（2%）点击到目标元素附近空白处，随即移回重点
- 右键移动轨迹同样需要曲线（不要只对左键做处理）

### 3.2 键盘输入节奏

```typescript
interface TypingPersona {
  baseWPM: number          // 基础输入速度（字/分钟）
  variability: number      // 速度波动范围（0-1）
  pauseAfterPunctuation: number  // 标点后停顿倍率
  typoRate: number         // 笔误概率（退格重输）
  longPauseFrequency: number    // 「思考停顿」频率
}

// 每个字符的输入延迟：
// base_delay = 60000 / (wpm * 5)  // 平均延迟（ms）
// actual_delay = base_delay * (1 + random(-variability, +variability))
// 标点符号之后：actual_delay * pauseAfterPunctuation
// 每 ~200ms 有概率触发一次长停顿（300-800ms）
```

### 3.3 滚动行为模拟

当前方案中滚动行为完全没有处理。真实用户的滚动特征：

- **速度不均匀**：手指/滚轮的惯性滑行，有加速和减速阶段
- **停顿点**：遇到感兴趣的内容会停下来，不是匀速扫过
- **回头翻看**：概率性向上滚动一小段，再继续向下（表示重读某内容）
- **速度分布**：快速扫描阶段 → 感兴趣时放慢 → 无聊时加速

```typescript
async function humanScroll(
  page: Page,
  direction: 'down' | 'up',
  totalDistance: number,
  rhythm: { lookbackProbability: number }
): Promise<void> {
  const segments = splitScrollIntoSegments(totalDistance, rhythm)
  for (const seg of segments) {
    await page.mouse.wheel(0, seg.deltaY)
    // 每段之间有不均匀停顿
    await sleep(seg.pauseAfter)
    // 概率性触发回头翻看
    if (Math.random() < rhythm.lookbackProbability) {
      await page.mouse.wheel(0, -seg.deltaY * 0.3)
      await sleep(200 + Math.random() * 400)
    }
  }
}
```

---

## 四、Layer 3：Session 级行为节律引擎（核心差异化）

这是当前市场完全空白的领域，也是现代高防平台的主要检测维度。

### 4.1 自动化 Session 的暴露特征

| 行为 | 自动化特征 | 真实用户特征 |
|---|---|---|
| 页面加载后 | 几乎立即开始操作（< 500ms）| 1-4 秒的「阅读停顿」才开始 |
| 滚动模式 | 匀速线性，或完全静止 | 变速，有停顿，偶有回头 |
| 点击精准度 | 总是命中元素中心（虽加了偏移）| 有更多样的「随机落点」分布 |
| 操作间隙 | 前一步完成即立刻开始下一步 | 有长有短的自然停顿 |
| Session 时长 | 恰好完成任务就退出 | 有「任务完成后继续闲逛」的余韵 |
| 操作序列 | 每次几乎相同 | 每次略有不同 |

#### 操作间隔的分布模型

机器行为与人类行为最大区别之一是**操作间隔的统计分布**。均匀分布虽然比固定间隔好，但仍可被统计检测识别：

| 分布类型 | 特征 | 评估 |
|---|---|---|
| 固定间隔（如恰好 2000ms） | 机器特征最强 | ❌ 绝对禁止 |
| 均匀分布（1500-2500ms 随机） | 方差太低，样本过于集中 | ⚠️ 可检测 |
| 正态分布（均值 2s，σ=300ms） | 较真实，但极端值概率低 | ✅ 较好 |
| **长尾分布（最真实）** | **大多数 1-3s，偶发 5-10s+** | ✅✅ 最接近真实用户 |

**长尾分布的实现**：真实用户会被通知打断、短暂思考、或离开片刻再回来，导致操作间隔偶发性拉长：

```typescript
// 生成长尾分布的操作间隔
function operationDelay(rand: () => number): number {
  const base = 1000 + rand() * 2000  // 1-3s 基础区间
  // 10% 概率触发「思考停顿」（5-10s）
  if (rand() < 0.10) return 5000 + rand() * 5000
  // 3% 概率触发「分神离开」（15-30s）
  if (rand() < 0.03) return 15000 + rand() * 15000
  return base
}
```

> 如果未来启用行为人格层，长尾分布参数可以进一步由固定种子驱动；当前主线阶段只要求节奏分布不要呈现明显机械规律。

### 4.2 后层扩展：行为人格（Behavior Persona）

> 本节描述的是后层扩展能力，不属于当前主线基线。

每个配置空间绑定一个固化的「行为人格」，跨所有 session 保持一致（真实用户的行为习惯是稳定的）：

```typescript
interface BehaviorPersona {
  // 阅读特征
  readingSpeed: 'fast' | 'normal' | 'slow'   // 影响页面停留时间
  attentionSpan: number                        // 关注度（0-1），越低越容易「跑神」

  // 操作特征
  reactionTime: { min: number; max: number }  // 看到目标到点击的延迟（ms）
  precisionLevel: number                       // 点击精准度（0-1）

  // 节奏特征
  idleProbability: number                      // 每个操作后随机空闲的概率
  idleDuration: { min: number; max: number }  // 空闲时长范围（ms）
  lookbackProbability: number                  // 回头翻看的概率

  // 类型特征
  typingPersona: TypingPersona
}

// Persona 存储在配置空间元数据中，一次生成，永久固化
// 通过 seed 从有限的预设模板中随机选取，避免「人格」过于特殊
```

### 4.3 后层扩展：操作前预热（Pre-operation Warmup）

> 本节描述的是后层扩展能力，不属于当前主线基线，也不应写入当前 Phase 1-3 的实现承诺。

在执行任何目标操作（搜索、发布、评论）之前，必须先在平台上进行自然浏览热身。预热时长和行为由任务类型决定：

```
轻量任务（读取数据）：
  → 最短预热 15-30 秒
  → 浏览推荐流（自然滚动 2-3 屏）
  → 随机停在 1-2 篇内容上「阅读」

标准任务（社交互动：点赞/评论）：
  → 最短预热 30-60 秒
  → 浏览推荐流 + 点开 1 篇内容详情
  → 停留阅读内容（模拟读了全文）
  → 然后执行目标操作

重量任务（发布内容）：
  → 最短预热 60-120 秒
  → 完整的自然浏览序列
  → 浏览竞品内容（做「调研」的样子）
  → 进入创作中心前有停顿
```

### 4.4 操作后余韵（Post-operation Cooldown）

> 本节描述的是后续扩展能力，不作为当前 Phase 1-3 的实现承诺。

操作完成后不立即退出，而是进行短暂的「余韵浏览」：

```
发布完成后：
  → 查看刚发布的内容（检查效果）
  → 浏览推荐流 10-30 秒
  → 自然退出（不是 CLI 直接 kill 进程）
```

### 4.5 操作序列多样化

同一类任务的执行路径不应每次完全相同。但多样化的实现方式对维护成本有决定性影响：

**⚠️ 高维护成本的错误做法：硬编码 CSS 选择器**

```typescript
// 危险：平台每次发版都可能失效
const navigationPaths = [
  () => page.click('.creator-btn-publish .btn-primary'),    // CSS 类名，极易失效
  () => page.click('#profile-tab .publish-entry'),
]
```

**✅ 低维护成本的正确做法：AX Tree 语义查询**

```typescript
// 稳健：基于语义意图而非 CSS 实现，UI 重构后通常仍然有效
const navigationPaths = [
  async () => {
    // 路径 A：从首页找「发布/创作」语义按钮
    const btn = await findAxNode(page, { role: 'button', name: /发布|创作|写笔记/ })
    await page.click(btn)
  },
  async () => {
    // 路径 B：从个人页找发布入口
    await navigateToProfile(page)
    const btn = await findAxNode(page, { role: 'button', name: /发布|写笔记/ })
    await page.click(btn)
  },
  async () => page.goto('/publish/image-text'),   // 路径 C：直接 URL（偶尔）
]
// 每次选择时加入概率权重，并记录上次选择，避免连续使用同一路径
```

**行为引擎与平台适配器的分层原则**：

```
行为引擎（稳定，平台无关）        平台适配器（可变，用 AX Tree 定位）
─────────────────────────         ─────────────────────────────────────
scroll_feed(duration: 30s)   →   findAxNode(role:'feed') + humanScroll()
navigate_to_creator()        →   findAxNode(role:'button', name:/发布/) + click()
read_content(count: 2)       →   findAxNode(role:'article') × 2 + scroll + pause
```

行为引擎只输出**抽象意图**，平台适配器负责将意图翻译为 AX Tree 查询。当平台 UI 改版时，只需更新适配器的语义查询参数（通常改一行 `rules.yaml`），行为引擎层完全不需要改动。

**改版后的快速维护路径（参考 bb-browser「10 分钟 CLI 化」）**：

```
1. webenvoy recon --snapshot -i   → 生成新版本的 AX Tree 快照（约 2 分钟）
2. 对比新旧快照，找到语义节点的变化（「发布」按钮改名为「创作」）
3. 更新 rules.yaml 中的语义查询参数
4. 验证
→ 全程约 10 分钟，不需要读懂平台的 React/Vue 源码
```

---

## 五、Layer 4：账号历史与 Profile 生态

### 5.1 冷启动问题

全新的自动化账号在平台眼里特征明显：

| 信号 | 真实新用户 | 自动化账号 |
|---|---|---|
| Chrome Profile 历史 | 有多个网站的浏览记录 | 只有目标平台 |
| Cookie 生态 | 多个网站的 Cookie | 只有目标平台 |
| localStorage | 有多平台的本地存储 | 空白或只有目标平台 |
| 首次使用平台 | 从搜索或朋友推荐进入 | 直接精准导航 |
| 初始行为 | 浏览、探索、偶尔出错 | 直接高效操作 |

### 5.2 后层扩展：Profile 播种流程（一次性，账号建立时执行）

> 本节描述的是后层扩展能力，不属于当前主线基线。

```
步骤 1：浏览器大环境建立（约 10-15 分钟）
──────────────────────────────────────
目标：让 Chrome Profile 看起来像一个「正在使用的浏览器」

操作序列（由 WebEnvoy 自动执行，用户无需参与）：
  1. 访问百度/搜狗搜索一些通用关键词（科技、生活类）
  2. 点开 2-3 个搜索结果，停留阅读
  3. 访问知乎，浏览首页推荐
  4. 访问微博或 B 站，浏览部分内容
  5. 访问 1-2 个新闻类网站
  → 建立多网站 Cookie、浏览历史、页面缓存

步骤 2：目标平台自然入驻（用户参与登录，约 5-10 分钟）
──────────────────────────────────────────────────────
  1. 通过搜索引擎搜索目标平台名称（不要直接输 URL）
  2. 从搜索结果点击进入（建立来源 referrer）
  3. 用户手动完成登录
  4. 自然浏览首页推荐流（5 分钟）
  5. 打开 3-5 篇内容阅读
  6. 关注 1-2 个账号
  7. 搜索一个关键词，浏览结果
  → 建立平台侧的初始行为基线

步骤 3：基线记录
────────────────
  记录当前 Session 数据：操作时间分布、内容停留时长
  写入 __webenvoy_meta.json 作为该账号的「行为基线参考」
```

### 5.3 后层扩展：账号健康状态追踪

> 本节描述的是后层扩展能力，不属于当前主线基线。
> 下述状态、分数与冷却字段是未来扩展草案，不构成当前 `__webenvoy_meta.json` 或 Phase 1-3 的正式契约。

每个配置空间维护账号健康状态，基于平台响应信号自动更新：

```typescript
type AccountHealthStatus =
  | 'healthy'          // 正常运行
  | 'warming_up'       // 新账号预热期（限制操作频率）
  | 'rate_limited'     // 操作被限速（平台响应变慢/静默失败率上升）
  | 'risk_warned'      // 平台弹出风控提示（需要人工确认）
  | 'feature_limited'  // 部分功能被限制（私信关闭/搜索降权）
  | 'suspended'        // 账号被封禁

interface AccountHealth {
  status: AccountHealthStatus
  score: number                    // 0-100，100 = 完全健康
  lastChecked: Date
  signals: HealthSignal[]          // 导致当前状态的信号记录
  cooldownUntil?: Date             // 冷却结束时间
  operationPace: OperationPace     // 当前建议的操作节奏
}
```

**健康信号来源**：

| 信号 | 权重 | 含义 |
|---|---|---|
| HTTP 471/461 | 严重 | 验证码 / 账号受限 |
| API 响应延迟突增 > 3x | 中等 | 平台开始对此账号限速 |
| 连续静默失败（请求成功但操作未生效）| 高 | 影子封禁信号 |
| 平台前端弹出「异常操作」弹窗 | 严重 | 需要人工确认的风控触发 |
| 操作成功率下降（7 日滚动平均）| 中等 | 账号权重下降 |

**操作节奏自动调整**：

```
健康分 90-100：正常节奏，操作间隔 = 基线
健康分 70-89：轻度放缓，操作间隔 × 1.5
健康分 50-69：显著放缓，操作间隔 × 3，暂停批量写操作
健康分 < 50：仅允许读操作，强制人工介入后才恢复写操作
```

**冷却期指数退避策略**：

当风控触发时（健康分骤降 / rate_limited / risk_warned），账号进入冷却期。冷却时长采用**指数退避**而非固定冷却，原因是触发频率越高，说明账号风险越大：

| 触发次数（当月累计） | 冷却时长 | 冷却结束后状态 |
|---|---|---|
| 第 1 次 | 1 小时 | → 已就绪（正常恢复） |
| 第 2 次 | 4 小时 | → 已就绪（限速恢复） |
| 第 3 次 | 24 小时 | → 已就绪（仅读操作 7 天） |
| 第 4 次及以上 | ∞（人工介入） | → 已封禁 |

```typescript
// 冷却期计算
function cooldownDuration(triggerCount: number): number {
  const hours = [1, 4, 24]
  if (triggerCount - 1 >= hours.length) return Infinity  // 进入 SUSPENDED
  return hours[triggerCount - 1] * 60 * 60 * 1000
}
```

> **设计原则**：立即重试的成功率极低，同时给平台留下「强行突破」信号。指数退避模拟了「用户因账号异常主动暂停使用」的行为模式，更符合平台对真实受限用户的预期。

---

## 六、Layer 5：C++ 内核级（何时、如何处理）

### 6.1 JS 层补丁的局限性

以 Canvas 指纹为例，JS 层的覆盖方式：

```javascript
// 我们能做的：拦截 getImageData 的 JS 调用
const origGetImageData = CanvasRenderingContext2D.prototype.getImageData
CanvasRenderingContext2D.prototype.getImageData = function(...args) {
  const imageData = origGetImageData.apply(this, args)
  // 在 JS 层注入噪声
  for (let i = 0; i < imageData.data.length; i += 4) {
    imageData.data[i] += Math.random() * 2 - 1  // ±1 的随机扰动
  }
  return imageData
}
```

**不能覆盖的部分**：Chrome 扩展的 `chrome.debugger.sendCommand("DOM.getBoxModel")` 或某些高防 SDK 通过 GPU 进程直接读取纹理数据时，绕过了 JS 层的拦截。

### 6.2 何时才需要 C++ 级

目前小红书、抖音的风控 SDK 尚未做到需要 C++ 级反制的程度（这类检测的误伤率极高，会影响虚拟机、远程桌面等大量正常用户）。

**触发条件**：当同一账号通过了 Layer 1-4 的所有防护，仍然被稳定封号，且 Spike 排查确认是 Canvas/WebGL 指纹问题时。

### 6.3 应对路线

**方案 A（当前预留）**：集成 Camoufox 作为「一次性侦察模式」
- 优点：C++ 级 Canvas/WebGL 伪装，指纹完全真实
- 缺点：不支持持久化 Profile，每次启动是全新身份
- 适用：无需账号登录态的平台侦察任务（如公开数据抓取）

**方案 B（未来如需）**：维护轻量级 Chromium Patch
- 仅 patch Canvas `getImageData` 和 WebGL `readPixels` 的实现
- 参考 Camoufox 的 patch 策略（其 patch 集中而精准，不是全面魔改）
- 维护成本：每个 Chromium 大版本更新时 rebase（约每 6 周一次）

**方案 C（商业云方案）**：对接 Browserbase / Kernel 等云浏览器
- 这些云浏览器已内置 C++ 级 Stealth
- 适合不想自维护 Chromium patch 的场景
- 缺点：数据需要经过第三方，不适合敏感账号

---

## 七、反检测能力矩阵

| 能力 | 状态 | 优先级 | 实现位置 |
|---|---|---|---|
| `navigator.webdriver` 清除 | ✅ 设计完成 | P0 | `stealth-patch.js` MAIN World |
| `window.chrome` 修复 | ✅ 设计完成 | P0 | `stealth-patch.js` MAIN World |
| Canvas 像素噪声 | ✅ 设计完成 | P0 | `stealth-patch.js` MAIN World |
| 字体度量扰动 | ✅ 设计完成 | P0 | `stealth-patch.js` MAIN World |
| WebGL 供应商伪造 | ✅ 设计完成 | P0 | `stealth-patch.js` MAIN World |
| WebRTC IP 屏蔽 | ✅ 设计完成 | P0 | `stealth-patch.js` MAIN World |
| 时区统一覆盖 | ✅ 设计完成 | P0 | `stealth-patch.js` MAIN World |
| ShadowDOM 强拆 | ✅ 设计完成 | P0 | `stealth-patch.js` MAIN World |
| **AudioContext 指纹** | ⏳ 待实现 | P0 | `stealth-patch.js` MAIN World |
| **Battery API 伪造** | ⏳ 待实现 | P0 | `stealth-patch.js` MAIN World |
| **`navigator.plugins` 注入** | ⏳ 待实现 | P0 | `stealth-patch.js` MAIN World |
| **`navigator.mimeTypes` 注入** | ⏳ 待实现 | P0 | `stealth-patch.js` MAIN World |
| 指纹一致性（Profile 级固化）| ⏳ 待实现 | P0 | `__webenvoy_meta.json` + 启动加载 |
| **`performance.memory` 随机化** | ⏳ 待实现 | P1 | `stealth-patch.js` MAIN World |
| **硬件参数与 UA 一致性** | ⏳ 待实现 | P1 | `stealth-patch.js` MAIN World |
| ghost-cursor 鼠标轨迹 | ✅ 设计完成 | P1 | CLI 层，CDP 桥接 |
| 悬停确认 + 轻微错过模拟 | ⏳ 待实现 | P1 | CLI 层 |
| **键盘输入节奏（TypingPersona）**| ⏳ 待实现 | P1 | CLI 层 |
| **滚动行为模拟（变速 + 停顿）** | ⏳ 待实现 | P1 | CLI 层 |
| **操作前预热（Warmup）** | 🔜 后层扩展 | 后层 | 上层运行系统 / BehaviorEngine |
| **行为人格（BehaviorPersona）** | 🔜 后层扩展 | 后层 | 上层运行系统 + Profile 元数据 |
| **操作序列多样化** | ⏳ 待实现 | P1 | 平台适配器层 |
| **操作后余韵** | 🔜 后续扩展 | 后层 | CLI 层 / 后续行为引擎 |
| **Profile 播种流程** | 🔜 后层扩展 | 后层 | 上层运行系统 |
| **账号健康状态追踪** | 🔜 后层扩展 | 后层 | 上层运行系统 |
| **操作节奏自动调整** | 🔜 后层扩展 | 后层 | 上层运行系统，基于健康评分 |
| Camoufox 一次性侦察集成 | ⏳ 待实现 | P2 | 独立侦察命令 |
| OS 级输入引擎（最高安全模式）| ⏳ 待实现 | P2 | CLI 层，nut.js |

---

## 八、实现架构

### 8.1 模块划分

```
src/
├── stealth/
│   ├── patches/
│   │   ├── webdriver.ts          # navigator.webdriver
│   │   ├── chrome-context.ts     # window.chrome
│   │   ├── canvas.ts             # Canvas + AudioContext 指纹
│   │   ├── webgl.ts              # WebGL 供应商
│   │   ├── webrtc.ts             # WebRTC IP 屏蔽
│   │   ├── sensors.ts            # Battery、硬件参数
│   │   ├── plugins.ts            # navigator.plugins/mimeTypes
│   │   └── shadow-dom.ts         # ShadowDOM 强拆
│   ├── stealth-patch.ts          # 所有 patch 的入口组装
│   └── fingerprint-seed.ts       # Profile 级指纹种子生成与加载
│
├── behavior/
│   ├── mouse.ts                  # ghost-cursor 封装 + 悬停/错过模拟
│   ├── keyboard.ts               # TypingPersona 实现
│   └── scroll.ts                 # 人性化滚动
│
└── profile/
    └── meta.ts                   # __webenvoy_meta.json 读写
```

### 8.2 启动时序

```
CLI 启动
  ↓
加载 Profile 元数据（fingerprint_seed、local_storage_snapshot、proxy）
  ↓
Playwright launchPersistentContext
  ↓
注册 addInitScript（stealth-patch.ts 编译产物，含 Profile 指纹种子）
  ↓
Extension Background 建立 Native Messaging 连接
  ↓
AI 发出第一条操作命令
  ↓
执行目标操作
  ↓
收集最小执行信号与结构化错误
```

---

## 九、各平台风控水位参考

| 平台 | 主要检测重心 | 主要敏感操作 | 建议安全操作间隔 |
|---|---|---|---|
| 小红书 | 行为序列（Layer 3/4）、设备指纹（Layer 1）| 批量关注、批量评论、频繁发布 | 评论 ≥ 30s / 关注 ≥ 10s / 发布 ≥ 30min |
| 抖音 | 行为生物识别（Layer 3）、设备环境（Layer 1）| 批量投币/点赞、频繁私信 | 私信 ≥ 60s / 点赞 ≥ 5s / 评论 ≥ 20s |
| 微博 | Cookie/IP 关联（Layer 0/4）| 批量转发、批量评论 | 评论 ≥ 15s / 转发 ≥ 10s |
| B 站 | IP + 行为速率（Layer 0/3）| 批量投币、批量关注 | 投币 ≥ 10s / 关注 ≥ 5s |

> 以上数据基于 MediaCrawlerPro 实践经验和社区报告，非官方数据，需通过实际 Spike 验证。

---

## 十、测试与验证

### 10.1 指纹检测验证

实现后，新的 Stealth 补丁需要通过以下检测站点验证：

- [https://bot.sannysoft.com](https://bot.sannysoft.com)（基础自动化检测）
- [https://fingerprintjs.com/demo](https://fingerprintjs.com/demo)（FingerprintJS Pro 级别）
- [https://abrahamjuliot.github.io/creepjs](https://abrahamjuliot.github.io/creepjs)（CreepJS 综合指纹）
- [https://browserleaks.com](https://browserleaks.com)（多维度泄漏检测）

所有检测站点在 WebEnvoy 管理的 Profile 下访问时，结果应与真实用户 Chrome 无统计显著差异。

### 10.2 行为模式验证（分阶段策略）

行为验证按开发阶段分层推进，不同阶段使用不同精度的指标：

**开发期（Phase 1）：可视化直觉验证**
- 记录若干次人工操作和 WebEnvoy 操作的鼠标轨迹、操作间隔数据
- 绘制时序直方图进行肉眼对比，确保分布形状无明显差异（有无「梳齿」状规律峰）
- 成本低，足以发现明显的机械感问题

**集成期（后续扩展 / 安全成熟期）：真实平台 A/B 测试（最高可信度）**
- 在真实平台上分别用「开启 Stealth」和「关闭 Stealth」的账号跑等量操作
- 监控 7 日封号率和限流触发率差异
- 这是最能反映平台实际判定的指标，任何统计模型都无法替代

**成熟期（长期目标）：分布相似性量化**
- 在积累足够样本后（建议各类操作 ≥ 100 次 session），引入统计检验
- 目标参考值：KL 散度 < 0.1（统计上不可区分）
- 注意：开源的鼠标轨迹 ML 检测模型可作为辅助参考，但不作为主要标准——这类模型基于通用数据集训练，不代表 XHS/抖音实际部署的检测模型，通过开源模型不等于通过平台风控

> 早期不应追求 KL 散度等精确统计指标，应以真实平台封号率作为核心验收标准。

---

## 十一、完整蓝图与 Backlog 映射

本章用于把 `anti-detection.md` 中已经设计的完整体系，正式映射到阶段化落地与 GitHub backlog 真相源中，避免后续只围绕最小前置推进而遗漏长期能力。

### 11.1 规划原则

- 反风控完整体系以本架构文档为上位蓝图，不再新建平行蓝图文档。
- GitHub Issues / Milestones 继续作为 backlog 真相源；本地文档只负责冻结能力地图、阶段顺序与 issue 映射。
- `Phase 1.x / Sprint 2 / Sprint 3` 只承接最小前置与最小执行能力，不等于完整反风控体系已经完成。
- 后续能力按“必须前置 / 应尽早落地 / 后层扩展”分层推进，而不是一次性平铺成大量近期实现项。

### 11.2 分层落地顺序

| 层/能力组 | 当前定位 | 当前承接层 |
| --- | --- | --- |
| Layer 0 网络层指纹 | 浏览器内执行天然解决大部分问题，仅保留补充观察 | 先写入蓝图，不单独立项 |
| Layer 1 JS 指纹补全与 profile 一致性 | 应尽早进入正式 backlog | `Phase 2` 延续能力 |
| Layer 2 事件级拟人模拟 | 最小边界已进入 Sprint 3，完整能力后移 | `Phase 2` 延续能力 |
| Layer 3 Session 级行为节律 | 最小规则已进入 Sprint 3，完整引擎后移 | `Phase 2` 延续能力 |
| Layer 4 平台行为模型与长期基线 | 明确属于核心差异化，但不在最小前置内完成 | 后层扩展 |
| Layer 5 内核级/Camoufox 级策略 | 极端场景外部依赖路线 | 后层扩展 |

### 11.3 当前已承接能力

以下能力已经进入 roadmap / FR / Sprint backlog，不再属于“未规划”：

| 范围 | 当前承接 |
| --- | --- |
| 反风控前置阶段治理 | `#216` |
| 风险审查与保护门禁基线 | `#213` / `FR-0009` |
| Sprint 2 风险门禁与执行硬化 | `#220`、`#218`、`#219`、`#221`、`#223` / `FR-0010` |
| Sprint 3 最小反风控执行能力 | `#217`、`#224`、`#225`、`#226`、`#227` / `FR-0011` |

### 11.4 新增总控与后续 Backlog 映射

为避免完整体系继续散落在架构描述中，新增以下 GitHub 真相源：

| 类型 | Issue | 作用 |
| --- | --- | --- |
| 总控 umbrella | `#232` | 反风控能力总蓝图与分层落地总控 |
| Phase 2 延续 umbrella | `#233` | 承接最小前置之外、但应尽早实现的反风控主线 |
| 后层扩展 umbrella | `#234` | 承接 Layer 4+ 与长期扩展能力 |
| Layer 1 主线 | `#235` | JS 指纹补全与 profile 一致性 |
| Layer 2 主线 | `#236` | 事件级拟人模拟增强 |
| Layer 3 主线 | `#237` | 完整 session 行为节律引擎 |
| Layer 4 主线 | `#238` | 平台行为模型与长期基线 |
| 验证主线 | `#239` | 反风控验证与基线评估 |

### 11.5 哪些能力进入近期 backlog，哪些只冻结在蓝图

**进入近期 backlog：**

- Layer 1 JS 指纹补全与 profile 一致性（`#235`）
- Layer 2 事件级拟人模拟增强（`#236`）
- Layer 3 完整 session 行为节律引擎（`#237`）
- 反风控验证与基线评估（`#239`）

**进入后层扩展，但现在就冻结到蓝图：**

- Layer 4 平台行为模型与长期基线（`#238`）
- 行为人格（Behavior Persona）
- 长期行为画像与跨平台策略扩展
- Layer 5 / Camoufox 级极端场景策略

**当前仅在蓝图中保留，不单独立项：**

- Layer 0 网络层进一步增强
- 账号矩阵、养号运营、长期运营系统

### 11.6 执行约束

- 后续若新增反风控 backlog，应优先引用 `#232`，再挂到对应 umbrella，而不是直接孤立开 issue。
- `Phase 2` 不得再被表述为“反风控建设已完成后的纯封装阶段”；它仍承接 Layer 1/2/3 的延续建设。
- 若某能力尚未进入 backlog，但已在本蓝图中被标记为“应尽早落地”或“后层扩展”，后续 roadmap / Sprint 调整时必须显式处理，不能视为不存在。
