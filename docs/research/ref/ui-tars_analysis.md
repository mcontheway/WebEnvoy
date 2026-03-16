# bytedance/UI-TARS-desktop 深度调研报告

## 1. 宏观信息
- **仓库地址**: [bytedance/UI-TARS-desktop](https://github.com/bytedance/UI-TARS-desktop)
- **Stars**: ~28.8k
- **定位**: 字节跳动开源的端到端原生 GUI 多模态大模型框架。基于 “纯视觉，无 DOM” 的理念，可以直接控制任何桌面软件。
- **核心技术栈**: TypeScript, Electron, `Tarko` 框架，Visual-Language Model (VLM), `nut.js`。

## 2. 核心架构与底层机制 (OmniTARS & Visual Grounding)
如果说 `nanobrowser` 或 `page-agent` 是基于 DOM 树结构优化的极点，那么 `UI-TARS` 则是彻底抛弃 DOM 树的全新维度大杀器。它的底层逻辑是：**大模型像人一样看屏幕，然后大模型告诉你用鼠标点哪里**。

### 2.1 基于插件的 Tarko 框架
它的运行时名叫 `OmniTARS`，是一个由多个插件 (`mcpPlugin`, `guiPlugin`, `codePlugin`) 拼装出来的超级 Agent 调度器。在执行浏览器操作时，它支持三种模式：
1. **`dom` 模式**: 也就是传统的抽取 DOM 树找节点。
2. **`visual-grounding` 模式**: UI-TARS 的绝对核心。它不摸 DOM，只靠截图。
3. **`hybrid` 模式**: 利用提示词工程让大脑决定是看图还是读代码。

### 2.2 视觉定位 SDK (`GUIAgent` & `Operator`)
在 `visual-grounding` 循环中，SDK 以极度精简的三步死循环 `while(true)` 进行运作：
- **第一步：看图 (`operator.screenshot()`)**: 获取当前屏幕的 1080P 或 4K 无损截图流（Base64 格式），同时带上物理屏幕的尺寸分辨率参数。
- **第二步：脑补 (`model.invoke()`)**: 将图片传入多模态视觉大模型（如特化的 Doubao-1.5-UI-TARS，或是通用视觉旗舰 GPT-4o / Claude-3.5-Sonnet）。模型不需要找 HTML 标签，直接回答逻辑层面的动作序列，如：`click(point='<point>383 502</point>')` 即“点击画面中横向 383，纵向 502 位置的像素块”。
- **第三步：扣扳机 (`operator.execute()`)**: 这里的执行器不再是浏览器的 `node.click()`，而是真正操作系统的物理指针鼠标。
    - 在它的源码中，最典型的 `Operator` 实现是 `NutJSElectronOperator`。它借由前面调研过的 `nut.js`，将系统层面的物理键鼠指针瞬间强行移动到 `(383, 502)` 并按下左键。

### 2.2 视觉历史帧与动态稳定性
- **5 帧滑动窗口**：`GUIAgent` 每次推理时并非仅传当前图，而是将**最近 5 张截图** (`screenshots.slice(-5)`) 同时提供给大模型。这使得模型能通过“短时视觉记忆”识别出 Loading 状态或由于鼠标悬停刚弹出的浮层，从而解决单帧图片的瞬态误判问题。
- **隐式重试**：执行循环中若 VLM 发现 UI 尚未就绪，会自动在下一轮循环中获取新图重试。

### 2.3 Hybrid 模式下的坐标反向映射
- **坐标与 BBox 匹配**：当模型在 `hybrid` 模式下工作时，它会将视觉定位的 `Point` 坐标点与 DOM 元素的 `getBoundingClientRect()` 范围进行碰撞检测。
- **降级路径**：系统优先尝试更轻量的 `dom` 操作命令及其 IndexId。若执行失败，立即回退到 `visual-grounding` 视觉真物理点击进行强行兜底，实现了极高的容错率。

## 3. 总结与借鉴价值
UI-TARS 描绘了下一代 WebEnvoy 终极兜底策略的宏伟蓝图：**“不破防的降维打击”**。
1. **万物皆可点 (Visual Grounding)**: 只要有像素，它就能点。它彻底无视了前端用了什么框架 (React/Vue/Wasm)、加了多少层 ShadowDOM、用了多少个嵌套 Iframe。甚至即使那个网页是一个整块基于 WebGL 渲染的 3D 游戏画卷，或是被 VNC 转接过来的远程桌面，或者是 Cloudflare 的滑块，只要大模型“看”出来了，底层的 `nut.js` 就能直接在电脑屏幕上把鼠标挪过去物理点击。
2. **WebEnvoy 的融合之路**: WebEnvoy 并不能全用抛弃 DOM 的纯视觉方案（因为纯发图给 GPT-4o 的 Token 成本和延迟极其恐怖，且容易点偏）。最佳设计必然是：**以 `page-agent` 风格的提取版 DOM Tree 压缩方案为主力，打不通的骨头（如巨型 Canvas 验证码或复杂非标组件）局部调用 UI-TARS 风格的截图并配合 `nut.js` 鼠标控制进行强拆。这是当前业界的最优解。**
