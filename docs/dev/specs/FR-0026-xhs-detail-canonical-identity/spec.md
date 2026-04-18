# FR-0026 冻结 XHS Detail Canonical Identity（当前不纳入 image_scenes）

Canonical Issue: #505

## 背景

`#503 / FR-0024` 已把 `xhs.search` request-shape truth 冻结为 search-only formal contract，并显式把 `xhs.detail` canonical identity（尤其是 `image_scenes` 是否进入 shape）转交 `#505`。`#504` 则继续冻结 detail/user_home command surface 与 request-context baseline，但不处理 detail identity。

当前 GitHub 与仓库证据已经稳定收敛出一个最小结论：

- current main 上，`xhs.detail` 的 command input、runtime、bridge、contract test 和 fallback test 都稳定围绕 `note_id` 运转。
- 仓库内没有足够的 runtime/test/formal contract 证据证明 `image_scenes` 或 `CRD_PRV_WEBP` 是 admission-ready 的 canonical identity 字段。
- `#503` guardian 的多轮阻断已经反复指出：在证据不足前把 `image_scenes` 冻结进 detail identity，会把未验证字段写成正式真相。

因此，本 FR 的职责不是继续寻找额外字段，而是先把 current v1 可被仓库内证据支撑的最小 identity 冻结为 formal contract：`xhs.detail` canonical identity 当前只包含 `note_id`，`image_scenes` 不进入 `shape` / `shape_key` / lookup / eligibility`。

## 目标

1. 冻结 current v1 `xhs.detail` canonical identity 只包含 `note_id`。
2. 冻结 `image_scenes` 与 `CRD_PRV_WEBP` 当前不进入 canonical shape。
3. 冻结这些字段在 current v1 中只允许作为 non-identity diagnostics / compatibility context。
4. 冻结后续实现 PR 在 `#505` 之外不得擅自把 `image_scenes` 写入 detail identity。
5. 明确未来如果出现 admission-ready 仓库证据，必须通过新的 spec 修订再讨论 identity 扩张。

## 非目标

- 不在本 FR 内修改 runtime、extension、CLI 或测试实现代码。
- 不在本 FR 内修复 `#500` 或 `#489`。
- 不在本 FR 内重写 `FR-0024` search-only request-shape truth。
- 不在本 FR 内新增 detail 命令参数、public CLI/API surface 或 request-context 采集逻辑。
- 不在本 FR 内冻结 detail/user_home command surface、target-page baseline、四对象输入 ownership 或 request-context behavior。
- 不在本 FR 内承诺 `image_scenes` 永远不可能进入 identity；这里只冻结 current v1 结论。
- 不在本 FR 内推进 `#445` closeout、latest-main rerun 或 live evidence。

## 功能需求

### 1. current v1 canonical identity

系统必须冻结以下 current v1 `xhs.detail` canonical identity：

```ts
type XhsDetailCanonicalIdentityV1 = {
  command: "xhs.detail";
  note_id: string;
};
```

约束：

- `note_id` 是 current v1 唯一 canonical identity 字段。
- `note_id` 必须是 trim 后非空字符串。
- 当前 v1 的 detail lookup、eligibility、shape 与 `shape_key` 都只能围绕 `note_id` 建立。

### 2. current v1 non-identity fields

系统必须冻结以下 current v1 结论：

- `image_scenes` 不进入 canonical identity
- `CRD_PRV_WEBP` 不进入 canonical identity

这些字段在 current v1 中只允许作为：

- diagnostics context
- compatibility observation
- future evidence candidate

不得作为：

- `shape`
- `shape_key`
- lookup key
- eligibility gate
- exact-match identity 组成部分

### 3. identity derivation baseline

系统必须冻结：只要当前请求或模板能够稳定提供 `note_id`，就可以构成 current v1 detail identity；不得要求在 identity derivation 阶段额外等待 `image_scenes` 或 `CRD_PRV_WEBP`。

约束：

- 缺少 `image_scenes` 不能单独导致 current v1 detail identity 不可导出。
- current v1 detail identity 的导出前提只绑定 `note_id`，不绑定 `image_scenes` 或 `CRD_PRV_WEBP`。
- 如果当前实现需要保留 `image_scenes` 供诊断输出使用，必须与 identity derivation 解耦。

### 4. lookup / eligibility 行为

系统必须冻结以下 current v1 lookup / eligibility 规则：

- 两条 detail request/template 只要 `note_id` 相同，就属于同一个 current v1 canonical identity。
- 仅因 `image_scenes` 或 `CRD_PRV_WEBP` 不同，不得判定为 identity mismatch。
- `image_scenes` 缺失、为空、未观测到或值不同，不得单独触发 `shape_mismatch`、`rejected_source` 或 stale 行为。

