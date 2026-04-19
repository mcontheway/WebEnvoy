# FR-0026 冻结 XHS Detail Canonical Identity（当前不纳入 image_scenes）

Canonical Issue: #505

## 背景

`#503 / FR-0024` 已把 `xhs.search` request-shape truth 冻结为 search-only formal contract，并显式把 `xhs.detail` canonical identity（尤其是 `image_scenes` 是否进入 canonical identity）转交 `#505`。`#504` 则继续冻结 detail/user_home command surface 与 request-context baseline，但不处理 detail identity。

当前 GitHub 与仓库证据已经稳定收敛出一个最小结论：

- current main 上，`xhs.detail` 的 command input、runtime、bridge、contract test 和 fallback test 都稳定围绕 `note_id` 运转。
- current main 与既有研究证据已出现 detail request-side `source_note_id` 字段，但这些证据仍停留在 synthetic / candidate / failed 层级，尚不足以把它冻结成 admitted canonical mapping、verified transport truth、独立 identity 字段、跨路由 alias 或更广 request-shape 语义。
- 仓库内没有足够的 runtime/test/formal contract 证据证明 `image_scenes` 是 admission-ready 的 canonical identity 字段。
- `#503` guardian 的多轮阻断已经反复指出：在证据不足前把 `image_scenes` 冻结进 detail identity，会把未验证字段写成正式真相。

因此，本 FR 的职责不是继续寻找额外字段，也不是替 `#504` 定义完整 detail request shape，而是先把 current v1 可被仓库内证据支撑的最小 identity anchor 冻结为 formal contract：`xhs.detail` 当前只有 `note_id` 被 formal 认可为 canonical identity anchor；`image_scenes` 不进入该 identity anchor；当前已观测到的 `source_note_id` 继续只保留为 request-side 观测 / candidate 事实，不在本 FR 内被 formalize 为 admitted canonical mapping、第二个 identity 字段或更广 transport truth。

## 目标

1. 冻结 current v1 `xhs.detail` canonical identity 只包含 `note_id`。
2. 冻结 `image_scenes` 当前不进入 canonical identity anchor。
3. 明确当前已观测到的 `source_note_id` 不进入 frozen identity baseline，也不在本 FR 内被 formalize 为 admitted canonical mapping、transport alias 或更广 request-shape truth。
4. 冻结后续实现 PR 在 `#505` 之外不得擅自把 `image_scenes` 写入 detail identity，或把 `source_note_id` 扩写成第二个 identity 字段、admitted canonical mapping 或未审查的跨路由 alias 规则。
5. 明确未来如果出现 admission-ready 仓库证据，必须通过新的 spec 修订再讨论 identity 扩张或 request/artifact alias / canonical mapping 语义。

## 非目标

- 不在本 FR 内修改 runtime、extension、CLI 或测试实现代码。
- 不在本 FR 内修复 `#500` 或 `#489`。
- 不在本 FR 内重写 `FR-0024` search-only request-shape truth。
- 不在本 FR 内新增 detail 命令参数、public CLI/API surface 或 request-context 采集逻辑。
- 不在本 FR 内冻结 detail/user_home command surface、target-page baseline、四对象输入 ownership 或 request-context behavior。
- 不在本 FR 内冻结 shape、shape_key、eligibility 或其他必须通过后续 formal spec review 才能回答的 request-context 语义。
- 不在本 FR 内 formalize `source_note_id` 的 admitted canonical mapping、transport alias、跨路由 derivation、route admission、compatibility 或其他 request/artifact mapping 语义。
- 不在本 FR 内承诺 `image_scenes` 永远不可能进入 identity；这里只冻结 current v1 结论。
- 不在本 FR 内推进 `#445` closeout、latest-main rerun 或 live evidence。

## 功能需求

### 1. current v1 canonical identity anchor

系统必须冻结以下 current v1 `xhs.detail` canonical identity anchor：

```ts
type XhsDetailCanonicalIdentityAnchorV1 = {
  note_id: string;
};
```

约束：

- `note_id` 是 current v1 唯一被本 FR 正式冻结的 canonical identity anchor 字段。
- `note_id` 必须是 trim 后非空字符串。
- 本 FR 不定义 identity 之外的 detail matching 语义。

### 2. current v1 non-identity boundary

系统必须冻结以下 current v1 结论：

- `image_scenes` 不进入 canonical identity

