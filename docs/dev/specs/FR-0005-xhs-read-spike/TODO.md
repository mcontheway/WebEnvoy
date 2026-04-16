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
- [x] 2026-04-06 中午已按 WebEnvoy-managed profile 口径复查本地执行现场；当时 `.webenvoy/profiles` 不存在可用于 XHS live 复核的已登录 profile
- [x] 由于 2026-04-06 中午缺少 WebEnvoy-managed XHS 会话，本轮曾按 `No-Go/paused` 收口，不绕过 `#362/#363/#365` 继续 live 扩展
- [x] 2026-04-06 晚间起，不再把作者本机 `.webenvoy/profiles/**` 的恢复状态直接写成正式结论；正式状态只跟随 FR-0005 已收口的 managed-profile 同口径复核结论变化
- [x] 2026-04-10/2026-04-11 已确认此前 `IDENTITY_MANIFEST_MISSING` 属于 worktree/main 路径污染后的中间现场，不再作为最终停点
- [x] 2026-04-11 的 managed-profile official runtime 复核历史事实已在 `research.md` 收口；其中已记录 profile root / identity preflight 不再构成当时的直接阻断
- [x] 仓库内已固化的历史 fresh rerun 样本头 `eca28babebe929821aa20fbb113b2f94d6ce4f49` 已确认：`#445-A` 修复后的 `xhs.search` 不再出现 `executeXhsSearchImpl is not defined`
- [x] 同一轮 fresh rerun 已确认 `xhs_001` 仍满足 managed-profile / official runtime / `real_browser` 启动前提，且 `runtime.start`、`runtime.ping`、internal `runtime.tabs` 均可达
- [x] 仓库内已固化样本中的 `search` 已获得合法 fresh rerun 样本，但只达到 `dry_run` 成功壳；请求 `live_read_high_risk` 时会被 `risk_state=paused` + `ISSUE_ACTION_MATRIX_BLOCKED` 阻断，未形成 API primary success
- [x] current latest head `c9ba10a9772006119bfd29f6c15f93d04eebc22a` 已确认：`xhs.detail` / `xhs.user_home` 公开 CLI 命令面存在，且 dry_run fresh rerun 可成功
- [x] current latest-head gate refresh 已收口到 FR-0016 新治理口径：PR `live_evidence_record` 维护 latest-head 证据，repo formal docs 只保留 fixed/historical sample；formal 结论继续保持 `No-Go/paused`
- [x] 当前 formal FR 的文档收口已完成；正式功能停点继续保持为：`search/detail/user_home` 仍缺 `route_role=primary + path_kind=api + evidence_status=success + reproduced_multi_round`；其中 `search` 还需补齐 required headers 最小必要集矩阵，正式结论继续 `No-Go/paused`

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

- [x] 2026-04-06 中午已形成本轮 Go/No-Go 历史结论：`No-Go/paused`
- [x] 上述 `No-Go/paused` 继续保留为带日期的历史 closeout；当前 formal FR 何时解除停点，取决于 WebEnvoy-managed profile 下剩余同口径复核是否补齐
- [x] 2026-04-10 晚间已按最新 managed-profile / official runtime 现场重做 Go/No-Go 判定，结论继续维持 `No-Go/paused`
- [x] 2026-04-11 已在 main 目录完成恢复后再复核，并把 “worktree 路径污染不是最终结论” 写回正式记录
- [x] 2026-04-11 已在 latest head 重新确认：此前的 XHS read bundle 阻断已被 `#445-A` 解除，但 FR-0005 的正式停点尚未解除
- [x] 2026-04-16 已在 latest head `c9ba10a9772006119bfd29f6c15f93d04eebc22a` 完成 fresh rerun：
  - `xhs.search dry_run` 成功
  - `xhs.search live` 命中 `GATEWAY_INVOKER_FAILED`
  - `xhs.detail dry_run` 成功，`xhs.detail live` 命中 `ERR_PROFILE_LOCKED`
  - `xhs.user_home dry_run` 成功，`xhs.user_home live` 命中 `ERR_PROFILE_LOCKED`
- [x] 上述 2026-04-16 latest-head fresh rerun 只更新当前 blocker 证据，不改写 FR-0005 formal closeout bar；正式解除停点仍以 `primary + api + success + reproduced_multi_round` 与 required headers 最小必要集矩阵收口为准
- [ ] 在风险状态满足准入、且具备合法 approval / gate 前提后，重新执行 `search` 的 managed-profile `real_browser` live primary API 复核，并补齐 required headers 最小必要集矩阵
- [ ] 收口 latest-head `xhs.search live` 的 `GATEWAY_INVOKER_FAILED`，再重新执行 fresh live rerun
- [ ] 收口 latest-head `xhs.detail live` / `xhs.user_home live` 的 runtime transport disconnect / `ERR_PROFILE_LOCKED`，再重新执行 fresh live rerun
- [ ] 在满足上述前提后，再次判定 `search/detail/user_home` 是否达到 `route_role=primary + path_kind=api + evidence_status=success + reproduced_multi_round`
- [ ] 完成浏览器内复核后，再决定是否进入后续实现 FR
- [ ] 若存在 fallback-only 场景：先补 API primary 成功证据，或提交“实现范围修订”并通过独立 spec review
- [ ] 创建“小红书 L3 读适配实现 FR”并引用 FR-0005 已复核结论
- [ ] 为端点构造、签名调用、响应解析建立 TDD 测试矩阵
- [ ] 把强依赖字段写入适配规则并补回归验证
- [ ] 将失败场景（会话过期、风控拦截、空结果）纳入实现验收
