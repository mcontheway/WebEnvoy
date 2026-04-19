# FR-0028 TODO

- [ ] reviewer 确认 current v1 `xhs.detail` capture-side canonical `note_id` derivation` 已被独立 formal freeze
- [ ] reviewer 确认 admitted derivation source 只允许 response-side detail note candidate record 上的 `note_id` / `noteId` / `id`
- [ ] reviewer 确认 metadata-only note id 不构成 admitted success evidence
- [ ] reviewer 确认 wrapper note-id-like field 只在 matcher-unaccepted wrapper / record 上属于 candidate-only，不把 matcher 已接受的 wrapper-shaped candidate record 误降级
- [ ] reviewer 确认 `source_note_id` 与 referrer 仍只属于 candidate-only observation，不进入 admitted canonical truth
- [ ] reviewer 确认本 FR 未与 `FR-0025` 的 command surface baseline 冲突
- [ ] reviewer 确认本 FR 未与 `FR-0026` 的 identity-only freeze 冲突
- [ ] reviewer 确认本 FR 未越权冻结 `#508` 负责的 shared reuse semantics
- [ ] reviewer 确认 replacement implementation 的 detail formal gate 已显式要求消费本 FR
