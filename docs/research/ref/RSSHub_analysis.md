# 调研报告：DIYgod/RSSHub 架构与实现机制深度拆解

> 版本：v1.0
> 状态：完工（已集成 DeepWiki 深度分析）
> 目标：深度解析 `RSSHub` 的架构设计、核心路由解析机制以及反爬虫与缓存处理。

---

## 一、 项目定位与核心理念

`RSSHub` 是一个开源、简单易用、易于扩展的 RSS 生成器，其核心理念是 **"Everything is RSSible"**。它通过将各类非标准化的网页、App 数据转化为结构化的 RSS 订阅源，解决了互联网信息碎片化和封闭的问题。

---

## 二、 技术架构体系

RSSHub 的架构设计分为构建时（Build-time）和运行时（Runtime）两个阶段，确保了在大流量下的性能与数千条路由的可维护性。

### 2.1 链路组成
`HTTP Client <-> Hono Web Framework <-> Route Registry <-> Route Handlers <-> Content Source (HTTP/Scraping)`

### 2.2 组件协同机制
1.  **Hono 框架**：作为高性能的 Web 框架，负责请求路由和中间件处理。
2.  **构建系统 (`scripts/workflow/build-routes.ts`)**：构建时扫描 `lib/routes/` 目录，通过约定式结构自动发现路由，并生成 `routes.json`、`radar-rules.json` 等元数据。
3.  **路由注册表 (`lib/registry.ts`)**：运行时动态加载元数据，并根据环境（开发或生产）执行路由注册。在生产环境下，路由处理函数通过懒加载（Lazy Loading）策略引入，以优化内存占用。

---

## 三、 核心路由解析机制

RSSHub 采用了基于文件目录结构的“约定优于配置”模式。

### 3.1 目录结构约定
每个命名空间（如 `bilibili`）在 `lib/routes/` 下拥有独立子目录：
*   `namespace.ts`：定义命名空间的元数据（分类、描述、URL）。
*   `route.ts`：具体的路由定义。
*   `handler`：路由的核心逻辑，负责数据抓取与转换。

### 3.2 路由处理器实现
每个路由导出符合 `Route` 类型的对象：
*   **输入**：`Context` 对象（包含路径参数、查询参数）。
*   **输出**：`Promise<Data>`，包含 RSS Feed 所需的 `title`、`link`、`item`（每一项包含 `title`、`description`、`pubDate` 等）。
*   **解析技术**：通常结合 `got` 进行 HTTP 请求，配合 `cheerio` 进行 HTML DOM 解析，将非结构化数据萃取为 JSON 并由 Hono 转化为 XML。

---

## 四、 反爬虫与缓存处理机制

### 4.1 反爬虫策略 (Anti-Crawler)
*   **标记机制**：路由定义中包含 `antiCrawler: true` 标记，用于告知系统该源存在严格限制。
*   **环境依赖**：针对部分限制特定地理位置的源（如 B 站国外 IP 限制），在文档中明确建议部署环境或通过代理解决。

### 4.2 缓存系统 (Caching)
*   **缓存工具类 (`cache.ts`)**：提供统一的 `cache.tryGet` 方法。
*   **逻辑流**：在 `handler` 内，首先查询缓存。若命中，则直接返回；若未命中，则执行爬取逻辑并将结果回写缓存。
*   **优势**：大幅降低了对目标站点的请求压力，有效缓解了因频繁触发频率限制导致的 WAF 拦截。

---

## 五、 技术总结

RSSHub 的成功建立在其**极度解耦的插件化路由系统**之上。它不仅是一个爬虫工具，更是一套**全网 API 逆向与数据抓取规则的集体智慧结晶**。其核心价值在于数千个由社区维护的、位于 `lib/routes/` 下的解析脚本，这些脚本为应对复杂多变的 Web 环境提供了最直接的技术字典。
