# FR-0012 TODO

## 评审阻断项

- [x] `spec.md` 补齐背景、目标、非目标、功能需求、GWT、异常边界、验收标准与依赖前置。
- [x] `plan.md` 补齐七节必答项并写清进入实现前条件。
- [x] `contracts/` 冻结 Layer 1 的稳定机器边界。
- [x] `data-model.md` 明确 profile 元数据与 patch 清单字段。
- [x] `research.md` 收敛 Phase 2 定位、P0/P1/P2 范围与已知硬边界。
- [x] `risks.md` 写清 stop-ship、降级与回滚方向。
- [x] 明确 FR-0012 继承 `FR-0010/0011`，不重定义门禁/审批/状态机对象。

## 进入实现前必须完成

- [ ] FR-0012 spec review 通过。
- [ ] reviewer 确认 `#235` 在 `#233` umbrella 下的定位已表述清楚。
- [ ] reviewer 确认 FR-0012 未改写 `FR-0010/0011` 的既有对象语义。
- [ ] reviewer 确认 Worker 线程盲区被明确保留，不存在过度承诺。
- [ ] reviewer 确认 P0/P1/P2 分阶段范围与“何时算完成 #235”口径已一致。

## spec 通过后的实施清单（非本 PR）

- [ ] 实现 `fingerprint_profile_bundle` 的生成/加载/校验。
- [ ] 实现 `fingerprint_patch_manifest` 的构造与补丁前置校验。
- [ ] 落地 P0 补丁：`AudioContext`、Battery API、`navigator.plugins`、`navigator.mimeTypes`。
- [ ] 落地 profile 环境绑定校验与失配处理。
- [ ] 视切片安排继续落地 P1/P2 补丁。
- [ ] 为 profile 元数据、manifest、环境绑定与错误分类补齐自动化测试。
- [ ] 在检测站点上补齐集成验证证据。

## 关联事项

- [ ] Refs #232
- [ ] Refs #233
- [ ] Refs #235
