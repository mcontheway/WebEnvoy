# FR-0030 实施计划

## 实施目标

冻结 XHS closeout route evidence taxonomy，让 `#580/#583/#582/#579/#563` 在同一套 evidence class 与 provenance 口径下实现，避免 `primary API evidence` 再次漂移为默认 active fetch。

## 分阶段拆分

### 阶段 1：route evidence taxonomy

- 产出：`spec.md`、`contracts/xhs-closeout-route-evidence.md`
- 重点：冻结 `humanized_action / passive_api_capture / dom_state_extraction / active_api_fetch_fallback` 四类 evidence。

### 阶段 2：DOM/state provenance

- 产出：`data-model.md`
- 重点：冻结 `dom_state_extraction` 的 extraction layer、locator、run/action/page/profile/tab 绑定与 target continuity 字段。

### 阶段 3：后续实现准入

- 产出：`TODO.md`、`risks.md`
- 重点：明确 #580 先实现 search passive route，#583 冻结 signed continuity，#582 最后 gate active fallback，#579 merged-main verify 后 #563 才恢复 passive probe。

## 实现约束

- 不修改 `FR-0005` 文档。
- 不运行 `#445` bundle、live admission probe 或 active fetch probe。
- 不新增 public CLI command。
- 不新增 SQLite 表、迁移或第二套 runtime status object family。
- 不把具体 profile 名写成 formal contract 常量。
- 不把 DOM/state evidence 写成 `#445` full closeout 通过条件。

## 测试与验证策略

- 文档门禁：
  - `bash scripts/docs-guard.sh`
  - `bash scripts/spec-guard.sh`
  - `git diff --check`
- 规约对照：
  - 对照 `FR-0024/FR-0027/FR-0028/FR-0029`，确认本 FR 只新增 route/evidence taxonomy，不扩写 request shape、request-context reuse、note-id identity 或 recovery admission predicate。
  - 对照 `extension/xhs-search-types.ts`、`extension/main-world-bridge.ts`、`extension/xhs-search-execution.ts`，确认后续实现已有落点。

## TDD 范围

- 本 PR 为 formal suite，不改运行时代码。
- #580 后续实现必须补：
  - passive capture exact hit 输出 `passive_api_capture`
  - DOM cards extraction 输出 `dom_state_extraction`
  - `xsec_token` / `xsec_source` 保留
  - login/security/captcha/account-risk/browser-env-abnormal 独立分类
  - 无 passive/DOM evidence 时 fail closed
- #582 后续实现必须补：
  - active fallback gate 未显式放行时阻断
  - stale/cross-tab/cross-profile/synthetic-only template 阻断
  - fresh current-page template 放行后 evidence class 为 `active_api_fetch_fallback`

## 并行 / 串行关系

- 串行：
  - #581 必须先于 #580 合入，避免实现输出 shape 漂移。
  - #582 必须晚于 #580/#583，避免 active fallback 在默认 route 未冻结前提前放行。
- 可并行：
  - #583 的 signed continuity 规约可在 #580 实现后立即推进，不依赖 #582。

## 进入实现前条件

- #581 spec review 通过并合入 main。
- reviewer 确认本 FR 未修改 FR-0005，未改变 #445 close condition。
- reviewer 确认 `active_api_fetch_fallback` 被明确标记为最后 fallback，且未在 #581 中放行。
