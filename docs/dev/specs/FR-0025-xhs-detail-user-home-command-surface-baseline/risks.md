# FR-0025 风险与边界

## 风险 1：把 historical fact 误继续当 current blocker

- 表现：
  - 后续实现 PR 或 closeout 继续引用 `FR-0005` fixed sample 中“detail/user_home 无公开命令面”的旧表述
- 影响：
  - `#500` 的实现范围继续摇摆
  - `#445` closeout 继续在错误 blocker 上停留
- 缓解：
  - 在本 FR 明确冻结 current public command surface
  - 当前 FR 只显式记录 formal mismatch
  - `FR-0005` 的正式回写继续留给后续专门收口

## 风险 2：在 #504 中提前冻结 detail identity

- 表现：
  - 把 `image_scenes`、`CRD_PRV_WEBP` 等字段混入 command surface baseline
- 影响：
  - formal scope 与 `#505` 冲突
  - 后续实现 PR 可能基于未证实 identity 做错误 shape 冻结
- 缓解：
  - 本 FR 明确禁止冻结 detail identity
  - 显式把相关字段转交 `#505`

## 风险 3：重新发明第二套授权输入

- 表现：
  - detail/user_home command-level spec 把仅嵌套 `options.upstream_authorization_request` 误写成 caller-facing canonical 输入
  - detail/user_home command-level spec 再定义一套新的 upstream auth fields
- 影响：
  - 与 `FR-0023` 冲突
  - 后续实现出现双重输入真相源
- 缓解：
  - 本 FR 明确只消费 `FR-0023` 四个顶层对象输入
  - 明确 `options.upstream_authorization_request` 只是 current parser 的内部归一化结果

## 风险 4：漏掉 caller-facing ability envelope

- 表现：
  - 规格只写 command input 与 gate fields，却把 `ability.id/layer/action` 从 current public CLI baseline 中漏掉
- 影响：
  - 后续实现或 closeout 会把与 current parser 不一致的输入误判为 formal truth
  - guardian 会持续把 latest-main 真实 caller-facing contract 与 formal freeze 的缺口打成阻断
- 缓解：
  - 本 FR 显式冻结 caller-facing `ability` envelope 仍是 current public CLI baseline
  - 只把 canonical ability 对齐冻结为 metadata 边界，不把非 canonical ability 行为误报为受支持契约

## 风险 5：把 request-level result 升格为长期资源状态真相源

- 表现：
  - 将 `request_admission_result` / `execution_audit` 当作长期资源状态或运营状态
- 影响：
  - 破坏 `FR-0023` 已冻结的 ownership 边界
- 缓解：
  - 本 FR 只冻结 command-level ownership，不扩写长期状态语义

## 风险 6：把 shared contract 误报为 local-only

- 表现：
  - PR 元数据继续把 `FR-0025` 申报为 `integration_applicable=no`
- 影响：
  - 与 `FR-0023` 已冻结的 shared upstream contract / request-level result 边界不一致
  - guardian 会持续把 formal spec review PR 阻断为 integration 元数据不合规
- 缓解：
  - 沿用 `#464` 作为当前本地 integration 锚点
  - 在 PR 描述中显式声明 shared contract changed、`merge_gate=integration_check_required` 与 integration 状态核对结果
