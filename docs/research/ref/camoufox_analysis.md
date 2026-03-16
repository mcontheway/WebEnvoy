# daijro/camoufox 深度调研报告

## 1. 宏观信息
- **仓库地址**: [daijro/camoufox](https://github.com/daijro/camoufox)
- **Stars**: ~6.1k
- **定位**: 底层防关联浏览器 (Anti-detect browser)，专为自动化突破严格的反爬虫检测（如 Cloudflare, Datadome）打造。
- **核心技术栈**: C++ (Firefox 源内核魔改), Python (Playwright 封装桥梁)。

## 2. 核心架构与底层机制 (C++ 级伪装)
不同于市面上常用的 `puppeteer-extra-plugin-stealth` (JS 注入级别的伪装极易被探测到 `Proxy` 的 `toString` 异常或运行期竞态泄漏)。Camoufox 走了一条维护成本最高、但也最硬核的路：**直接修改 Firefox 的 C++ 源码并重新编译**。

### 2.1 MaskConfig 核心注入引擎
系统内部存在一个名为 `MaskConfig` 的中央配置单例：
- 它通过超长环境变量接收来自外部 Python 启动器喂进去的真实设备指纹 JSON 数据，并在 C++ 层缓存解析。
- **WebGL 劫持**: 在 Firefox 渲染管线 `ClientWebGLContext.cpp` 内部，所有的 `GetParameter` 或 `GetContextAttributes` 方法都会先走 `MaskConfig::GLParam()`。如果不命中才回调原生实现。这就让 WebGL 的生产商 (Vendor)、渲染器和抗锯齿参数 (AA Offset) 伪装表现得像真的是硬件返回的一样，没有任何 JS Hook 痕迹。

### 2.2 防护体系扩展
- **字体白名单与哈希间距 (Font Spacing Seed System)**: 专门针对 `Canvas` 字体大小测量指纹。它不只是随机扰动 Canvas 像素。其深层修改了底层的 **HarfBuzz 文本整形器 (`gfxHarfBuzzShaper::ShapeText()`)**，通过 `FontSpacingSeedManager` 为每个 Context 埋入一个确定的噪音 Seed，在排版时微调字形偏移度，使得浏览器指纹绝对唯一且同一设备内稳定。
- **隔离的 Juggler 通道**: 引入 `Juggler.js` 并通过补丁大幅修改了 Firefox 以原生支持 Playwright 自动化管线。更重要的是修改了 `Navigator.cpp` (使其始终伪装 WebDriver 为 false) 并把 Playwright 的 Page Agent 框架隔离在不可见的底层沙盒中，避免网站 JS 通过枚举原型链抓包到 Playwright 特征。

## 3. Python 层的动态联动与集成方式

Camoufox 对用户暴露的 Python 包不只是一个启动器，它内部包装了 `Playwright` 的核心逻辑：
- 调用 `launchServer` 借用 Playwright 的未公开 API 偷偷拉起 C++ 服务。
- 与著名的伪装库 **BrowserForge** 动态联动，当开发者启动 Camoufox 时，系统会自动从池子中抽离一台真实 Windows/Mac 的极其详尽的硬件画像（包含 User-Agent, 分辨率, WebGL 驱动版号），将其灌入环境变量，最后启动那个被魔改过的 Firefox 二进制文件。

### 3.1 持久化 Profile 集成方式
通过 `AsyncNewBrowser` / `NewBrowser` 的 `persistent_context=True` 参数启用持久化上下文：
```python
browser_context = await AsyncNewBrowser(
    p, persistent_context=True, user_data_dir="./my_profile_dir"
)
```

## 4. 重大架构约束：Profile 持久化存在已知缺陷

> ⚠️ **这是影响 WebEnvoy 架构选型的关键限制，必须重点关注。**

通过深度调研源码得到以下关键发现：

- **`user_data_dir` 状态无法在重启后自动恢复**：Camoufox 源码中的测试用例 `test_should_restore_state_from_userDataDir` 被明确标记为 `skip`，注释写明 **"Not supported by Camoufox"**。
- **实际含义**：即使在 `user_data_dir` 里保存了之前的登录 Cookie，浏览器重新启动后**不会自动加载恢复这些状态**，仍然需要重新登录。
- **Docker/CI 下的影响**：在无人值守的云端自动化场景中，每次容器重启后都需要重新完成登录流程，无法实现账号热保活。

| 特性 | Camoufox | Pinchtab |
|---|---|---|
| 高防指纹伪装强度 | ⭐⭐⭐⭐⭐（C++ 内核级） | ⭐⭐⭐（JS 注入级） |
| Profile 持久化（重启复活） | ❌ 不支持 | ✅ 完整支持 |
| 账号保活能力 | ❌ 每次重启需重新登录 | ✅ Named Profile 冷热复活 |

**结论**：Camoufox 适合当"一次性超级隐身容器"，处理单次高难度任务；**不适合**作为需要长期持有多个账号登录态的"账号资产托管平台"。

## 5. 总结与借鉴价值
Camoufox 证明了 **"要想彻底伪装，必须下探到 C++ 源码层"** 的终极法则。
作为一个旨在辅助 AI Agent 的工具箱 (WebEnvoy)，我们未必有精力常态化去维护一个被 C++ 补丁重重包裹的 Firefox 发行版，但如果目标站点是那种防御等级拉满的航司抢票或电商抢购页面，直接将 Camoufox 的 Python 库替换掉标准的 Playwright `chromium.launch()` 驱动器，是大幅提升 WebEnvoy 生存率的"捷径"。

**账号保活需配合 Pinchtab**，高强度反爬需配合 Camoufox，两者不可互相替代。
