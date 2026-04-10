# FR-0020 数据模型

本 FR 不新增最终运行时 schema，但需要冻结共享对象语义。

## 持久化与派生边界

- **持久化实体**：`AntiDetectionValidationRequest`、`AntiDetectionStructuredSample`、`AntiDetectionBaselineSnapshot`、`AntiDetectionBaselineRegistryEntry`、`AntiDetectionValidationRecord`。
- **派生视图**：`AntiDetectionValidationView` 仅由持久化实体投影得到，不作为事实来源写回或复用为 gate 依据。

## 1. `AntiDetectionValidationRequest`

- `validation_scope`
- `request_ref`
- `target_fr_ref`
- `profile_ref`
- `browser_channel`
- `execution_surface`
- `sample_goal`
- `requested_execution_mode`
- `probe_bundle_ref`
- `request_state`
- `requested_at`

`validation_scope=cross_layer_baseline` 是唯一 Layer 4 编码入口，仅用于跨 Layer 1-3 信号聚合后的基线评估。
`requested_execution_mode` 的正式语义一律继承 `FR-0010/0011`。

### 请求 identity 与生命周期

- `request_ref` 是 validation request 的稳定标识；即使参数元组完全相同，不同请求也必须生成新的 `request_ref`。
- `request_state` 只允许 `accepted -> sampling -> completed` 或 `accepted -> sampling -> aborted` 两类单向推进，不得回退。
- request 的审计与相关性应以 `request_ref` 为主键，而不是依赖参数元组去重。

## 2. `AntiDetectionStructuredSample`

- `sample_ref`
- `request_ref`
- `target_fr_ref`
- `validation_scope`
- `profile_ref`
- `browser_channel`
- `execution_surface`
- `effective_execution_mode`
- `probe_bundle_ref`
- `run_id`
- `captured_at`
- `structured_payload`
- `artifact_refs`

### 样本对象边界

- `AntiDetectionStructuredSample` 是 `sample_ref` 的唯一正式归属对象。
- `structured_payload` 必须承载可重放、可比对、可诊断的最小结构化样本，不得退化为纯文本摘要。
- `artifact_refs` 只承载原始证据引用，不替代 `structured_payload`。
- `effective_execution_mode` 继承 `FR-0010/0011` 的正式语义，并与 `profile_ref`、`browser_channel`、`execution_surface` 一起构成样本隔离维度。

## 3. `AntiDetectionBaselineSnapshot`

- `baseline_ref`
- `target_fr_ref`
- `validation_scope`
- `probe_bundle_ref`
- `profile_ref`
- `browser_channel`
- `execution_surface`
- `effective_execution_mode`
- `signal_vector`
- `captured_at`
- `source_sample_refs`
- `source_run_ids`

### 不可变规则

- `baseline_ref` 是不可变的快照标识，不允许复写或复用。
- baseline snapshot 只承载采样事实，不负责声明自己是否仍为 active baseline。
- `effective_execution_mode` 是 baseline 的正式分区维度；不得把 `dry_run`、`recon` 与 live 证据混成同一条 baseline。
- `source_sample_refs` 必须记录形成该 baseline 的结构化样本集合，以保证基线可以回溯到正式样本载体。

## 4. `AntiDetectionBaselineRegistryEntry`

- `target_fr_ref`
- `validation_scope`
- `profile_ref`
- `browser_channel`
- `execution_surface`
- `effective_execution_mode`
- `probe_bundle_ref`
- `active_baseline_ref`
- `superseded_baseline_refs`
- `replacement_reason`
- `updated_at`

### 作用域键与 ownership

- registry entry 的唯一作用域键为 `(target_fr_ref, validation_scope, profile_ref, browser_channel, execution_surface, effective_execution_mode, probe_bundle_ref)`。
- `active_baseline_ref` 是该作用域下唯一正式生效的 baseline。
- `superseded_baseline_refs` 记录此前被该 entry 替换掉的 baseline；允许为空数组，但不得为 `null`。
- `replacement_reason` 记录当前 active baseline 成为正式基线的原因。

### baseline replacement 真相源

- baseline replacement 的正式真相只存在于 `AntiDetectionBaselineRegistryEntry`；snapshot、record 或共享视图都不得单独宣布某条 baseline 已被替换。
- 若生成新的基线，应创建新的 `baseline_ref`，并通过更新同作用域 registry entry 的 `active_baseline_ref` 来完成替换。
- 只有当旧 `baseline_ref` 不再等于 registry entry 的 `active_baseline_ref`，并被纳入 `superseded_baseline_refs` 后，旧 baseline 才进入 `superseded` 语义。
- 视图层的 `stale`、`insufficient_baseline` 判定必须消费 registry entry，而不能只依赖记录自身状态。
- 不同 `probe_bundle_ref` 默认不得复用同一 registry entry；若未来要支持跨 bundle 复用，必须在独立 spec review 中补齐兼容等级规则。

