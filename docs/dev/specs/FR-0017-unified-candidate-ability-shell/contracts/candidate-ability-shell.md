# FR-0017 契约：候选能力描述与能力壳

## 1. `candidate_ability_descriptor`

```ts
interface CandidateAbilityDescriptor {
  ability_id: string
  display_name: string
  ability_kind: "read" | "write" | "download"
  entrypoint: string
  platform_scope: {
    platform_family: "xhs" | "generic_web" | "other"
    site_pattern?: string
  }
  execution_layer_support: Array<"L3" | "L2">
  input_contract_ref: string
  output_contract_ref: string
  error_contract_ref: string
  capture_origin: "l3_adapter_sample" | "l2_first_usable_sample"
  candidate_status: "draft_candidate" | "candidate_ready"
  capture_run_id: string
  capture_profile?: string
  capture_artifact_refs: string[]
  captured_at: string
}
```

约束：

- `ability_id` 在本地能力空间内稳定唯一。
- `candidate_status` 只表达“是否已形成候选能力”，不表达验证通过与否。
- `execution_layer_support` 至少能表达当前候选能力支持哪些执行层；不得用它替代验证结果。
- `capture_artifact_refs` 必须是与 `capture_run_id` 同属一次运行的 run-scoped 证据引用；FR-0017 只保留 opaque ref，不定义第二套 artifact 真相源。

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
  descriptor_ref: string
}
```

约束：

- `ability`、`input`、`options` 的最小语义继续继承 `FR-0007`。
- `ability` 必须继续保持 `FR-0007` 的结构对象，不得降格为字符串或其他别名。
- `ability.id` 必须与 `descriptor_ref` 指向描述对象中的 `ability_id` 一致。
- `descriptor_ref` 只负责把本次调用与候选能力描述绑定起来，不引入第二套调用壳。

## 3. `candidate_ability_result_envelope`

```ts
interface CandidateAbilityResultEnvelope {
  descriptor_ref: string
  capability_result: Record<string, unknown>
  diagnosis_ref?: string
}
```

约束：

- `capability_result` 继续落在 `FR-0007.summary.capability_result` 之下。
- `diagnosis_ref` 只引用后续诊断/验证对象，不在本契约内展开。

## 4. 继承边界

- `FR-0007` 仍是最小能力壳来源。
- `FR-0017` 只冻结候选能力描述对象和与最小能力壳的映射。
- 验证 / 重放 / 可信判断对象由后续 `FR-0018` 承接。
