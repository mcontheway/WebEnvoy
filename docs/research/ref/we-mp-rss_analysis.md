# 调研报告：rachelos/we-mp-rss 架构与反爬机制深度拆解

> 版本：v1.0
> 状态：完工（已集成 DeepWiki 深度分析）
> 目标：深度解析 `we-mp-rss` 的抓取流程、会话管理以及高级反爬对抗技术。

---

## 一、 项目定位

`we-mp-rss` (WeRSS) 是一个专为微信公众号设计的自动化感知与订阅提取系统。它旨在突破微信生态的封闭性，将公众号内容转化为 Markdown、JSON 或 RSS 等开放格式。

---

## 二、 核心抓取架构

系统通过 `WxGather` 抽象基类定义了三套相互补充的抓取链路，以应对不同层级的反制。

### 2.1 链路组成
*   **API 模式 (`MpsApi`)**：直接同微信公众平台后端接口交互，效率最高，但风险最大。
*   **Web 模式 (`MpsWeb`)**：模拟 PC 端浏览器行为。
*   **App 模式 (`MpsAppMsg`)**：模拟移动端微信 App 的数据请求。

### 2.2 工作流程
1.  **任务分发**：根据配置模型选择最佳抓取子类。
2.  **列表获取 (`get_Articles`)**：从历史页面或实时推送中检索文章元数据。
3.  **内容萃取 (`content_extract`)**：下载 HTML，利用代理池绕过初步 IP 封禁，并执行正文降噪。

---

## 三、 微信会话管理机制 (Session Management)

微信公众号的操作严格依赖实名认证的 Session。WeRSS 提供了两套方案：

### 3.1 Playwright 浏览器模式 (`Wx` 类)
*   **交互登录**：自动驱动浏览器打开登录页，截取二维码供用户扫码。
*   **静默回传**：监听 `framenavigated` 事件，一旦检测到成功跳转，立即从 URL、`localStorage` 和 Cookie 中剥离 `token` 与会话密钥。
*   **持久化**：将敏感凭证存入 `data/wx.lic`，通过 `driver/cookies.py` 计算最短过期时间并执行自动重刷。

### 3.2 API 模式 (`WeChatAPI` 类)
*   通过纯 HTTP 协议模拟扫码流程，适用于无头环境（Headless）下的二次开发与集成。

---

## 四、 浏览器自动化与反爬检测绕过 (Anti-Detection)

WeRSS 在 `PlaywrightController` 中实现了一套极其成熟的指纹伪装系统。

### 3.1 静态特征掩盖
*   **JS 注入**：向页面实时注入脚本，强行将 `navigator.webdriver` 改写为 `false`，并构造虚假的 `window.chrome` 与 `navigator.plugins`。
*   **指纹随机化**：每次启动生成唯一的 UUID 关联随机的 User-Agent、Viewport 以及 HTTP Headers（Accept-Language 等）。

### 3.2 行为仿真 (Human Behavior Simulation)
*   **多维度对抗**：利用 `driver/anti_crawler_advanced.js` 模拟人类的随机滚动（Scrolling）、鼠标悬停与移动轨迹。
*   **时序攻击防护**：在关键点击操作间插入 50-150ms 的随机延迟，防止 WAF 识别出规律性的机器操作节奏。
*   **环境探测规避**：针对常见的自动化检测项（如 Selenium 特征属性）执行针对性抹除。

---

## 五、 技术总结

WeRSS 的核心价值在于其**针对高度封闭 Web 生态的“破窗能力”**。它不仅解决了数据获取的问题，更建立了一套包含会话维持、环境伪装和人类行为模拟在内的完整自动化工程体系。对于处理具有强账号属性和复杂指纹校验的目标平台，具有极高的参考意义。
