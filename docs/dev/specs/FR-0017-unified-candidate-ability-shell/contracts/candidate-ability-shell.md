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
  execution_layer_support: Array<"L3" | "L2" | "L1">
  input_contract_ref: string
  output_contract_ref: string
  error_contract_ref: string
  capture_origin: "l3_adapter_sample" | "l2_first_usable_sample"
  candidate_status: "draft_candidate" | "candidate_ready"
  capture_run_id: string
  capture_profile: string
  seed_replay_input_ref?: string
  capture_artifact_refs?: string[]
  captured_at: string
}
```

约束：

- `ability_id` 在本地能力空间内稳定唯一。
- `platform_family` 必须使用稳定、归一化的平台键；`generic_web` 用于站点无关场景，`other` 只能作为临时兜底，不得把新的一等平台永久冻结进 `other`。
- `candidate_status` 只表达“是否已形成候选能力”，不表达验证通过与否。
- `execution_layer_support` 至少能表达当前候选能力支持哪些执行层；共享正式枚举必须保留 `L1` / `L2` / `L3`，不得把未来 L1 候选层排除在 descriptor 模型之外，也不得用该字段替代验证结果。
- `input_contract_ref`、`output_contract_ref`、`error_contract_ref` 都必须指向稳定、机器可读的契约标识；它们的 ownership 属于 `candidate_ability_descriptor` 命名空间，而不是 runtime-store、validation view 或下游实现私有映射。
- `*_contract_ref` 的 canonical namespace 必须统一为 `cad::<ability_id>::<input|output|error>::v<major>`；其中 `cad` 固定表示 `candidate_ability_descriptor` contract namespace，`ability_id` 必须直接等于当前 descriptor 的 `ability_id`，`<input|output|error>` 只能表达该 ref 的契约种类，`v<major>` 只在发生不兼容变化时递增。
- `*_contract_ref` 的 authoritative resolver 只能是该 `ability_id` 对应的 descriptor-owned contract registry；lookup 必须按完整 ref 精确匹配，并校验 `ability_id` 与契约种类同时一致。下游实现不得把 ref 自行解释成 repo 路径、runtime-store 主键或私有别名。
- 同一个 `*_contract_ref` 在所有实现中都必须代表同一份兼容契约边界；若输入、输出或错误语义发生不兼容变化，必须生成新的 ref，不得静默复用旧值。
- `capture_run_id` 是候选能力来源证据的最小硬锚点。
- `seed_replay_input_ref` 如存在，必须指向首个 `FR-0018.ReplayInputSnapshotRef.snapshot_ref`；它是可选的上游 replay seed，而不是 `draft_candidate` 的强制前置。
- `seed_replay_input_ref` 如存在，必须与 `capture_run_id + capture_profile` 对应的成功捕获输入同源；`capture_artifact_refs` 不能充当该字段的替代值。
- `ability_kind=write` 时，`seed_replay_input_ref` 只允许作为 capture evidence 引用保留；在后续 FR 没有正式冻结 write replay 的 gate 元数据或 dry-run 语义前，不得把它解释成可执行 replay seed。
- `capture_artifact_refs` 如存在，必须是与 `capture_run_id` 同属一次运行的补充 evidence refs；在上游等价 evidence carrier 正式冻结前，不得把它设为 candidate 成立的强制前置。

## 2. `candidate_ability_contract_registry`

```ts
interface CandidateAbilityContractRegistryEntry {
  contract_ref: string
  contract_kind: "input" | "output" | "error"
  contract_body: Record<string, unknown>
}

interface CandidateAbilityContractRegistry {
  ability_id: string
  entries: CandidateAbilityContractRegistryEntry[]
}
```

约束：

- `candidate_ability_contract_registry` 是 `*_contract_ref` 的唯一正式解引用入口；消费者必须先拿到同一 `ability_id` 的 descriptor，再读取该 descriptor-owned registry 做精确 lookup。
- 解引用规则固定为：
  - 以 `candidate_ability_descriptor.ability_id` 锁定唯一 registry owner
  - 在 `entries[*].contract_ref` 中按完整 ref 精确匹配
  - 匹配结果的 `contract_kind` 必须与 ref 中声明的 kind 一致
- 若 registry 缺失、同 ref 匹配到多条 entry、或 entry 的 `contract_kind` 与 ref kind 不一致，descriptor 必须视为无效，不得继续被下游 FR 消费。
- `contract_body` 是被 `*_contract_ref` 解引用后的正式契约边界；实现不得绕过 registry 直接猜 repo 路径、runtime-store 行键或其他私有定位规则。

## 3. `candidate_ability_invocation`

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
- `ability.layer` 必须落在 `candidate_ability_descriptor.execution_layer_support` 之内；若候选能力未声明支持某执行层，调用方不得以该层发起 invocation。
- `ability.action` 必须直接等于 `candidate_ability_descriptor.ability_kind`；若调用方传入的 action 与 descriptor kind 不一致，runtime 必须以结构化输入错误拒绝该 invocation。
- `candidate_ability_descriptor` 自身就是输入/输出/错误契约引用的正式真相源；调用对象不得再引入独立的 `descriptor_ref` 或其他平行绑定壳。

## 4. 结果挂载规则

约束：

- 成功结果继续复用 `FR-0007` 的成功壳，并落在 `summary.capability_result` 之下。
- `FR-0017` 不新增并行顶层结果壳；不得创造 `summary.capability_result` 之外的 `candidate_ability_result_envelope` 一类结构。
- 结果与候选能力描述的绑定继续通过 `ability.id -> candidate_ability_descriptor.ability_id` 完成，不在调用对象或成功结果里复制第二套 descriptor 绑定壳。

## 5. 继承边界

- `FR-0007` 仍是最小能力壳来源。
- `FR-0017` 只冻结候选能力描述对象和与最小能力壳的映射。
- 验证 / 重放 / 可信判断对象由后续 `FR-0018` 承接。