补充约束：

- 这只是 current v1 formal 结论，不代表未来一定不扩 identity。
- 若未来 evidence 证明 `note_id` 不足，必须通过新的 spec 修订来改变上述规则。

### 5. 不属于本 FR 的边界

以下内容不在本 FR 内冻结，继续由 `#504` 承接：

- public command surface
- canonical command input
- target-page baseline
- 四对象输入 ownership
- request-context behavior

本 FR 只回答 detail identity 问题，不把这些行为写成 de facto request-context spec。

### 6. 未来扩 identity 的准入条件

若未来要把 `image_scenes`、`CRD_PRV_WEBP` 或其他候选字段纳入 detail identity，必须同时满足：

1. 仓库内出现可复核的 runtime/test/formal contract 证据
2. 该证据能稳定证明 `note_id` 单独使用会造成 false-hit、false-miss 或错误复用
3. 通过新的独立 spec 修订 PR

在这些条件满足前：

- 后续实现 PR 不得自行把 `image_scenes` 写入 identity
- guardian finding 不能被“以后可能需要”替代当前 formal 结论

## GWT 验收场景

### 场景 1：note_id 单独构成 current v1 detail identity

Given 调用方发起 `xhs.detail`
And 当前请求包含合法 `note_id`
When 系统导出 current v1 detail identity
Then identity 必须可以仅基于 `note_id` 建立
And 不得要求 `image_scenes`

### 场景 2：image_scenes 缺失不会阻断 current v1 identity

Given 当前 detail 请求未携带 `image_scenes`
When 系统导出 current v1 detail identity
Then identity 仍必须可导出
And 不得因缺失 `image_scenes` 把请求判为 identity 不完整

### 场景 3：同 note_id 不因 image_scenes 不同而变成不同 identity

Given 两条 detail request 或 template 的 `note_id` 相同
And 它们的 `image_scenes` 不同、缺失或一方不存在
When 系统比较 current v1 canonical identity
Then 结果必须仍视为同一个 identity
And 不得仅因 `image_scenes` 差异触发 mismatch

### 场景 4：image_scenes 只能作为 non-identity context

Given detail runtime 或 test 现场观测到了 `image_scenes` 或 `CRD_PRV_WEBP`
When 系统记录当前 v1 contract
Then 这些字段只能进入 diagnostics / compatibility context
And 不得进入 `shape`、`shape_key`、lookup key 或 eligibility gate

### 场景 5：未来扩 identity 必须重新过 spec review

Given 后续实现或 guardian 提出把 `image_scenes` 纳入 detail identity
When 当前仓库仍缺少 admission-ready runtime/test/formal evidence
Then 该提议不得直接进入 current implementation
And 必须等待新的 spec 修订

## 异常与边界场景

- `note_id` 缺失时，当前 detail identity 不可导出；这是 command input 问题，不是 `image_scenes` 问题。
- `image_scenes` 缺失、为空或值不稳定时，当前 formal 结论仍必须保持 `note_id`-only identity。
- 若未来仓库证据证明 `note_id` 单独使用会产生错误复用，本 FR 不阻止未来修订，但在修订完成前 current implementation 仍必须遵守 current v1 结论。
- `image_scenes` 不入 identity 不等于禁止记录该字段；只是不允许它驱动 current v1 exact-match 规则。

## 验收标准

1. current v1 `xhs.detail` canonical identity 已冻结为 `note_id` only。
2. `image_scenes` 与 `CRD_PRV_WEBP` 已冻结为 non-identity context。
3. `lookup`、`eligibility`、`shape` 与 `shape_key` 当前都不得依赖这些字段。
4. 后续实现 PR 不得以“当前 formal 未明确禁止”为由擅自把这些字段写入 identity。
5. future identity expansion 的准入条件已明确为“仓库内 admission-ready evidence + 新 spec 修订”。

## 依赖与前置条件

- `vision.md`
- `docs/dev/roadmap.md`
- `docs/dev/architecture/system-design.md`
- `docs/dev/architecture/system-design/read-write.md`
- `docs/dev/specs/FR-0024-xhs-request-shape-truth/spec.md`
- `docs/dev/specs/FR-0024-xhs-request-shape-truth/research.md`
- GitHub issue `#504`（detail/user_home command surface 与 request-context baseline formal freeze）
- `src/commands/xhs-input.ts`
- `src/commands/xhs-runtime.ts`
- `tests/content-script-handler.xhs-read.contract.test.ts`
- `tests/extension.service-worker.gate-approval.suite.ts`
- `tests/xhs-read-execution.fallback.test.ts`
- GitHub issue `#505`