- current v1 formal 只回答“它不进入 canonical identity”
- 当前仓库未验证稳定的 diagnostics / compatibility field shape；本 FR 不冻结其 placement 或输出位置
- `image_scenes` 不得作为 canonical identity anchor 的组成部分或额外 identity discriminator
- 本 FR 不定义 detail compatibility、rejected-source matching、template reuse 或其他 request-context 语义；这些行为不属于已 merge 的 `#504` formal freeze，也不得由单独实现 PR 自行决定；若未来需要冻结，必须先通过 `#508` 对应的 formal spec review 在消费 `#504 + #505` 的前提下收口
- 对 successor detail implementation path 而言，`#508` 之外还必须额外等待 `#510` 这条 required detail-path gate；`#510` 的 mandatory 范围不扩写成所有 shared reuse 语义的统一前置，本 FR 也不在此重述其 owning suite scope

### 3. observed request/artifact non-freeze boundary

系统必须冻结：只要 command-side input 能够稳定提供 `note_id`，就可以构成 current v1 detail identity anchor；不得要求在 identity 建立阶段额外等待 `image_scenes`；当前已观测到的 `source_note_id` 及其 request/artifact relation 继续停留在 observed / candidate 层，不进入本 FR 的 admitted canonical mapping formal freeze。

约束：

- 缺少 `image_scenes` 不能单独导致 current v1 detail identity anchor 不可导出。
- current v1 detail identity anchor 的导出前提只绑定 `note_id`，不绑定 `image_scenes`。
- 如果当前实现需要保留 `image_scenes` 供诊断输出使用，必须与 identity derivation 解耦。
- 当 command-side input 已提供 `note_id` 时，canonical identity 直接使用 trim 后的 `note_id`。
- `source_note_id` 本身不是 current v1 frozen identity baseline 字段，也不得在输出 shape 中替代 canonical `note_id`。
- 现有 synthetic / candidate / failed 证据不足以把 `source_note_id` 冻结成 admitted canonical mapping、独立 identity 字段、跨路由 transport alias、route admission 规则或更广 request/artifact normalization 规则。
- 其他 request/artifact 字段及其 mapping relation 也不在本 FR scope。

### 4. identity exclusion 行为

系统必须冻结以下 current v1 exclusion 规则：

- 仅因 `image_scenes` 不同，不得把它提升为额外 identity discriminator。
- `image_scenes` 缺失、为空、未观测到或值不同，不得单独被 formal 认定为 canonical identity 变化。

补充约束：

- 这只是 current v1 formal 结论，不代表未来一定不扩 identity。
- 若未来 evidence 证明 `note_id` 不足，必须通过新的 spec 修订来改变上述规则。

### 5. 不属于本 FR 的边界

以下内容已由 `#504` / FR-0025 冻结，本 FR 不重复定义：

- public command surface
- canonical command input
- target-page baseline
- 四对象输入 ownership
- request-context baseline

以下内容既不属于已 merge 的 `#504` formal freeze，也不在本 FR 内冻结，必须先通过 `#508` 对应的 formal spec review 在消费 `#504 + #505` 的前提下继续回答：

- detail request-shape truth
- shape_key / lookup slotting / route eligibility
- compatibility、rejected-source matching、template reuse 等 reuse 语义

在 `#508` formal freeze 合并前，任何实现 PR 都不得擅自定义或冻结上述语义。
对 successor detail implementation path 而言，除 `#508` 外还必须继续等待 `#510` 这条 required detail-path gate；该 gate 只约束 detail path，不替代 `#508` 对 shared request-context 语义的 ownership，本 FR 不在此重述其 owning suite scope。

本 FR 只回答 detail identity 问题；它不能被解读为完整 request-shape / reuse 语义的独立 formal owner，也不冻结 `source_note_id` 的 admitted canonical mapping。

### 6. 未来扩 identity 的准入条件

若未来要把 `image_scenes` 或其他候选字段纳入 detail identity，必须同时满足：

1. 仓库内出现可复核的 runtime / test / artifact 证据
2. 该证据能稳定证明 `note_id` 单独使用会造成 false-hit、false-miss 或错误复用
3. 通过新的独立 spec 修订 PR

在这些条件满足前：

- 后续实现 PR 不得自行把 `image_scenes` 写入 identity
- 后续实现 PR 不得在 `#508` formal freeze 前自行冻结 detail request-shape truth、shape_key、lookup slotting、route eligibility 或 reuse 语义
- 后续实现 PR 不得在 `#510` formal freeze 前绕过这条 required detail-path gate
- guardian finding 不能被“以后可能需要”替代当前 formal 结论

## GWT 验收场景

### 场景 1：note_id 单独构成 current v1 detail identity

Given 调用方发起 `xhs.detail`
And 当前请求包含合法 `note_id`
When 系统导出 current v1 detail identity
Then identity anchor 必须可以仅基于 `note_id` 建立
And 不得要求 `image_scenes`

### 场景 2：image_scenes 缺失不会阻断 current v1 identity

Given 当前 detail 请求未携带 `image_scenes`
When 系统导出 current v1 detail identity
Then identity anchor 仍必须可导出
And 不得因缺失 `image_scenes` 把请求判为 identity 不完整

