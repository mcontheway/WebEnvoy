# FR-0017 契约：候选能力描述与能力壳

## 1. `candidate_ability_descriptor`

```ts
interface CandidateAbilityDescriptor {
  ability_id: string
  display_name: string
  ability_kind: "read" | "write" | "download"
  entrypoint: string
  platform_scope: {
    platform_family: string
    site_pattern?: string
  }
  execution_layer_support: Array<"L3" | "L2">
  input_contract_ref: string
  output_contract_ref: string
  error_contract_ref: string
  capture_origin: "l3_adapter_sample" | "l2_first_usable_sample"
  candidate_status: "draft_candidate" | "candidate_ready"
  capture_run_id: string
  capture_profile: string
  capture_artifact_refs?: string[]
  captured_at: string
}
```

约束：

- `ability_id` 在本地能力空间内稳定唯一。
- `platform_family` 必须使用稳定、归一化的平台键；`generic_web` 用于站点无关场景，`other` 只能作为临时兜底，不得把新的一等平台永久冻结进 `other`。
- `candidate_status` 只表达“是否已形成候选能力”，不表达验证通过与否。
- `execution_layer_support` 至少能表达当前候选能力支持哪些执行层；不得用它替代验证结果。
- `capture_run_id` 是候选能力来源证据的最小硬锚点。
- `capture_artifact_refs` 如存在，必须是与 `capture_run_id` 同属一次运行的补充 evidence refs；在上游等价 evidence carrier 正式冻结前，不得把它设为 candidate 成立的强制前置。

## 2. `candidate_ability_invocation`

```ts
interface CandidateAbilityInvocation {
  ability: {
    id: string
    layer: "L3" | "L2" | "L1"
    action: "read" | "write" | "download"
  }
  input: Record<string, unknown>
  options?: Record<string, unknown>
}
```

约束：

- `ability`、`input`、`options` 的最小语义继续继承 `FR-0007`。
- `ability` 必须继续保持 `FR-0007` 的结构对象，不得降格为字符串或其他别名。
- `ability.id` 必须直接对应 `candidate_ability_descriptor.ability_id`。
- `candidate_ability_descriptor` 自身就是输入/输出/错误契约引用的正式真相源；调用对象不得再引入独立的 `descriptor_ref` 或其他平行绑定壳。

## 3. 结果挂载规则

约束：

- 成功结果继续复用 `FR-0007` 的成功壳，并落在 `summary.capability_result` 之下。
- `FR-0017` 不新增并行顶层结果壳；不得创造 `summary.capability_result` 之外的 `candidate_ability_result_envelope` 一类结构。
- 结果与候选能力描述的绑定继续通过 `ability.id -> candidate_ability_descriptor.ability_id` 完成，不在调用对象或成功结果里复制第二套 descriptor 绑定壳。

## 4. 继承边界

- `FR-0007` 仍是最小能力壳来源。
- `FR-0017` 只冻结候选能力描述对象和与最小能力壳的映射。
- 验证 / 重放 / 可信判断对象由后续 `FR-0018` 承接。
