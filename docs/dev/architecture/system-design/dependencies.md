# 外部依赖与参考项目集成决策

> 所属文档：[系统设计（战术层）](../system-design.md)
> 更新日期：2026年03月17日
> 调研报告来源：`docs/research/ref/`

本文档明确 WebEnvoy 与每个参考项目的关系边界，避免在实现阶段出现「这个库到底用不用」的模糊地带。

**集成方式定义**：

| 代号 | 方式 | 含义 |
|---|---|---|
| **A** | npm 直接依赖 | `npm install xxx`，运行时直接 import 调用 |
| **B** | 算法移植 | 提取核心算法逻辑，用 TypeScript 在 WebEnvoy 代码库中重新实现，不引入外部包 |
| **C** | 子进程集成 | 通过 `child_process.spawn` 调用外部二进制或 Python 运行时，stdio JSON 通信 |
| **D** | 概念借鉴 | 仅借鉴设计思路，不引入任何外部代码 |

---

## A. npm 直接依赖

### Playwright
- **阶段**：Phase 1
- **用途**：浏览器进程管理（启动、Profile 加载、崩溃恢复）+ CDP Input 物理输入通道
- **安装**：`npm install playwright`
- **边界**：不执行业务逻辑，业务逻辑由 Extension Content Script 编排

### nut.js
- **阶段**：Phase 1（预留接口，Phase 4 完整启用）
- **用途**：最高安全模式（`--mode safe`）的 OS 级键鼠输入，`isTrusted = true`
- **安装**：`npm install @nut-tree/nut-js`
- **加载策略**：延迟加载，仅在 `--mode safe` 时 `require()`，避免默认模式引入 Native 编译依赖
- **平台要求**：macOS 需授予辅助功能权限，Windows 需管理员权限

---

## B. 算法移植

### ghost-cursor
- **阶段**：Phase 1
- **用途**：拟人化鼠标轨迹生成（贝塞尔曲线 + 菲茨定律控速 + 过冲模拟）
- **为什么不直接 npm install**：
  - `createCursor()` 接受 Puppeteer `Page` 对象，不兼容 Playwright
  - 包装适配层的成本高于直接移植核心数学逻辑
  - 核心代码量小（约 300 行纯数学函数），无复杂外部依赖
- **移植范围**：提取以下四个核心函数，在 `src/input/mouse.ts` 中用 TS 重写：
  - `bezierCurve()` — 三次贝塞尔路径生成
  - `generateBezierAnchors()` — 随机控制锚点（单侧外扩）
  - `fitts()` — 菲茨定律动态步数计算
  - `overshoot()` — 过冲点计算与反向微调路径
- **输出接口**：生成带时间戳的 `Vector[]` 坐标序列，直接喂给 CDP `Input.dispatchMouseEvent`

### agent-browser
- **阶段**：Phase 2（Spike D 产出）
- **用途**：L2 通用读取层的 AX Tree 压缩 + RefMap 短引用系统
- **为什么不直接 npm install**：它是完整的 CLI 工具（Rust CLI + Node Daemon），不是可 import 的 library
- **移植范围**（Spike D 的具体目标）：
  - `processAriaTree()` — AX Tree 降噪过滤（移除 ignored/generic/none 节点）
  - `compactTree()` — 递归裁切空文本和无交互引用的死区分支
  - `findCursorInteractiveElements()` — 补充发现 `cursor: pointer` / `onclick` / `tabindex` 非标交互元素
  - `nextRef()` + RefMap — 短引用 ID 分配与 `@eN → Playwright Locator` 映射
- **产出文件**：`src/l2/ax-tree.ts` + `src/l2/ref-map.ts`

---

## C. 子进程集成

### Camoufox
- **阶段**：Phase 1 预留接口，按需启用
- **用途**：极端高防场景的一次性侦察模式（C++ 内核级 Canvas/WebGL/Font 指纹伪装）
- **集成机制**：
  ```
  CLI 命令: webenvoy recon --url "https://..." --mode camoufox
      ↓
  spawn('python', ['-m', 'camoufox', '--config', configPath])
      ↓
  通过 stdio JSON 通信（启动参数 → 结果回传）
  ```
