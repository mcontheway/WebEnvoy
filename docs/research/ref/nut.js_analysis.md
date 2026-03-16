# nut-tree/nut.js 深度调研报告

## 1. 宏观信息
- **仓库地址**: [nut-tree/nut.js](https://github.com/nut-tree/nut.js)
- **Stars**: ~2.7k
- **定位**: 跨平台的系统级桌面 UI 自动化框架（Node.js 端最好的 OpenCV 键鼠集成库）。
- **核心技术栈**: TypeScript, C++ (Node N-API), 平台 SDK (Win32/Cocoa/X11)。

## 2. 核心架构与底层机制 (Native & Provider Pattern)
Nut.js 完全脱离了浏览器的控制协议（如 CDP/WebDriver），它是作为一只“上帝之手”直接控制宿主机的操作系统的：

### 2.1 OS 原生驱动层 (`libnut`)
- 系统采用了基于 **Provider Pattern（提供者模式）** 的强解耦架构。核心库 `@nut-tree/nut-js` 只定义了 `MouseProviderInterface` 和 `KeyboardProviderInterface` 等抽象接口。
- 全部的物理控制逻辑交由 C++ 编写的 N-API 原生模块 `@nut-tree/libnut` 承担。在运行时，它会通过探测 `process.platform` 动态加载预编译好的二级制依赖（`libnut-win32`, `libnut-darwin`, `libnut-linux`）。
- **绝对可信事件**: 所有的底层键盘和鼠标位移、点击不仅发生在屏幕绝对坐标系上，更是直接注入到操作系统的全局中断队列。所有 Web 网站或甚至游戏客户端的 JavaScript 反射探针抓取到的事件必然是 **`isTrusted: true`**，实现了最物理级别的反爬突破。

### 2.2 视觉捕获与寻路层 (Vision Plugins)
由于缺乏对 DOM 结构的感知（这才是物理模拟的代价），它必须依靠计算机视觉来寻路：
- **`ScreenAction.grabScreen()`**: 底层调用 C++ SDK API 瞬时捕获屏幕缓冲区切片为原生的 Bitmap 对象。
- **视觉匹配插件**: 它将高级的寻找逻辑剥离为了 `ImageFinderInterface` 和 `TextFinderInterface`。开发者可以挂载官方的 `@nut-tree/template-matcher` 插件进行基于 **OpenCV** 底层的极速特征模板匹配找图，或挂载 `@nut-tree/plugin-ocr` 进行基于 Tesseract 的屏幕像素级文字提取（找字）。

## 3. 总结与借鉴价值
对于 WebEnvoy 而言，nut.js 代表了 Agent 的“最终防线方案”：
1. **应对极端的反反爬虫 (Anti-Anti-Bot)**: 在某些极端严苛的 Web 端点（例如极验四代、Cloudflare 最新版的人机拖拽滑块，它们会严格验证轨迹连贯性或 CDP 指令钩子），如果 DOM 操作纷纷失效，最好的退路就是将浏览器最大化放到前台，然后调用 `nut.js` 控制真实的系统鼠标进行模板匹配并滑动。
2. **多模态 VLM Agent 的完美载体**: 虽然传统的网页爬取效率低下，但如果 WebEnvoy 打算接入类似 GPT-4o 这类自带视觉识别坐标系 (View Grounding) 的大模型，大模型可以通过看图直接吐出需要点击的电脑屏幕绝对 X,Y 坐标，此时利用 `nut.js` 进行最简单的“指哪打哪”物理交互，甚至可以突破浏览器的限制操作一切桌面软件。
