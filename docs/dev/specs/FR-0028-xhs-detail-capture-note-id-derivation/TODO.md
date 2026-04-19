# FR-0028 TODO

- [ ] reviewer 确认 current v1 `xhs.detail` capture-side canonical `note_id` derivation` 已被独立 formal freeze
- [ ] reviewer 确认 admitted derivation source 只允许 response-side detail note candidate record 上的 `note_id` / `noteId` / `id`
- [ ] reviewer 确认 current matcher 已接受的 detail response candidate root / path family 已冻结到“先取 `body.data ?? body`，当顶层 `body.data` 为 nullish 时回退到顶层 `body`”、detail-shaped self root、`.note`、`.note_card`、`.note_card_list[*]`、`.current_note`、`.item`、`.items[*]`、`.notes[*]` 及其递归 `.note` / `.note_card` / `.current_note` / `.item`
- [ ] reviewer 确认 bare-body detail roots、self root、其他 direct entry 与递归 nested path 已作为 current main observable matcher truth 正确进入 formal freeze，而不是被本 FR 误收窄
- [ ] reviewer 确认 metadata-only note id 不构成 admitted success evidence
- [ ] reviewer 确认 `body.data.note`、`body.data.items[*].note_card` 与 `body.data.items[*]` target-missing 检查已作为仓库内直接证据写入 formal rationale
- [ ] reviewer 确认其余 matcher 分支虽以 current main implementation 作为 observable truth 来源，但没有被误写成完整 rigid response schema
- [ ] reviewer 确认 `source_note_id` 与 referrer 仍只属于 candidate-only observation，不进入 admitted canonical truth
- [ ] reviewer 确认本 FR 未与 `FR-0025` 的 command surface baseline 冲突
- [ ] reviewer 确认本 FR 未与 `FR-0026` 的 identity-only freeze 冲突
- [ ] reviewer 确认本 FR 未越权冻结 `#508` 负责的 shared reuse semantics
- [ ] reviewer 确认 replacement implementation 的 detail formal gate 已显式要求消费本 FR
