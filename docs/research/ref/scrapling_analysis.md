# 调研报告：D4Vinci/Scrapling 深度拆解

## 1. 项目概况
*   **仓库地址**：[D4Vinci/Scrapling](https://github.com/D4Vinci/Scrapling)
*   **核心定位**：具备"自适应解析"和"高级抗风控"能力的 Python 爬虫框架。
*   **核心技术栈**：Python, Playwright, `curl-cffi` (基于 HTTP/3), SQLite。

---

## 2. 核心架构与机制
*   **分层抓取引擎**：
    *   **Fetcher**：基于 `curl_cffi`，支持 HTTP/3 和 TLS 指纹伪造，适用于静态页面。
    *   **DynamicFetcher**：基于 Playwright 的无头浏览器引擎。
    *   **StealthyFetcher**：在核心引擎上集成了大量反检测补丁。

---

## 3. 自适应选择器（Adaptive Selectors）深度拆解

### 3.1 指纹 Schema 结构
当通过 `auto_save=True` 保存一个元素时，Scrapling 会将该元素的多维特征经由 `_StorageTools.element_to_dict()` 方法序列化为字典存入 SQLite。具体保存的字段包括：

| 字段 | 含义 |
|---|---|
| `tag` | 元素的 HTML 标签名（如 `div`, `a`） |
| `text` | 元素的文本内容 |
| `attributes` | 元素的完整属性键值对（如 `class`, `id`, `href`） |
| `path` | 元素在 DOM 树中由标签名组成的完整路径 |
| `siblings` | 同级兄弟元素的标签名列表 |
| `parent_tag` | 直接父元素的标签名 |
| `parent_attributes` | 直接父元素的属性键值对 |
| `parent_text` | 直接父元素的文本内容 |

### 3.2 模糊匹配的特征维度（`__calculate_similarity_score`）
当原始选择器失效时，`difflib.SequenceMatcher` 的 `ratio()` 方法会对候选页面中的所有元素逐一计算多维得分，并取**加权平均值**：
1. **标签名**：严格匹配，不同标签直接得 0 分。
2. **文本内容**：使用 `SequenceMatcher.ratio()` 计算字符串相似度。
3. **属性相似度**：`__calculate_dict_diff` 分别计算属性键名列表和属性值的相似度后取均值；同时对 `class`, `id`, `href`, `src` 等关键属性单独加权比较，赋予更高权重。
4. **DOM 路径**：比较从根节点到当前节点的标签路径序列相似度。
5. **父元素信息**：父元素的标签名、属性、文本三个子维度均参与得分计算。
6. **兄弟节点列表**：比较兄弟元素的标签序列相似度。

---

## 4. StealthyFetcher 完整反检测补丁清单
位于 `scrapling/engines/_browsers/_stealth.py`，通过 `StealthySession` 类统一管理：

| 补丁 | 修复的泄漏点 | 启用参数 |
|---|---|---|
| Cloudflare Turnstile 自动绕过 | CF JS 挑战/交互验证/背景验证 | `solve_cloudflare=True` |
| CDP 运行时泄漏修补 | CDP 接口被网站检测到自动化环境 | 内置，自动开启 |
| WebRTC 泄漏阻断 | WebRTC 绕代理泄露真实 IP | `block_webrtc=True` |
| Playwright 指纹隔离 | Playwright 特征被原型链枚举捕获 | 内置，自动开启 |
| Canvas 噪声注入 | Canvas 像素渲染指纹唯一识别 | `hide_canvas=True` |
| 无头模式自动修补 | 常见 Headless 检测特征 | 内置，自动开启 |
| 时区覆盖 | `Intl.DateTimeFormat` 时区不一致 | `timezone_id` 参数 |
| Google 来源伪造 | Referer 为空或可疑，被判断为非人类流量 | `google_search=True`（默认） |

---

## 5. 对 AI Agent 的友好性
*   **稳定性保障**：自适应选择器极大降低了由于 UI 改版导致的 Agent 逻辑中断概率。
*   **统一响应接口**：所有抓取引擎返回统一的 `Response` 对象，支持链式解析，方便 AI 进行数据提取。

---

## 6. 技术短板与风险
*   **Bypass 局限**：虽然能绕过 Cloudflare Turnstile，但对于极其复杂的图形验证码或基于强行为生物识别的系统，仍需配合第三方打码或拟人化轨迹。
*   **资源消耗**：`StealthyFetcher` 开启后，由于集成了大量反检测注入，内存和 CPU 消耗显著高于普通抓取。

---

## 7. 调研结论与 WebEnvoy 借鉴点
1. **自适应选择器的 8 维指纹 Schema** 可以直接复用到 WebEnvoy L2 半定制脚本的自愈机制设计中。
2. **StealthyFetcher 完整补丁清单（8 个方向）** 是构建 Fallback 容器"隐匿层"的完整工程实施指南，每一项均需在底层浏览器容器中逐一覆盖。
3. **TLS 指纹伪造（`curl-cffi`）** 是 L3 专用引擎发包层的网络库选型参考：发包层必须具备 JA3/HTTP2 指纹定制能力，绝不能使用标准 `requests` 或 `axios` 裸发。