## 5. `AntiDetectionValidationRecord`

- `record_ref`
- `request_ref`
- `target_fr_ref`
- `validation_scope`
- `profile_ref`
- `browser_channel`
- `execution_surface`
- `effective_execution_mode`
- `probe_bundle_ref`
- `sample_ref`
- `baseline_ref`
- `result_state`
- `drift_state`
- `failure_class`
- `run_id`
- `validated_at`

### 状态语义

- `result_state=captured`：已通过 `sample_ref` 持久化样本但尚未完成有效对比，`drift_state` 必须为 `insufficient_baseline`。
- `result_state=verified`：已完成对比且无偏离，`drift_state` 必须为 `no_drift`。
- `result_state=broken`：对比失败或验证流程不可通过，`failure_class` 必填，`drift_state` 为 `drift_detected` 或 `insufficient_baseline`。
- `result_state=stale`：记录因基线被替换、时间窗过期或关键样本缺失而失效，`drift_state` 必须为 `insufficient_baseline`。

### `baseline_ref` 绑定规则

- 当记录引用了可用 baseline 并完成对比时，`baseline_ref` 必填且一经写入不得改写。
- 当 `drift_state=insufficient_baseline` 且当前不存在可用 baseline 时，`baseline_ref` 允许为空。
- 当记录因原基线已 `superseded` 而进入 `stale` 语义时，必须保留原 `baseline_ref`，不得清空。

### `sample_ref` 与 `probe_bundle_ref` 规则

- `sample_ref` 必须指向 `AntiDetectionStructuredSample.sample_ref`；`result_state=captured/verified/broken/stale` 时都必填。
- `probe_bundle_ref` 必须在 baseline snapshot 与 validation record 中同时保留，以保证落库后仍可追溯探针身份。

### 完整作用域键

- `AntiDetectionValidationRecord` 必须显式携带 `(target_fr_ref, validation_scope, profile_ref, browser_channel, execution_surface, effective_execution_mode, probe_bundle_ref)` 的完整作用域键。
- 当 `baseline_ref` 为空或 `sample_ref` 缺失时，仍必须能够只依赖记录自身字段被确定性归入正确的共享视图与 baseline scope。
- `request_ref` 必须把 record 与其来源 request 关联起来，不能只依赖时间或参数推断。

## 6. `AntiDetectionValidationView`

- `target_fr_ref`
- `validation_scope`
- `profile_ref`
- `browser_channel`
- `execution_surface`
- `effective_execution_mode`
- `probe_bundle_ref`
- `latest_record_ref`
- `baseline_status`
- `current_result_state`
- `current_drift_state`
- `last_success_at`

### 派生规则

- `baseline_status` 是 closed enum，只允许 `ready`、`insufficient`、`superseded`。
- 只有在首条 validation record 已落库后，`AntiDetectionValidationView` 才允许物化；empty scope 不生成 view 行。
- 当当前作用域存在 active baseline，且 `latest_record_ref` 未绑定已被替换的 baseline 时，`baseline_status=ready`。
- 当 `latest_record_ref` 指向的记录所引用 `baseline_ref` 不再等于同作用域 registry entry 的 `active_baseline_ref` 时，视图应将 `current_result_state` 置为 `stale`，并将 `current_drift_state` 置为 `insufficient_baseline`。
- 上述场景下，`baseline_status` 也必须为 `superseded`。
- 当目标 scope 不存在可用基线或样本覆盖不足时，视图应将 `baseline_status` 标记为 `insufficient`，并将 `current_drift_state` 置为 `insufficient_baseline`。

## 约束

- baseline snapshot 与 validation record 不得共用同一对象。
- baseline replacement 的 active/superseded 判定只能来自 `AntiDetectionBaselineRegistryEntry`。
- `dry_run`、`recon` 与 live 证据必须按 `effective_execution_mode` 分开建 baseline，不得共享同一 registry entry。
- 不同 `probe_bundle_ref` 的证据必须按独立 registry/view scope 管理，不得混入同一 baseline。
- `target_fr_ref` 只允许指向反风控能力 FR。
- 本 FR 的对象只承载能力级验证，不承载 PR 级 merge gate。