- **约束**：
  - 需要目标机器安装 Python 3.9+ 和 `pip install camoufox`
  - 不支持 Profile 持久化（`user_data_dir` 重启后状态不恢复），只做一次性任务
  - 不作为主运行时，不参与日常账号保活
- **触发条件**：默认档 Stealth 补丁已无法通过目标平台风控时，由用户手动触发

---

## D. 概念借鉴

以下项目均不引入代码，其设计思路已被提炼并写入架构文档。

### MediaCrawlerPro
- **阶段**：已吸收
- **已吸收内容**：Content Script MAIN World 签名调用模式 → `read-write.md §6.2`；CookieBridge 思路 → `account.md`；平台 API 端点结构 → Spike A/B 验证目标
- **不集成原因**：私有仓库，Python 技术栈，独立 SignSrv 微服务违反单一进程原则

### MultiPost-Extension
- **阶段**：已吸收
- **已吸收内容**：`DataTransfer` 文件上传方案 → `read-write.md §5.2`；顺序发布队列 + 隐式频率控制 → `adapter.md`
- **不集成原因**：硬编码 DOM 选择器模式是 WebEnvoy 要避免的，走 AX Tree 语义定位

### bb-browser
- **阶段**：已吸收
- **已吸收内容**：Tier 1/2/3 分层适配器思想 → `adapter.md` + `ARCHITECTURE_PRINCIPLES.md`；`window.__INITIAL_STATE__` 内存态直读 → `read-write.md §4.1`；「10 分钟 CLI 化」维护路径 → `adapter.md`
- **不集成原因**：Go 技术栈 + SSE 通信架构，与 WebEnvoy TS + Native Messaging 栈不兼容

### browser-use
- **阶段**：Phase 2（Spike D 扩展范围）
- **待吸收内容**：
  1. **Paint Order 遮挡剔除**：通过 `DOMSnapshot.captureSnapshot` 获取绘制层级，剔除被弹窗完全遮盖的「幽灵元素」→ 产出 `src/l2/paint-order.ts`
  2. **JS 隐式事件捕获**：注入脚本调用 `getEventListeners()` 发现无标准 ARIA 角色的非标交互元素
- **不集成原因**：Python + LangChain 生态，5 维数据融合管线过重

### Steel Browser
- **阶段**：Phase 2（Spike E 目标）
- **待吸收内容**：`handlePageRequest` 中的广告/图片/字体屏蔽规则 → 转化为 Chrome `declarativeNetRequest` 静态规则集
- **不集成原因**：云端 SaaS 服务（Docker + Fastify），不是可本地集成的库

### scrapling
- **阶段**：Phase 3
- **待吸收内容**：8 维自适应选择器 Schema；`__calculate_similarity_score` 多维加权模糊匹配算法；StealthyFetcher 8 项反检测补丁清单
- **不集成原因**：Python 库；自适应定位在 AX Tree 架构下需重新设计，不能照搬

### pinchtab
- **阶段**：已吸收
- **已吸收内容**：RefCache 数据结构 → 已被 agent-browser RefMap 方案覆盖；Named Profile 多开隔离 → `account.md`；5 维 Token 优化策略 → L2 设计考量
- **不集成原因**：Go 技术栈；核心机制已通过 agent-browser 和自研设计覆盖

### UI-TARS
- **阶段**：Phase 4
- **待吸收内容**：「截图 → VLM → 坐标 → nut.js 物理点击」的 L1 执行链路；5 帧滑动窗口防单帧误判；Hybrid 模式坐标反向映射
- **不集成原因**：Electron 桌面应用，与 WebEnvoy 架构不兼容

