# FR-0026 契约：XHS Detail Canonical Identity（Current v1）

## 1. Canonical identity

```ts
type XhsDetailCanonicalIdentityV1 = {
  command: "xhs.detail";
  note_id: string;
};
```

约束：

- `note_id` 是 current v1 唯一 canonical identity 字段。
- `note_id` 必须为 trim 后非空字符串。
- current v1 detail 的 `shape`、`shape_key`、lookup key 与 eligibility 判断都只能围绕这组字段建立。

## 2. Non-identity context

```ts
type XhsDetailNonIdentityContext = {
  image_scenes?: unknown;
};
```

约束：

- 上述字段当前都不是 canonical identity 的组成部分。
- 它们只能作为 diagnostics / compatibility context 保留。
- 它们不得进入 `shape`、`shape_key`、lookup key 或 eligibility gate。

## 3. Current v1 comparison rule

```ts
type CompareXhsDetailIdentityV1 = (
  left: XhsDetailCanonicalIdentityV1,
  right: XhsDetailCanonicalIdentityV1
) => "exact_match" | "mismatch";
```

约束：

- 只要 `note_id` 相同，current v1 comparison 就必须返回 `exact_match`
- `image_scenes` 差异不得单独导致 `mismatch`

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
