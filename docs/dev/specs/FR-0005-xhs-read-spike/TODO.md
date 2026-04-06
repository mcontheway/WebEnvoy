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
- [x] 2026-04-06 已按 WebEnvoy-managed profile 口径复查本地执行现场；当前 `.webenvoy/profiles` 不存在可用于 XHS live 复核的已登录 profile
- [x] 由于缺少 WebEnvoy-managed XHS 会话，本轮按 `No-Go/paused` 收口，不绕过 `#362/#363/#365` 继续 live 扩展
- [ ] 恢复可用账号/会话后再继续同口径复核

## #185 阻断点吸收（本次规约修订）

- [x] 在 `spec.md` 明确 Spike 输出允许 `API primary + page-state fallback` 作为侦察证据并存
- [x] 在 `spec.md` / `plan.md` 明确 fallback 证据不等于实现准入，不得直接放行实现
- [x] 在 `spec.md` / `plan.md` 冻结 page-state fallback 最小内容（路径模板与方法、关键 URL 参数、最小状态探针、成功/失败信号）
- [x] 在 `spec.md` / `plan.md` 明确 page-state fallback 不得扩张为实现承诺（稳定选择器、完整字段覆盖、默认路由）
- [x] 全部新增口径对齐 `research.md` 现有证据，不引入仓库外不可复核引用

## 待继续的浏览器内复核

- [ ] 用户主页聚合端点是否存在稳定的作品列表 API（例如 `user_posted` 或等价端点）
- [ ] `a1 / webId / gid` 的精确生命周期
- [ ] `x-s-common` 的稳定性是 `session_scoped` 还是 `page_refresh_scoped`
- [ ] `window._webmsxyw` 的页面/版本分流条件与降级策略
- [ ] 为 `search/detail/user_home` 各端点补齐“最小必要 required_headers”实验矩阵
- [ ] 未登录 / 会话过期 / 风控拦截在 WebEnvoy 诊断壳中的最终映射

## 后续衔接

- [x] 2026-04-06 已形成本轮 Go/No-Go 结论：`No-Go/paused`
- [x] 本轮不创建“小红书 L3 读适配实现 FR”；等待 WebEnvoy-managed XHS 会话恢复并补齐 `search/detail/user_home` 的 API primary 复核后再重新评估
- [ ] 完成浏览器内复核后，再决定是否进入后续实现 FR
- [ ] 若存在 fallback-only 场景：先补 API primary 成功证据，或提交“实现范围修订”并通过独立 spec review
- [ ] 创建“小红书 L3 读适配实现 FR”并引用 FR-0005 已复核结论
- [ ] 为端点构造、签名调用、响应解析建立 TDD 测试矩阵
- [ ] 把强依赖字段写入适配规则并补回归验证
- [ ] 将失败场景（会话过期、风控拦截、空结果）纳入实现验收