### Crawlee
- **阶段**：已吸收
- **已吸收内容**：
  1. **错误信号累计思路**：保留“把失败信号结构化记录起来”的思想，但不把 Session 健康度退场机制直接带入当前主线 → 由 `error-handling.md` 的结构化错误与后续扩展承接
  2. **代理黏性绑定**：`sessionId → proxyUrl` 一对一映射，只保留执行必需的最小黏性绑定，不扩展为账号池调度逻辑 → `account.md §7.1` Proxy 黏性绑定
  3. **操作间隔分布选型**：均匀分布可被统计检测，推荐长尾分布 → `anti-detection.md §4.1` 操作间隔分布模型
- **不集成原因**：Node.js 爬虫框架（含浏览器管理 + 调度），与 WebEnvoy「CLI 轻 core + Chrome Extension 重前端」架构不兼容

### Selenoid
- **阶段**：后续扩展（云端/容器化部署参考）
- **待吸收内容**：Docker 容器级代理隔离模型（每容器独立 `HTTP_PROXY` 环境变量，天然无泄漏）→ WebEnvoy 多实例部署时的容器化方案参考
- **不集成原因**：Selenium/WebDriver 协议 Hub，与 WebEnvoy 的 Chrome Extension + Native Messaging 架构不兼容；Phase 1 本地单机场景无需容器隔离

### KeePassXC
- **阶段**：已吸收（Native Messaging 注册机制，见本文末章节）
- **已吸收内容**：三平台 Native Messaging Host 注册路径字典 + Windows 注册表写入方案
- **不集成原因**：C++/Qt 桌面应用，不存在可调用的 API

### Goldwarden
- **阶段**：已吸收（对照验证 Linux 路径）
- **已吸收内容**：Linux 各浏览器 NativeMessagingHosts 目录路径（与 KeePassXC 交叉验证）
- **不集成原因**：仅支持 Linux，项目已暂停开发

### 无架构价值项目

以下项目经评估后确认没有可提取的架构价值：

| 项目 | 判定理由 |
|---|---|
| page-agent | FlatDomTree 思路已被 AX Tree 方案替代 |
| nanobrowser | ShadowDOM 强拆（`attachShadow` 原型篡改）已写入 Stealth 补丁清单 |
| automa | NoCode 拖拽范式，与 WebEnvoy CLI 优先定位不符 |
| maxun | 可视化爬虫构建器，定位不同 |
| lightpanda | Zig 无头浏览器，与 Chrome Extension 架构不兼容 |
| browseros | 与 Camoufox 路径重叠，已通过 Camoufox 覆盖 |
| donutbrowser | Electron 桌面浏览器壳，无可复用组件 |
| aipex | Chrome 侧边栏 AI 助手，无架构参考价值 |
| web-clipper | 网页剪藏工具，非自动化场景 |
| single-file | 网页单文件存档，非自动化场景 |
| res-downloader | 资源嗅探下载，非自动化场景 |
| joplin | 笔记应用，非自动化场景 |
| cat-catch | 媒体资源抓取，非自动化场景 |
| we-mp-rss | 微信公众号 RSS，非自动化场景 |
| RSSHub | RSS 聚合路由，非自动化场景 |


---

## 依赖清单汇总

### 运行时 npm 依赖（Phase 1）

```jsonc
{
  "dependencies": {
    "playwright": "^1.x"           // 浏览器进程管理 + CDP 通道
  },
  "optionalDependencies": {
    "@nut-tree/nut-js": "^4.x"     // 仅 --mode safe 时加载
  }
}
```

### 自研模块（含算法移植）

| 模块 | 集成方式 | 来源 | 阶段 |
|---|---|---|---|
| `src/input/mouse.ts` | B | ghost-cursor 算法移植 | Phase 1 |
| `src/install/native-host.ts` | D | KeePassXC 注册机制参考 | Phase 1 |
| `src/l2/ax-tree.ts` | B | agent-browser 算法移植 | Phase 2 |
| `src/l2/ref-map.ts` | B | agent-browser 算法移植 | Phase 2 |
| `src/l2/paint-order.ts` | D | browser-use 思路实现 | Phase 2 |

### 外部运行时（可选，用户自行安装）

| 运行时 | 集成方式 | 触发条件 |
|---|---|---|
| Python 3.9+ / Camoufox | C | `--mode camoufox` 一次性侦察 |
