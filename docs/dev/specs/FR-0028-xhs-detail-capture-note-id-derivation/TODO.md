# FR-0028 TODO

- [ ] reviewer 确认 current v1 `xhs.detail` capture-side canonical `note_id` derivation` 已被独立 formal freeze
- [ ] reviewer 确认 admitted derivation source 只允许 response-side detail note candidate record 上的 `note_id` / `noteId` / `id`
- [ ] reviewer 确认 current v1 admitted matcher boundary 只冻结到 `body.data.note` 与 `body.data.items[*].note_card` 这两类已验证 path
- [ ] reviewer 确认 bare-body detail roots、self root、其他 direct entry 与递归 nested path 已明确留在 implementation observation，而不是被本 FR 越权 formalize
- [ ] reviewer 确认 metadata-only note id 不构成 admitted success evidence
- [ ] reviewer 确认 `body.data.items[*].note_card` 这条已被 tests 接纳的 wrapped payload 已进入 formal matcher boundary，而不是继续留成 implementation detail
- [ ] reviewer 确认除 `body.data.items[*].note_card` 外的其他 wrapper note-id-like field 当前都未被本 FR 提升为 admitted truth
- [ ] reviewer 确认 `source_note_id` 与 referrer 仍只属于 candidate-only observation，不进入 admitted canonical truth
- [ ] reviewer 确认本 FR 未与 `FR-0025` 的 command surface baseline 冲突
- [ ] reviewer 确认本 FR 未与 `FR-0026` 的 identity-only freeze 冲突
- [ ] reviewer 确认本 FR 未越权冻结 `#508` 负责的 shared reuse semantics
- [ ] reviewer 确认 replacement implementation 的 detail formal gate 已显式要求消费本 FR
