# AutomaApp/automa 深度调研报告

## 1. 宏观信息
- **仓库地址**: [AutomaApp/automa](https://github.com/AutomaApp/automa)
- **Stars**: ~21k
- **定位**: 一款开源的浏览器自动化扩展程序，通过拖拽“图块 (Blocks)”来直观地构建自动化工作流。
- **核心技术栈**: Vue 3, Chrome Extension API (MV3), JavaScript。

## 2. 核心架构设计 (Workflow Engine)
Automa 的核心是一个运行在浏览器扩展内的非线性执行引擎，它将复杂的自动化任务拆解为两大核心组件：

### 2.1 WorkflowManager 与 WorkflowEngine
- **WorkflowManager**: 作为单例 (Singleton) 管理整个扩展中所有正在运行的工作流。
- **WorkflowEngine**: 每次执行一个工作流时，都会实例化一个引擎对象。它负责从 `triggerBlock` 节点开始，加载凭证和变量 (`referenceData`)，并初始化多个 `WorkflowWorker` 来推进图块的执行。
- **WorkflowWorker**: 作为执行实体，承载实际图块逻辑的触发。它会在内部维持工作流的执行快照和运行日志，遇到异步操作时具有挂起和恢复 (\`stopped\`, \`resumed\`) 的状态流转。

### 2.2 图块系统 (Block System)
Automa 将每一个动作抽象为 Block 对象。源码中，每个 Block 都会绑定一个 `handler` 函数（如 `handlerJavascriptCode`, `handlerHandleDialog`, `handlerCreateElement` 等）。
- 执行时，`WorkflowWorker` 提取特定 Block 的 `handler` 并将上下文（如通过 `addDataToColumn` 提取数据）注入执行域中。
- `handler` 执行完毕后，固定返回 `data` 和 `nextBlockId`，引擎据此将控制流传递给下一个 Block（可带条件分发机制如 `handlerConditions`）。

### 2.3 扩展基础设施 (双环境执行)
自动化操作往往需要跨环境权限：
- **Content Scripts (Website Context)**: 用于操作 DOM，如点击、获取文本。
- **Background Service Worker (Background Context)**: 获取全部 Chrome APIs 权限栈，如多 Tab 控制、代理设置。
- 最核心的沟通桥梁为 Block `javascriptCode`，底层通过 `jsContentHandlerEval` 在对应的沙箱内注入并执行用户填写的 JS，同时暴露内置生命周期函数（如 `automaNextBlock`, `automaRefData`, `automaFetch`）实现与主工作引擎的数据同步。

## 3. 录制功能代码实现 (Recording Workflows)
相比让用户手动拖拽，Automa 的智能录制功能是其杀手锏，代码级实现路径如下（位于 `src/content/services/recordWorkflow/recordEvents.js`）：
- **全量事件监听**: 在 Content Script 中全局挂载 `onClick`, `onChange`, `onKeydown`, `onScroll`, `onInputTextField`（防抖处理）。
- **即时图块转译**: 单个动作发生后立即被实时构造成 `event-click`, `forms` (记录输入值), `press-key`, `element-scroll` 等底层数据块。
- **跨域 iframe 穿透**: 如果录制事件发生在 iframe 中，Content Script 使用 `window.top.postMessage` 向上冒泡通知 Main Frame，将带有唯一 `frameSelector` 标记的动作汇总并打包。
- **状态流转**: 录制过程中将生成的暂存流数据 (`flows`) 存入 `browser.storage.local`，直到录制停止后转化为完整的 `drawflow` 数据结构落地为新脚本。

## 4. 总结与借鉴价值
Automa 是“扩展类 + 低代码/NoCode 可视化”的终极形态代表。
它的亮点并没有落在什么复杂的防反爬或躲避 Webdriver 检测机制上（这也是它面临严苛反爬验证码时乏力的原因），而是体现在 **极其优雅的图块式引擎 `WorkflowEngine` 设计和 DOM 事件级别的拦截录制 `recordEvents.js` 上**。
如果要让 WebEnvoy 具备可视化编辑、二次调试长流程脚本、或“开箱即用”零代码录制 RPA 的能力，Automa 将功能按 `Block handler` 原子化拆分的模式是非常完美的参考模板。
