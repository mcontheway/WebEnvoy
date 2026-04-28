# FR-0030 风险记录

## 风险 1：DOM/state evidence 被误用为 #445 full closeout 成功

- 触发条件：后续 PR 把 search cards DOM extraction 当作 `#445` 关闭依据。
- 缓解：本 FR 明确 DOM/state 只能作为 route-specific passive probe fallback，不替代 #445 full closeout success bar。
- 回滚：撤回误用 PR，并恢复 #579/#563 truth-sync。

## 风险 2：active fetch 重新成为默认路径

- 触发条件：passive capture 缺失时实现直接进入 request-context replay 或主动 fetch。
- 缓解：本 FR 将 `active_api_fetch_fallback` 单独分类，并要求 #582 独立 gate。
- 回滚：阻断对应实现 PR，恢复 fail-closed 行为。

## 风险 3：账号风险被混成 evidence missing

- 触发条件：登录墙、安全页、验证码、账号异常或浏览器环境异常被归类为 request-context miss。
- 缓解：本 FR 冻结 failure separation；任一账号风险信号出现必须 hard stop。
- 回滚：修复分类并更新对应 issue truth。

## 风险 4：token continuity 被误写成 canonical identity

- 触发条件：把 `xsec_token` 写入 FR-0026 canonical note identity。
- 缓解：本 FR 明确 token 属于 route continuity / provenance。
- 回滚：拆出 identity 变更，转入 #583 continuity 口径。
