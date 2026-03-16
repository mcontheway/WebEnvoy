# leaperone/MultiPost-Extension 深度调研报告

## 1. 宏观信息
- **仓库地址**: [leaperone/MultiPost-Extension](https://github.com/leaperone/MultiPost-Extension)
- **Stars**: ~2.1k
- **定位**: 浏览器扩展程序，主打“基于当前浏览器账号登录态”的跨社交平台一键分发（多推）。
- **核心技术栈**: TypeScript, React, Plasmo 浏览器扩展框架 (`chrome.scripting`, `chrome.tabs`)。

## 2. 核心架构与底层机制 (Extension-based RPA)
与完全无头的 Playwright 爬虫不同，MultiPost 走的是典型的 **Extension RPA** 路线。它最大的优势是**直接复用用户浏览器中真实的 Cookies 和 LocalStorage**，零风控、免除验证码登录。

### 2.1 集中式的消息路由网关
整个系统由强力的 Message 通信模型驱动：
- **`src/background/index.ts` (中央枢纽)**: 负责监听所有的分发指令（如 `MULTIPOST_EXTENSION_PUBLISH`）。当接收到多个平台的齐发指令时，它负责统筹开启新 Tab 页面组，并管理其生命周期。
- **`src/contents/extension.ts` (安全拦截器)**: 这是一个被注满 `<all_urls>` 的 Content Script。它的核心作用是一个代理网关，校验 `event.origin` 以阻止未知来源网站瞎调用扩展 API，保护用户账号安全。

### 2.2 降维打击的分分发流水线 (Tab Group Injection)
如何将一篇文章自动塞入知乎、推特和小红书？
1. **统一建群 (`createTabsForPlatforms`)**: Background 进程读取需要发布的平台列表，并发使用 `chrome.tabs.create` 帮用户在后台打开这 10 个平台的草稿页 URL，并优雅地放入同一个 Chrome Tab Group 进行对齐。
2. **闭包投射 (`injectScriptsToTabs`)**: 这是核心魔法。等这 10 个草稿页处于 `Complete` 状态后，Background 进程使用 `chrome.scripting.executeScript`，将每一个平台专属的 DOM 操作闭包 (`injectFunction`) 携带好包含了正文和图片的 `SyncData` 强行打入各自的 Tab V8 上下文直接执行。

### 2.3 突破前端框架的反常识文件上传 (Media Upload)
在现代 React/Vue 编写的社交网站中，用 JS 代码触发文件选择器难如登天。MultiPost 采用了一套标准的黑客手法欺骗框架层：
1. 寻找页面上的专属的 `<input type="file">` 节点。
2. 背景异步下载远程图片，在内存中恢复为真实的 `File` 或 `Blob` 对象。
3. 实例化底层的 **`DataTransfer`** 数据对象，将 `File` 对象塞进它的 `items` 里。
4. 将 `<input type="file">.files` 属性强行赋值为 `DataTransfer.files`。
5. **最重要的一步**：手动高频向上抛出 `new Event('change', { bubbles: true })` 和 `input` 事件，使得前段框架的 onChange 回调被成功骗过，开始执行物理上传进度条。

### 2.4 `DataTransfer` 魔法的局限性与风险
通过深度调研发现，该方案在以下场景存在失效风险：
- **`isTrusted` 严格校验**：浏览器中由用户行为触发的事件 `isTrusted` 为 `true`。通过脚本分发的事件该属性通常为 `false`。若目标站点（如高防支付或社交平台）对此进行严格检查，模拟动作可能被拦截。
- **文件系统句柄请求**：若站点改用现代 `File System Access API` 直接与 OS 交互而非传统的 `<input type="file">`，则该模拟方案将失效。
- **自定义非标上传**：部分平台（如 Bilibili）可能通过 `window.postMessage` 特有的内部协议进行文件分发，而非标准 DOM 操作。

### 2.5 顺序发布队列与隐式速率限制
MultiPost 采用“顺序创建标签页”的调度模式：
- **无并发发布**：`Tab Manager` 接收指令后，为每个平台依次开启新标签页并执行平台特定的 `injectFunction()`，前一个平台完成后才启动下一个，天然形成单线程队列。
- **隐式频率控制**：发布逻辑内部大量使用 `setTimeout` 延迟（如 X/Twitter 上传后等待 3s，Instagram 等待 10s）。这种基于业务流程的软延迟起到了隐式的速率限制作用，降低了被风控识别为机器流量的概率。

## 3. 总结与借鉴价值
MultiPost 是标准的 “DOM-Recorder (录制回放型脚本)”的延伸版：
1. **`DataTransfer` 的文件上传魔法**：这一条经验直接解决了 RPA 控制浏览器填图填视频的一大痼疾。如果 WebEnvoy Agent 需要自动发推或上传素材，这个方案比让 Agent 去点真实的本地文件对话框要稳妥和优雅 100 倍。
2. **隔离的 `injectFunction` 脚本工程设计**：它为每一个目标平台独立编写了一个针对 DOM Selectors 硬编码的填表脚本。这种重前端硬编码的维护成本很高，未来的 WebEnvoy 应该用 LLM 自适应填表取代这种硬编码闭包注入。