### 场景 3：同 note_id 不因 image_scenes 不同而变成不同 identity

Given 两条 detail request 或 template 的 `note_id` 相同
And 它们的 `image_scenes` 不同、缺失或一方不存在
When 系统判断当前 formal 是否允许把 `image_scenes` 加入 identity
Then 当前 formal 结果必须是不允许
And 不得仅因 `image_scenes` 差异认定 identity anchor 改变

### 场景 4：captured detail request artifact 不扩张 formal identity

Given 当前已观测到 `/api/sns/web/v1/feed` detail request artifact
And request body 中存在 `source_note_id`
When reviewer 检查 current v1 formal identity 结论
Then canonical identity 仍必须只冻结 `note_id`
And 本 FR 不得把 `source_note_id` 扩写为 admitted canonical mapping、跨路由 transport alias、未审查 route admission 规则或第二个独立 identity 字段

### 场景 5：image_scenes 只能作为 non-identity candidate

Given detail runtime 或 test 现场观测到了 `image_scenes`
When 系统记录当前 v1 contract
Then 当前 formal 只能确认它不进入 canonical identity
And 不得把它的 diagnostics / compatibility placement 写成 current v1 formal truth

### 场景 6：未来扩 identity 必须重新过 spec review

Given 后续实现或 guardian 提出把 `image_scenes` 纳入 detail identity
When 当前仓库仍缺少 admission-ready runtime / test / artifact evidence
Then 该提议不得直接进入 current implementation
And 必须等待新的 spec 修订

## 异常与边界场景

- `note_id` 缺失时，当前 detail identity anchor 不可导出；这是 command input 问题，不是 `image_scenes` 问题。
- `image_scenes` 缺失、为空或值不稳定时，当前 formal 结论仍必须保持 `note_id`-only identity。
- 对当前已观测到的 `/api/sns/web/v1/feed` request artifact，`source_note_id` 目前只是一条 observed / candidate 事实，不在 current v1 formal contract 中承担 admitted canonical mapping、transport alias、artifact-side derivation 或其他 identity 语义；如未来要冻结其地位，必须基于新的 admission-ready 仓库证据和新的 spec 修订。
- 若未来仓库证据证明 `note_id` 单独使用会产生错误复用，本 FR 不阻止未来修订，但在修订完成前 current implementation 仍必须遵守 current v1 结论。
- `image_scenes` 不入 identity 不等于禁止记录该字段；只是不允许它驱动 current v1 canonical identity anchor。

## 验收标准

1. current v1 `xhs.detail` canonical identity anchor 已冻结为 `note_id` only。
2. 当前已观测到的 `source_note_id` 未被写成 frozen identity baseline、第二个 identity 字段、admitted canonical mapping 或更广 transport alias。
3. `image_scenes` 已冻结为 not-in-identity。
4. 本 FR 未把 diagnostics / compatibility placement、shape、shape_key、eligibility 等非目标语义写成 de facto formal truth。
5. 后续实现 PR 不得以“当前 formal 未明确禁止”为由擅自把这些字段写入 identity，或把 `source_note_id` 的 canonical mapping / alias / derivation 关系倒推出为 formal truth。
6. future identity expansion 或 request/artifact canonical mapping / alias freeze 的准入条件已明确为“仓库内 admission-ready evidence + 新 spec 修订”。
7. detail request-shape truth、shape_key、lookup slotting、route eligibility 与 reuse 语义如需冻结，必须先经过 `#508` 对应的 formal spec review，不能由单独实现 PR 越权决定。
8. successor detail implementation path 必须在消费 `#504 + #505` merged baselines 的前提下继续等待 `#508 + #510` 两条 open formal gate；其中 `#510` 只作为 required detail-path gate 引用，不在本 FR 内重述其 owning suite scope。

## 依赖与前置条件

- `vision.md`
- `docs/dev/roadmap.md`
- `docs/dev/architecture/system-design.md`
- `docs/dev/architecture/system-design/read-write.md`
- `docs/dev/specs/FR-0024-xhs-request-shape-truth/spec.md`
- `docs/dev/specs/FR-0024-xhs-request-shape-truth/research.md`
- GitHub issue `#504`（detail/user_home command surface 与 request-context baseline formal freeze）
- GitHub issue `#508`（shared request-context reuse semantics 与 replacement implementation formal gate）
- GitHub issue `#510`（successor detail implementation path 所需的 required detail-path gate；owning suite 继续以 `FR-0028` 为准）
- `src/commands/xhs-input.ts`
- `src/commands/xhs-runtime.ts`
- `tests/content-script-handler.xhs-read.contract.test.ts`
- `tests/extension.service-worker.gate-approval.suite.ts`
- `tests/xhs-read-execution.fallback.test.ts`
- GitHub issue `#505`
