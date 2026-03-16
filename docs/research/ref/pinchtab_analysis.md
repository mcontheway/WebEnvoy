# pinchtab/pinchtab 深度调研报告

## 1. 宏观信息
- **仓库地址**: [pinchtab/pinchtab](https://github.com/pinchtab/pinchtab)
- **Stars**: ~7.7k
- **定位**: Go 语言编写的高性能浏览器自动化多实例编排器 (Orchestrator)，专为大模型 Agent 提供 HTTP REST API 控制端点。
- **核心技术栈**: Golang, chromedp, Chrome DevTools Protocol (CDP)。

## 2. 核心架构与底层机制 (The Bridge & Orchestrator)
PinchTab 并没有采用 Playwright 或 Puppeteer 这类重型封装，而是直接使用 Golang 的 `chromedp` 库进行了底层的 CDP (Chrome DevTools Protocol) 桥接。

### 2.1 多开编排器 (Multi-Instance Orchestrator)
在大模型 Agent 场景下，经常需要同时跑多个相互隔离的任务（比如 5 个 Agent 分别处理 5 个不同的网站）：
- **端口分配器 (`PortAllocator`)**: Orchestrator (默认跑在 `9867` 端口) 维护了一个中央路由表。当外部发来 `POST /instances/launch` 请求时，它会动态寻址一个空闲系统端口，配置好环境变量和互相隔离的 `UserDataDir`，然后利用 `os/exec` 直接拉起一个干净状态的 Google Chrome 子进程。
- **CDP Bridge (网关桥接)**: 它将所有针对该实例的 `/tabs/{id}/navigate` 或执行操作的 HTTP 请求，实时翻译成发往那个 Chrome 实例对应端口的 WebSocket 二进制 CDP Frame。

### 2.2 无障碍对象模型与视图快照 (A11y Tree & Snapshot)
这是 PinchTab 对于 AI Agent 设计最惊艳的地方。它完全放弃了传统的 DOM 抽取策略，而是直接**榨取浏览器的无障碍计算树 (Accessibility Tree)**：
- **`Accessibility.getFullAXTree`**: 当 Agent 发起 `/snapshot` 获取页面状态时，底层请求的是 CDP 的无障碍接口。浏览器内核会自动将冗杂的 HTML (包括嵌套十几层的 `div`) 提纯为视障人士阅读的逻辑树。
- **降噪清洗 (`BuildSnapshot`)**: PinchTab 会丢弃 `Ignored`、`generic`、`none` 这种没有实际交互意义的纯视觉节点，最终吐出带有语义的 `A11yNode` 列表（如 button、link、textbox）。
- **指针缓存 (`RefCache` ID 追踪)**: 洗出来的每一个有效交互节点都会被临时打上一个引用短 ID (如 `e0`, `e1`)，并在 Go 内存池里维护 `Ref -> BackendDOMNodeID` 的生命周期映射。
- **精准狙击**: 当 LLM 返回 `{"action": "click", "target": "e1"}` 时，系统从缓存找出真实 `NodeID` 下发原生 CDP 点击。只要该组件在视图状态机里没被销毁，即使网页的 CSS 结构或 XPath 彻底变形了，点击依然百分百生效。

## 3. 技术进阶：PinchTab 的核心工程细节

通过对源码和官方 Wiki 的深度挖掘，PinchTab 在处理大模型交互（LLM-Interaction）展现了极高的工程素养：

### 3.1 `RefCache` 的具体实现逻辑
在 `internal/bridge/tab_manager.go` 中，PinchTab 为每一个 Tab 维护了一个影子缓存环：
- **数据结构**: 
  ```go
  type RefCache struct {
      Refs  map[string]int64 // 短引用 (如 "e0") -> BackendDOMNodeID (int64)
      Nodes []A11yNode       // 当前页面的无障碍节点完整元数据
  }
  ```
- **稳定性与失效**: 指针 ID (`ref`) 在页面没有发生重大导航或重绘前是稳定的。PinchTab 允许对同一个 `ref` 执行多次链式操作。如果发生刷新，系统建议重新触发 `/snapshot` 刷新缓存，而不是试图去通过模糊匹配找回（这点与 Scrapling 的自愈思路不同，它选择的是更廉价、可靠的实时刷新方案）。

### 3.2 五维度 Token 优化策略 (Compression)
为了降低 AI 调用的账单成本，PinchTab 在快照阶段提供了极度灵活的参数：
1. **交互式过滤 (`?filter=interactive`)**: 基于 A11y 树的 `Role` 属性，只返回按钮、链接、输入框等关键交互点，直接裁掉 80% 以上的只读信息。
2. **紧凑模式 (`?format=compact`)**: 将 JSON 数据压缩为每行一个元素的扁平结构。
3. **深度裁剪 (`maxDepth`)**: 允许限制树的深度。
4. **差异快照 (`?diff=true`)**: 仅返回自上次快照以来发生变化的元素（Incremental Snapshot）。
5. **纯文本模式 (`/text` 端点)**：直接下刷经过清洗的可读纯文本文档。

### 3.3 Stealth Mode (反探测“重装甲”)
这是 PinchTab 真正具备商业竞争力的底层模块（通过 `BRIDGE_STEALTH=full` 开启），其抗检测覆盖面非常广泛：
- **基础级**: 移除 `navigator.webdriver`、伪造 User-Agent、隐藏自动化控制标志。
- **图形与指纹级**: 注入 **Canvas 细微噪声**（防止海希特征追踪）、代理 `TextMetrics` 对象注入 **字体度量噪声**。
- **硬件环境级**: 伪造 WebGL 供应商信息（如强制标记为 "Intel Inc."）、虚拟化 `navigator.plugins` 列表确保其看起来像有安装常用插件。
- **地理与行为级**: 通过 CDP 强制覆盖 **时区 (Timezone)**、随机指纹轮换（UA Rotation）。
### 3.4 Instance 与 Profile 的账号隔离机制
PinchTab 实现了工业级的“指纹浏览器”多开隔离标准，确保多账号并发时数据不污染：
- **Instance (独立进程隔离)**: 每一个 Instance 都是一个独立的 Chrome 进程。PinchTab 通过中央分配器为每个实例指定唯一的 HTTP 调试端口，在外部实现请求路由。
- **Profile (物理目录隔离)**: 通过强制绑定 `--user-data-dir` 启动参数。
    - **命名 Profile (Named)**: 数据持久化在磁盘（如 `profiles/<name>/`），用于长期维持登录态（Cookies/LocalStorage），实现账号资产的稳定托管。
    - **临时 Profile (Temporary)**: 随进程关闭而自动抹除，适用于匿名采集任务。
- **隔离效果**: 这种物理级的目录隔离确保了 Cookies、IndexedDB 和插件配置在不同账号间完全独立，支持同一站点下无限多开账号并发。

### 3.5 多 Agent 并发竞态与 Tab 锁定机制
当多个 AI Agent 需要协同操作时，PinchTab 提供了两层防竞态机制：
- **第一层（实例级）**：为每个 Agent 分配独立的 Chrome 实例，进程间天然无共享状态，是首选方案。
- **第二层（Tab 级）**：当多个 Agent 必须共用同一实例时，通过 `POST /tab/lock` API 在 Tab 级别上锁：
  ```
  POST /tab/lock  Body: { "owner": "agent-A", "timeoutSec": 30 }
  ```
  若另一 Agent 尝试操作已锁定的 Tab，将立即收到 **409 Conflict** 响应。锁超时自动释放，防止死锁。

### 3.6 SMCP Plugin 工具集成协议（LLM 工具调用桥接）
PinchTab 通过 SMCP Plugin 将浏览器操作暴露为 LLM 可直接调用的工具函数，这是其与 AI Agent 生态深度集成的关键设计：
- **工具命名格式**：`<plugin>__<command>`，例如 `pinchtab__navigate`、`pinchtab__snapshot`、`pinchtab__click`。
- **执行机制**：LLM 调用工具时，SMCP 将参数以命令行形式传递给 `plugins/pinchtab/cli.py`，插件执行 HTTP API 后将结果以 JSON 打印到标准输出返回 LLM。
- **暴露的工具函数列表**：`health`、`instances`、`instance-start`、`navigate`、`snapshot`、`action`、`text`、`screenshot`、`evaluate`、`cookies-get`、`stealth-status` 等。

> **对 WebEnvoy 的启发**：WebEnvoy 未来若需接入 LLM 工具调用体系，可直接参考此 `cli.py -> HTTP API -> JSON stdout` 的桥接范式，这与我们"CLI 作为入口代理"的架构哲学高度吻合。

## 4. 调研结论与 WebEnvoy 借鉴价值

PinchTab 基本上定义了一个成熟的“面向 Agent 的执行器”该有的全部修养。
对 WebEnvoy 的启发极其深远：
1. **彻底放弃 DOM parser**: 不要再去自己写脚本计算按钮偏移。让 Chrome 的无障碍计算层帮我们算！
2. **原子化 Ref 缓存系统**: 学习其 `RefCache` 的 map 实现，这是解决 LLM “眼高手低”最稳健的桥梁。
3. **分级的 Stealth 策略**: 我们的 Fallback 容器应直接整合 PinchTab 报告中提到的 Canvas/TextMetrics 噪声注入技术，这是对抗现代 WAF 的行业标准。
4. **Token 敏感型设计**: 它的 `filter=interactive` 参数可以作为 WebEnvoy 数据提取层的核心默认配置。
5. **账号资产管理标准化**: WebEnvoy 应学习其 `Named Profile` 机制，为每个托管账号建立独立的 UserDataDir，并支持 Profile 文件夹的整体备份与云端热迁移，从而实现“一次登录，全网随处复活”。
