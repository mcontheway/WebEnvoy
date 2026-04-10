# FR-0018 TODO

## 评审阻断项

- [ ] `spec.md` 已明确 FR-0018 只承接最小验证、重放与可信判断，不混入导入/安装/版本治理。
- [ ] `spec.md` 已明确继承 `FR-0017`、`FR-0004`、`FR-0006`，不重定义既有对象。
- [ ] `spec.md` 已冻结最小验证请求、最小重放请求与最小健康状态。
- [ ] `spec.md` 已冻结最近一次验证结果与最小失败大类。
- [ ] `spec.md` / `contracts/` / `data-model.md` 已统一把 health view、latest 与 replay eligibility 收口为 `ability_ref + profile_ref + execution_layer` 作用域，并要求请求显式给出 `requested_execution_layer`。
- [ ] `spec.md` / `contracts/` / `data-model.md` 已统一明确：无关支持层的新增或删除不得单独使当前 layer 视图失效，只有 `validated_execution_layer` 本身失去覆盖时才可据此判为 `stale`。
- [ ] `spec.md` / `contracts/` / `data-model.md` 已统一冻结 `ReplayInputSnapshotRef.captured_input_contract_ref`，并明确 `input_contract_ref` 变化会使 `last_success_input_ref` 与旧 snapshot 失效。
- [ ] `spec.md` / `contracts/` / `data-model.md` 已统一冻结 `payload_locator` 的 resolver 边界、生命周期与 cleanup 规则，不再允许临时文件路径或 run artifact URL 充当正式 locator。
- [ ] `spec.md` / `contracts/` / `data-model.md` 已统一明确：无上游 `seed_replay_input_ref` 时，首个 `ReplayInputSnapshotRef` 只允许由首次成功 `smoke_validation` 建立；成功 replay 只能刷新后续 snapshot，不能承担 bootstrap。
- [ ] `spec.md` / `contracts/` / `data-model.md` 已统一明确：FR-0018 当前 formal baseline 不允许 cross-layer auto-fallback，`requested_execution_layer` 与 `validated_execution_layer` 必须一致，且结果只能写回对应 layer 视图。
- [ ] `plan.md` 已补齐七节最小结构，并写清与 `FR-0019/0021` 的并行 / 串行关系。
- [ ] `contracts/ability-validation.md` 已冻结稳定对象与边界。
- [ ] `data-model.md` 已明确最近一次验证结果与运行证据的引用方式。
- [ ] `risks.md` 已覆盖“验证通过被误读为可交付”“重放被误写成自动修复”等风险。

## 进入实现前必须完成

- [ ] FR-0018 spec review 通过并形成明确结论。
- [ ] reviewer 确认 `#155` 在 Phase 2 -> FR-0018 主树中的定位已表述清楚。
- [ ] reviewer 确认本 FR 未与 `FR-0017` 生命周期边界冲突。
- [ ] reviewer 确认健康状态与失败大类足以支撑最小用户判断，不需要再临时补第二套状态。

## spec 通过后的实施清单（非本 PR）

- [ ] 实现验证请求入口与最小调度。
- [ ] 实现重放请求入口与最小输入快照引用。
- [ ] 实现最近一次验证结果与最小健康状态计算。
- [ ] 实现失败大类映射。
- [ ] 补齐契约测试与状态映射测试。

## 关联事项

- [ ] Refs #427
- [ ] Refs #420
- [ ] Refs #155
- [ ] Refs #157
- [ ] Refs #153
