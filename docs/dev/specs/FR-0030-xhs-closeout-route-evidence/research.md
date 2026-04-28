# FR-0030 研究记录

## OpenCLI 参考结论

已核对 `jackwener/OpenCLI` 的 XHS adapter 文件：

- `clis/xiaohongshu/search.js`
- `clis/xiaohongshu/feed.js`
- `clis/xiaohongshu/note.js`
- `clis/xiaohongshu/comments.js`
- `clis/xiaohongshu/download.js`
- `clis/xiaohongshu/note-helpers.js`
- `clis/xiaohongshu/user-helpers.js`

可吸收的工程模式：

- 用 `MutationObserver` 或条件等待区分内容出现与登录墙，不依赖固定盲等。
- 搜索卡片提取保留 detail/user link 与 `xsec_token` / `xsec_source`。
- detail/comment/user_home 优先使用自然导航、渲染状态与 signed URL，不把裸 id 静默升级为 fetch。
- 页面状态提取按 hydration state、script JSON、DOM selector 分层。
- 安全页、登录墙、验证码、账号异常、浏览器环境异常必须独立分类。

## 仓库现状

当前仓库已有以下能力落点：

- `extension/main-world-bridge.ts`：patch `fetch` / `XMLHttpRequest` 并维护 captured request context。
- `extension/xhs-search-types.ts`：定义 XHS command shape、captured artifact 与 lookup result。
- `extension/xhs-search-execution.ts`：当前 search request-context lookup 与 replay 路径。
- `extension/xhs-read-execution.ts`：detail/user_home request-context 与页面状态 fallback。
- `extension/content-script-main-world.ts`：读取 `window.__INITIAL_STATE__` 或等价页面状态。

缺口：

- 尚未有正式枚举区分 passive capture、DOM/state extraction 与 active fetch fallback。
- search route 尚未把 DOM/state extraction 作为 active fetch 之前的正式 fallback。
- detail/user_home signed continuity 仍需 #583 冻结。
- active fallback gate 仍需 #582 独立实现。

## Go / No-Go

Go：先建立 FR-0030 作为 `#579` route evidence contract owner。

No-Go：

- 不把 FR-0030 写入 FR-0005。
- 不在 #581 中实现 active fetch。
- 不用 #445 bundle 或 Browser Computer Use 生成证据。
