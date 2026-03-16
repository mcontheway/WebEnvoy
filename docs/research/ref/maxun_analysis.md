# getmaxun/maxun 深度调研报告

## 1. 宏观信息
- **仓库地址**: [getmaxun/maxun](https://github.com/getmaxun/maxun)
- **Stars**: ~15.2k
- **定位**: 开源的 No-Code (无代码) 及基于大模型的 Web 数据采集与 RPA 平台，旨在取代被商业垄断的传统爬虫构建工具（如八爪鱼）。
- **核心技术栈**: TypeScript, React, Playwright, Socket.IO, rrweb (DOM 录制)。

## 2. 核心架构与底层机制 (The RPA Engine)
Maxun 架构上严格遵循前端 Dashboard 与后端执行池分离的微服务设计思想：

### 2.1 浏览器管控池调度 (BrowserPool & rrweb)
- 在服务端维护了一个全局单例的 `BrowserPool`，用来集中管控远端的 Playwright 实例（`RemoteBrowser` 对象）。
- 为了规避高并发时的分配冲突，引入了一套带有原子抢占机制的状态机（`reserveBrowserSlotAtomic` -> `initializing` -> `upgradeBrowserSlot` -> `ready`）。并且极其严格地为用户划分了**录制模式**与**执行模式**：
  - **录制模式 (`isRecordingMode = true`)**: 服务端 Playwright 会实时将当前页面的 DOM 变化通过 `rrweb` 技术压榨后流式推送到前端画布，配合 `Socket.IO`，让用户仿佛在本地全尺寸操控那个远端页面。
  - **执行模式**: `rrweb` 组件会被强制卸载以节省内存和降低响应迟滞。

### 2.2 工作流引擎抽象与 LLM 生成 (Workflow Generation)
Maxun 自研了名为 `maxun-core` 的解释器。其数据结构被定义为基于 JSON 的 `WorkflowFile`，其中的每一步被高度抽象为 **`WhereWhatPair`**：
- **`Where`**: 条件探测器（在哪，URL 是否匹配，某 CSS Node 是否可见）。
- **`What`**: 执行动作器（点击、输入、滚动、抓取文本）。
  
由于数据结构被标准化到了极致，它的工作流构建不仅支持网页端的手工框选（通过 Socket 将 `dom:click` 等事件发还给服务端的 `WorkflowGenerator` 追加记录），更完美打通了 **LLM (AI 大模型)** 的直接干预：
- 当用户输入自然语言目标时，后台利用 `WorkflowEnricher` 拉起无头浏览器生成当前页面的截图与局部 HTML 对象树（Element Groups）。交由 LLM 进行决策推理后，通过 `buildWorkflowFromLLMDecision` 函数直接**逆向合成**标准的 `WhereWhatPair` 执行 JSON，实现了“一句话写爬虫”的概念。

### 2.3 敏感信息脱敏与加密
- **录制期脱敏**：`rrweb` 在初始化时设置 `maskAllInputs: false`，意味着默认不自动脱敏所有输入。
- **存储期加密**：但在 `WorkflowEnricher` 处理 `type` 动作时，系统会对输入值执行 `encrypt(value)` 后再存入工作流步骤。这种在持久化层面的加密确保了工作流脚本本身的安全性，防止敏感信息（如密码/手机号）以明文形式存储。

### 2.4 智能无限滚动停止判定
`Interpreter` 在处理 `scrollDown` 分页任务时采用了一套启发式策略：
- **检测逻辑**：通过 `SelectorValidator` 的 `testInfiniteScrollByScrolling` 实际测试页面高度和项目数量的增量。
- **停止判定**：
  - **内容未增加**：若连续滚动后抓取项数量或页面高度不再变化，则判定加载结束。
  - **迭代上限**：硬编码了 3 次滚动迭代。
  - **数量限制**：达到用户指定的 `limit`（或由 LLM 生成的限制值，默认 100）时立即停止。
- **对 AI 的意义**：这平衡了长列表抓取的完整性与执行成本，避免 Agent 陷入无限下拉的死循环。

## 3. 对 AI Agent 的友好性
- 它的 `Interpreter` (`maxun-core/src/interpret.ts`) 将执行逻辑与生成逻辑彻底剥离，非常适合需要**固化经验**的 AI Agent。
- 即：Agent 在第一遍探索目标站点时生成/构建一份结构化的 RPA JSON 文件。以后同样的任务，直接跑 `Interpreter` 执行这个文件即可，无需每次都消耗巨额 Token 让大模型重新思考去哪点什么。

## 4. 总结与借鉴价值
Maxun 是新一代带有 LLM 辅助的浏览器 RPA 的开源基建标杆：
1. **录播分离的工程范式**：通过 `rrweb` 串流 DOM 到前台，服务端利用 `Socket.IO` 接受映射点击事件，是 WebEnvoy 未来如果要做云端录制面板的绝佳参考。
2. **极简的指令集抽象 (`WhereWhatPair`)**：告诉了我们不要试图让大模型直接输出具体的 JS 代码去爬取数据，而是让大模型去生成这种极其简单、确定性极强且有条件阻断重试的 JSON DSL 源文件，然后丢给坚固的本地执行器去死磕容错，是提升 Agent 鲁棒性的关键。
