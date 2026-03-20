# FR-0005 TODO

## 已完成前置

- [x] FR-0005 规约 Draft PR 已创建并合入主干
- [x] spec review 已完成，FR-0005 已进入 Spike 复核阶段
- [x] `contracts/`、`risks.md`、`data-model.md` 已补齐

## 浏览器内复核进度（本轮）

- [x] 把参考实现与仓库内调研收敛为正式 `research.md`
- [x] 在 `research.md` 新增“浏览器内第一手复核证据”层，并与仓库内历史证据分离
- [x] 写入浏览器内前提：Claw profile 隔离 clone + Chrome remote debugging `9222` 手动启动
- [x] 写入 `_webmsxyw` 页面/加载时机分流证据：`/explore`、detail 页可用；`search_result` 某变体与 profile 页早期样本出现过不可用
- [x] 写入 `/explore` 的 Cookie 直接可读证据（`a1/webId/gid/xsecappid`）
- [x] 写入单次搜索交互成功 XHR 样本与观测到的头族
- [x] 写入 detail / profile 页 `__INITIAL_STATE__` 页面级读证据
- [x] 按 `search/detail/user_home` 分开记录：成功证据、失败/候选证据、`required_headers` 已观测与候选
- [x] 写入手动 fetch 失败样本：`500(create invoker failed)`、`300015(Browser environment abnormal)`、`461 + 300011(Account abnormal)`
- [x] 更新错误分类并补充 `browser_env_abnormal`、`account_abnormal`、`gateway_invoker_failed`
- [x] 本地运行并记录 `docs-guard` / `spec-guard`

## 当前阻断与暂停状态

- [x] 触发账号异常（`code=300011`）后已暂停 live XHS 交互，避免继续放大风控
- [x] 明确标记本轮为“部分完成”，非实现就绪
- [ ] 恢复可用账号/会话后再继续同口径复核

## 待继续的浏览器内复核

- [ ] 用户主页聚合端点是否存在稳定的作品列表 API（例如 `user_posted` 或等价端点）
- [ ] `a1 / webId / gid` 的精确生命周期
- [ ] `x-s-common` 的稳定性是 `session_scoped` 还是 `page_refresh_scoped`
- [ ] `window._webmsxyw` 的页面/版本分流条件与降级策略
- [ ] 为 `search/detail/user_home` 各端点补齐“最小必要 required_headers”实验矩阵
- [ ] 未登录 / 会话过期 / 风控拦截在 WebEnvoy 诊断壳中的最终映射

## 后续衔接

- [ ] 完成浏览器内复核后，再决定是否进入后续实现 FR
- [ ] 创建“小红书 L3 读适配实现 FR”并引用 FR-0005 已复核结论
- [ ] 为端点构造、签名调用、响应解析建立 TDD 测试矩阵
- [ ] 把强依赖字段写入适配规则并补回归验证
- [ ] 将失败场景（会话过期、风控拦截、空结果）纳入实现验收
