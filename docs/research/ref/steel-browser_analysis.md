# steel-dev/steel-browser 深度调研报告

## 1. 宏观信息
- **仓库地址**: [steel-dev/steel-browser](https://github.com/steel-dev/steel-browser)
- **Stars**: ~6.6k
- **定位**: 专为 AI Agent（特别是长链条规划型 Agent）设计的开源云端无头浏览器编排中间件（API 平台）。
- **核心技术栈**: TypeScript, Fastify, Puppeteer-core, DevTools Protocol (CDP)。

## 2. 核心架构与底层机制 (API-Driven Browser Sandbox)
它的目标是屏蔽一切浏览器生命周期管理的脏活，对外提供极简的 HTTP API 给 Python/Node 的 AI Agent 调用。

### 2.1 高级会话与上下文热迁移 (Session & Context Service)
普通的爬虫用完浏览器就销毁，而 Steel Browser 为 Agent 引入了“休眠与恢复”：
- **`ChromeContextService`**: 当一个 Session 结束（挂起）时，它不会直接杀掉容器，而是从 Chrome 的 `UserDataDir` 物理目录中暴力提取当前网站的 `localStorage`, `sessionStorage`, `indexedDB` 和全量子域 Cookies 保存进数据库。
- **重新注入 (`injectSessionContext`)**: 当 Agent 几个小时后重新激活任务，引擎用一个空实例，通过给所有 Page 绑定触发器，并在新 Tab 产生的第一时间执行注入闭包脚本定点复原之前的 `localStorage` 和 `Cookies`。这让 Agent 可以跨越时间、跨越机器地“无感恢复登录态”。

### 2.2 防护伪装与节流优化 (Interception & Anti-Detection)
运行大规模的 AI Agent 非常烧钱（一方面是 API Token，另一方面是云端浏览器的 CPU 和出网流量带宽）。
- **带宽极限压榨 (`handlePageRequest`)**: 这是它的隐性杀手锏功能。通过劫持 CDP 底层的网络请求钩子，当开启了带宽优化参数时，引擎会在网卡之前极其无情地直接 `abort` 掉网页内所有的广告 Tracker (`isAdRequest()`)，所有的 `Image`, `Media` 和外来字体渲染请求。这能将 Agent 获取一个网页 DOM 的耗时从 3 秒缩短到 0.2 秒。
- **深度防指纹 (`fingerprint-generator`)**: 通过 `injectFingerprintSafely` 在所有页面刚孵化的时候抢先执行伪造脚本 (`evaluateOnNewDocument`)，篡改 WebGL Vendor、欺骗屏幕分辨率并隐藏 `navigator.webdriver`标识。

### 2.3 状态恢复的深度与死角
- **深度支持**：`ChromeContextService` 不仅能通过 LevelDB 暴力读取 LocalStorage，还明确支持 **SessionStorage 的跨实例提取与注入**，这是普通抓包工具难以实现的。
- **已知死角**：当前机制对于 **WebSocket 链接状态** 和 **ServiceWorker 运行时状态** 无能为力。对于重度依赖 PWA 离线逻辑或实时长连接的应用（如某些加密聊天网页），恢复会话后必须由应用层逻辑触发重新握手（Re-handshake）。

## 3. 总结与借鉴价值
Steel Browser 取长于大规模基础云原生服务设计。
对于 WebEnvoy 的启发：
1. **网络拦截与提速 (Request Interception)**: WebEnvoy 即便在本地执行交互时，也可以大幅借鉴其 Request Intercept 策略。Agent 在进行很多纯文本信息的总结、提报、填表动作时，眼睛是不需要加载高清图片和 CSS 的。提前在请求层拦截不仅极大省耗电，还能极大提升 RPA 脚本向下一步跳转的速度。
2. **状态快照游离**: Agent 对目标的探索应该是可以暂停的。保存 Cookies 并不新鲜，提取和恢复完整的 `LocalStorage/IndexedDB` 快照能让很多依靠前端缓存鉴权的现代 React App (如 Telegram Web) 免受登录状态丢失的折磨。
