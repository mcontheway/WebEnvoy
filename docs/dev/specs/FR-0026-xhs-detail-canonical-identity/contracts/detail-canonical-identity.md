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
- 本 FR 不定义 identity 之外的 detail matching 语义。

## 2. Non-identity boundary

```ts
type XhsDetailNonIdentityBoundaryV1 = "no_additional_detail_identity_fields_frozen";
```

约束：

- current v1 formal 只冻结：`image_scenes` 当前不是 canonical identity 的组成部分。
- 本 FR 不冻结这些字段的 diagnostics / compatibility placement、输出位置或具体 shape。
- 它们不得进入 canonical identity anchor，也不得成为额外 identity discriminator。
- 本 FR 不定义 detail compatibility、rejected-source matching、template reuse 或其他 request-context 语义。

## 3. Current v1 exclusion rule

```ts
type ExcludeImageScenesFromIdentityV1 = (
  current: XhsDetailCanonicalIdentityAnchorV1,
  candidateImageScenes: unknown
) => "still_same_identity_anchor";
```

约束：

- `image_scenes` 差异不得单独导致新的 identity discriminator
- 本 FR 不把 identity 之外的 comparison semantics 冻结成 formal truth
## 4. Current v1 artifact observation boundary

约束：

- current v1 canonical identity 仍只围绕 canonical `note_id` 建立。
- 对当前已观测到的 `/api/sns/web/v1/feed` detail request artifact，request body 中的 `source_note_id` 只被视为 observed artifact field。
- 本 FR 不冻结 `source_note_id` 的 verified transport truth、standalone identity derivation、其他 placement 或其他 route 上的 normalization 规则。
- `source_note_id` 不新增第二个 identity 字段，也不得在缺少 command-side `note_id` 时单独导出 canonical identity。
- 其他 request/artifact 字段不在本 FR scope。
- 若未来需要 formalize request/artifact normalization 或 artifact-side identity derivation，必须基于新的仓库证据和新的 spec 修订。

## 5. Future revision gate

若未来要把 `image_scenes` 或其他候选字段纳入 identity，必须同时满足：

- 仓库内出现 admission-ready runtime / test / artifact 证据
- 该证据能稳定证明 `note_id` only identity 不足
- 通过新的独立 spec 修订 PR
