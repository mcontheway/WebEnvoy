# FR-0026 契约：XHS Detail Canonical Identity（Current v1）

## 1. Canonical identity anchor

```ts
type XhsDetailCanonicalIdentityAnchorV1 = {
  note_id: string;
};
```

约束：

- `note_id` 是 current v1 唯一被本 FR 正式冻结的 canonical identity anchor 字段。
- `note_id` 必须为 trim 后非空字符串。
- 本 FR 不定义完整 detail request shape、`shape_key`、lookup key 或 eligibility tuple。

## 2. Non-identity context

```ts
type XhsDetailNonIdentityContext = {
  image_scenes?: unknown;
};
```

约束：

- 上述字段当前都不是 canonical identity 的组成部分。
- 它们只能作为 diagnostics / compatibility context 保留。
- 它们不得进入 canonical identity anchor，也不得成为额外 identity discriminator。

## 3. Current v1 exclusion rule

```ts
type ExcludeImageScenesFromIdentityV1 = (
  current: XhsDetailCanonicalIdentityAnchorV1,
  candidateImageScenes: unknown
) => "still_same_identity_anchor";
```

约束：

- `image_scenes` 差异不得单独导致新的 identity discriminator
- 本 FR 不把完整 detail shape 或 comparison tuple 冻结成 formal truth

## 4. Current v1 compatibility note

```ts
type XhsDetailCompatibilityObservationV1 = {
  note_id?: string;
  source_note_id?: string;
};
```

约束：

- current v1 canonical identity 仍只围绕 canonical `note_id` 建立。
- 当前仓库证据只证明 canonical `note_id` 可以被写出到兼容字段 `source_note_id`。
- 本 FR 不把“仅凭 artifact 的 `source_note_id` 反向归一化回 canonical `note_id`”写成 current v1 formal truth。

## 5. Future revision gate

若未来要把 `image_scenes` 或其他候选字段纳入 identity，必须同时满足：

- 仓库内出现 admission-ready runtime / test / artifact 证据
- 该证据能稳定证明 `note_id` only identity 不足
- 通过新的独立 spec 修订 PR
