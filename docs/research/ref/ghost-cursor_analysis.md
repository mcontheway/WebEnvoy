# Xetera/ghost-cursor 深度调研报告

## 1. 宏观信息
- **仓库地址**: [Xetera/ghost-cursor](https://github.com/Xetera/ghost-cursor)
- **Stars**: ~1.4k
- **定位**: 专为自动化工具（如 Puppeteer, Playwright）设计的底层鼠标轨迹拟真数学引擎。
- **核心技术栈**: TypeScript (Math/CDP Protocol)。

## 2. 核心架构与底层机制 (Math & Physics)
`ghost-cursor` 的价值并非在于它包装了什么复杂的选择器，而在于它通过原生数学公式解决了一个核心问题：**机器生成的坐标为什么一眼假？**

### 2.1 路径生成管线 (Path Generation)
每次调用 `cursor.move()` 或 `cursor.click()`，底层会先后经历严密的坐标解算：
- **目标空间域捕获 (`getElement`)**: 先算对目标元素 `BoundingBox` 的拾取，避免永远只点元素正中心（而是随机挑选区域落点）。
- **三次贝塞尔曲线插值 (`bezierCurve`)**: 在起点和终点之间，`generateBezierAnchors` 算法会在两点连线的**单侧**随机生成两个控制锚点（由此产生一个名为 `spread` 的外扩张力参数），从而画出一段平滑但带有重力下坠趋势的弧线。

### 2.2 仿生学补偿算法
光有贝塞尔曲线依然像机器手，它叠加了两大仿生学补丁：
- **菲茨定律控速 (Fitts's Law)**: 依靠代码中的 `fitts` 函数 `Time = a + b * log2(Distance/Width + 1)`，它根据鼠标当前位置到目标距离的远近，动态增减贝塞尔曲线采样的步数 (`steps`)。实现“远距离甩鼠标快，接近细小按钮时减速对准”的极度拟真感。
- **过冲与重定位 (Overshooting)**: 如果滑动距离超过 `overshootThreshold`，引擎会刻意计算一个偏离目标靶心且稍远的“过冲点”，然后紧接着生成一段反向的急促微调修正路径。这完美重现了人类肌肉控制甩动鼠标的“收不住再拉回来”的惯性行为。

## 3. CDP 协议级集成 (Interface Integration)
与普通的 `page.mouse.move()` 不同，`ghost-cursor` 不单纯依赖 Puppeteer 的高级 API：
- **直通底层**: 在解算出带有时间戳的一系列 `Vector` 坐标系后。它的 `tracePath` 方法会直接跳过外层封装，调用底层的源生 CDP (Chrome DevTools Protocol) 客户端，密集狂轰 `Input.dispatchMouseEvent` 指令（附带 `type: 'mouseMoved'`）。
- **无感事件流**: 对于点击和滚动，同样是直接对 CDP 下达 `mousePressed`, `mouseReleased` 和 `mouseWheel`。这使得轨迹点密度极高，且在网页底层看起来与真实 USB 硬件中断上报的事件流毫无二致。

## 4. 总结与借鉴价值
`ghost-cursor` 是 WebEnvoy 交互层 (Action Engine) 不可或缺的防风控拼图。
当我们的 Agent 通过视觉或 DOM 树决定了要点击某个元素时，**绝对不能仅仅派发一个瞬间转移的 click 事件**（这很容易被诸如 Datadome 或 Akamai 拦截）。
我们必须在 Agent 的底层调用链中完整复制其 `贝塞尔 + Fitts + 过冲` 的数学解算模型，并以匀杂的时间戳（`useTimestamps`）通过 CDP `Input.dispatchMouseEvent` 滑动过去，这是自动化操作能够穿透当前互联网高强度人机验证（Cloudflare Turnstile 等）的生存及格线。

### 关键约束与适配注意事项

**1. 不支持移动端触控事件（TouchEvent）**：
- `ghost-cursor` 仅模拟鼠标事件，不支持 `touchstart/touchmove/touchend`。
- 如果 WebEnvoy 需要模拟移动端用户行为，需要另行寻找 TouchEvent 拟人化方案，不能直接依赖本库。

**2. 没有原生 Playwright 接口**：
- 库的 `createCursor()` 函数的 `page` 参数类型为 Puppeteer 的 `Page` 对象。
- 在 Playwright 场景下的适配方案：需要手动提取 Playwright 的 CDP Session（通过 `page.context().newCDPSession(page)`），将其包装成兼容 Puppeteer Page 接口的对象，或直接调用底层 CDP 发送 `Input.dispatchMouseEvent`。

**3. 支持拟人化滚动（scroll）**：
- 提供 `scroll(delta, options)`、`scrollTo(destination)`、`scrollIntoView(selector)` 三个方法。
- 底层通过密集发送 `Input.dispatchMouseEvent` 的 `mouseWheel` 类型，并支持 `scrollSpeed`（1-100）和 `scrollDelay` 参数控制节奏。
- 这意味着 WebEnvoy 的下拉加载、无限滚动（如抖音/小红书信息流）场景可以直接使用此拟人化滚动特性。

