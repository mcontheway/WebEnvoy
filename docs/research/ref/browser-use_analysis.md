# browser-use/browser-use 深度调研报告

## 1. 宏观信息
- **仓库地址**: [browser-use/browser-use](https://github.com/browser-use/browser-use)
- **Stars**: ~80k
- **定位**: 明星级开源项目，让网站对 AI Agents 可访问，主打通过顶级 DOM 净化算法将杂乱的网页转译为大语言模型可精确点击的索状结构。
- **核心技术栈**: Python, Playwright/CDP (Chrome DevTools Protocol), Pydantic, LangChain。

## 2. 核心架构与机制 (Event-Driven & Watchdog)
项目从最初的线性执行脚本演进为高度强健的 **事件驱动 (Event-Driven) 架构**，以应对真实网页的不可预测性（如突然弹窗、崩溃、验证码）。

### 2.1 基于 `bubus` 的 EventBus 总线
- `BrowserSession` 作为生命周期主体，内部实例化了一个 `EventBus`，彻底解耦了浏览器控制与状态异常响应。
- **Watchdog 模式**: 系统包含多只"看门狗"（继承自 `BaseWatchdog`，如 `CrashWatchdog`, `CaptchaWatchdog`, `DownloadsWatchdog`）。它们通过 `attach_to_session()` 反射自动注册带有 `on_` 前缀的事件处理器（比如 `on_BrowserStartEvent`）。如果检测到崩溃，看门狗会直接向总线 `dispatch()` 错误事件以中断 Agent，甚至能接管执行流去打码（Captcha Solver）。

### 2.2 CDP Session Pool 动态路由
- **焦点恢复与长保活**: `SessionManager` 不再使用慢速拉询（Polling），而是底层监听原生 CDP 的 `Target.attachedToTarget` 和 `Target.detachedFromTarget` 异步更新 Target 池。
- 当当前 Tab 发生崩溃或被反爬关闭时，内置的三段式异常恢复 `_recover_agent_focus()` 会被唤醒，自动寻找备用标签页重置焦点。

## 3. DOM 感知引擎极光管线 (DOM Processing Engine)
如果要说 browser-use 为什么强，其核心就在于名为 `DomService` 和 `DOMTreeSerializer` 组合成的**最强五段式 DOM 解析管线**：

### 3.1 跨维 5 数据源融合 (Data Fusion)
`DomService._get_all_trees` 并发地通过底层 CDP 从浏览器一次性榨干 5 个维度的数据：
1. **真实 DOM Tree** (`DOM.getDocument`)
2. **纯语义无障碍树 Accessibility Tree** (`Accessibility.getFullAXTree`)
3. **渲染快照 DOM Snapshot** (`DOMSnapshot.captureSnapshot` 用于提取计算样式 CSS 和 Paint Order 绘制层级)
4. **视口矩阵 Viewport metrics**
5. **JS 级硬绑定事件 Listener** (如注入脚本抓取真正绑了 `click`/`mousedown` 的对象，防止漏掉非标准组件)

这 5 组数据随后混合被捏合成一棵极为详尽的 `EnhancedDOMTreeNode` 异构树结构。

### 3.2 序列化净化五步曲 (Five-Stage Pipeline)
由于 5 合 1 获取的树对 LLM Token 来说依然巨大，系统进入 `DOMTreeSerializer`：
1. **Simplified Tree (简明裁切)**：强力裁剪无用 `<div>`，仅保留可见可视区 (`is_visible`)、含阴影主机、带文本的节点或强制白名单（输入框）。
2. **Paint Order Filtering (抗遮挡剔除，极其核心)**：依靠 `PaintOrderRemover.calculate_paint_order()`，通过 z-index 原理和绘制顺序剔除画面中**被弹窗或蒙版完全盖住的"幽灵元素"**，防止 LLM 去点不可见区域。
3. **Tree Optimization (去皮去壳)**：清理残余的仅作排版的空占位容器。
4. **Bounding Box Filtering (包围盒融合)**：如果一个 `<span>` 子节点它的可视区域被父节点 `<button>` 完全包围 `excluded_by_parent`，则父节点吸收掉它，防止给一个按钮标出无数个子序号。
5. **Indexing (分配可击索引)**：这是最后一步输出结果。遍历上报为 Interactive (比如 `is_interactive` 校验器为 True) 且实际可见的表单元素，基于全局索引计数派发短 ID，输出带 `selector_map` 字典映射。

## 4. 总结与借鉴价值
`browser-use` 拥有目前市面上开源界最高阶、最精妙的**从杂乱 DOM 向 LLM 友好型 String 降阶归一**的感知引擎。
如果 WebEnvoy 也希望使用 LLM 做视觉点击、页面总结或交互，**绝不应该重新造轮子，而应该想办法直接拆解 `browser-use` 其感知侧的 `DOMTreeSerializer` 数据提取管线使用**。
其针对"可见遮挡判断(Paint Order)"以及针对"注入 `getEventListeners` 抓隐式事件"这两个 Trick 极具启示意义。

### 关键约束：CaptchaWatchdog 仅在 Cloud 商业服务下生效
- 触发机制**依赖两个专有 CDP 事件**：`BrowserUse.captchaSolverStarted` / `captchaSolverFinished`，这是 `Browser Use Cloud` 商业服务专属的。
- **本地部署的 Playwright 不会发出这些事件**，因此 `CaptchaWatchdog` 在 WebEnvoy 自托管场景下**不会生效**，需自行实现验证码检测逻辑。

### 多 Tab 操作模型
- Agent **任何时刻只聚焦一个 Tab**，切换 Tab 时触发 `AgentFocusChangedEvent`，自动清除所有 DOM 缓存（`_cached_browser_state_summary` 和 `_cached_selector_map`）。
- **对 WebEnvoy 的启发**：Fallback Adapter 在跨 Tab 任务中，每次切换后必须强制刷新感知快照，绝不能复用旧 Tab 的 RefCache 或 AX Tree 缓存。
