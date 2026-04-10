# FR-0020 契约：反风控验证与基线评估

## Ownership 与兼容性

- `FR-0020` 是以下共享对象的唯一 formal owner：`anti_detection_validation_request`、`anti_detection_structured_sample`、`anti_detection_baseline_snapshot`、`anti_detection_baseline_registry_entry`、`anti_detection_validation_record`、`anti_detection_validation_view`。
- 下游 `FR-0012`、`FR-0013`、`FR-0014` 与后续 Layer 4 FR 只能消费本契约，不得各自重定义同名字段、枚举或空值语义。
- 本契约以当前 FR 套件为版本边界；在显式 runtime schema 落地前，字段集与枚举集均视为 closed contract，不允许带外扩写或静默改义。
- 向后兼容的新增字段只允许是可选字段，并且必须在同一 spec review PR 中同步更新 `spec.md`、本契约与 `data-model.md`。
- 任何既有字段的必填/可空规则变更、枚举成员变更或语义重定义，都按 breaking change 处理，必须重新进入 spec review。

## 对象

### `anti_detection_validation_request`

| 字段 | 必填 | 可空 | 语义 |
| --- | --- | --- | --- |
| `validation_scope` | 是 | 否 | closed enum；当前只允许 `layer1_consistency`、`layer2_interaction`、`layer3_session_rhythm`、`cross_layer_baseline` |
| `target_fr_ref` | 是 | 否 | 只允许指向 `FR-0012/0013/0014` 或后续 Layer 4 FR |
| `profile_ref` | 是 | 否 | 验证目标所使用的身份/环境配置引用 |
| `browser_channel` | 是 | 否 | 样本采集所用浏览器通道 |
| `execution_surface` | 是 | 否 | 样本采集执行面；不等于 `FR-0016` merge gate verdict |
| `sample_goal` | 是 | 否 | 本次验证希望采集的最小目标，不承载产品功能请求 |
| `requested_execution_mode` | 是 | 否 | 继承 `FR-0010/0011` 的正式 execution mode 语义；描述请求方目标模式 |
| `probe_bundle_ref` | 是 | 否 | 稳定、可复用的探针集合引用 |

### `anti_detection_structured_sample`

| 字段 | 必填 | 可空 | 语义 |
| --- | --- | --- | --- |
| `sample_ref` | 是 | 否 | 结构化样本主标识；`sample_ref` 只能引用该对象 |
| `target_fr_ref` | 是 | 否 | 样本服务的 FR |
| `validation_scope` | 是 | 否 | 与 request 同源的 closed enum |
| `profile_ref` | 是 | 否 | 样本采集时所用 profile |
| `browser_channel` | 是 | 否 | 样本采集时所用浏览器通道 |
| `execution_surface` | 是 | 否 | 样本采集时所用执行面 |
| `effective_execution_mode` | 是 | 否 | 继承 `FR-0010/0011` 的正式 execution mode；描述真实采集模式 |
| `probe_bundle_ref` | 是 | 否 | 生成该样本的探针集合 |
| `run_id` | 是 | 否 | 采集该样本的执行 run |
| `captured_at` | 是 | 否 | 样本完成时间 |
| `structured_payload` | 是 | 否 | 可重放、可比对、可诊断的最小结构化样本主体 |
| `artifact_refs` | 是 | 否 | 附属原始证据引用列表；可为空数组，但不得为 `null` |

### `anti_detection_baseline_snapshot`

| 字段 | 必填 | 可空 | 语义 |
| --- | --- | --- | --- |
| `baseline_ref` | 是 | 否 | 不可变快照标识；不得复写或复用 |
| `target_fr_ref` | 是 | 否 | baseline 所属 FR |
| `validation_scope` | 是 | 否 | 与 request 同源的 closed enum |
| `probe_bundle_ref` | 是 | 否 | 本快照的探针集合引用，必须落库 |
| `profile_ref` | 是 | 否 | 与该快照绑定的 profile 维度 |
| `browser_channel` | 是 | 否 | 与该快照绑定的浏览器通道 |
| `execution_surface` | 是 | 否 | 与该快照绑定的执行面 |
| `effective_execution_mode` | 是 | 否 | 继承 `FR-0010/0011` 的正式 execution mode；是 baseline 分区维度之一 |
| `signal_vector` | 是 | 否 | 结构化信号集合；不得退化为自由文本 |
| `captured_at` | 是 | 否 | 快照完成采集时间 |
| `source_run_ids` | 是 | 否 | 支撑该快照的 run id 列表；空列表不合法 |

### `anti_detection_baseline_registry_entry`

| 字段 | 必填 | 可空 | 语义 |
| --- | --- | --- | --- |
| `target_fr_ref` | 是 | 否 | registry 作用域的 FR 维度 |
| `validation_scope` | 是 | 否 | registry 作用域的验证范围 |
| `profile_ref` | 是 | 否 | registry 作用域的 profile 维度 |
| `browser_channel` | 是 | 否 | registry 作用域的浏览器通道 |
| `execution_surface` | 是 | 否 | registry 作用域的执行面 |
| `effective_execution_mode` | 是 | 否 | 继承 `FR-0010/0011` 的正式 execution mode；是 active baseline 分区维度之一 |
| `active_baseline_ref` | 是 | 否 | 当前唯一生效的 baseline；是 active/superseded 判定的正式真相源 |
| `superseded_baseline_refs` | 是 | 否 | 已被该 entry 替换掉的 baseline 列表；可为空数组，但不得为 `null` |
| `replacement_reason` | 是 | 否 | 当前 active baseline 成为生效基线的原因，如 `initial_seed`、`reseed_after_drift` |
| `updated_at` | 是 | 否 | 最近一次切换 active baseline 的时间 |

### `anti_detection_validation_record`

| 字段 | 必填 | 可空 | 语义 |
| --- | --- | --- | --- |
| `record_ref` | 是 | 否 | 验证记录主标识 |
| `target_fr_ref` | 是 | 否 | 该次验证服务的 FR |
| `validation_scope` | 是 | 否 | 与 request 同源的 closed enum |
| `profile_ref` | 是 | 否 | 该次验证所属 profile 维度 |
| `browser_channel` | 是 | 否 | 该次验证所属浏览器通道 |
| `execution_surface` | 是 | 否 | 该次验证所属执行面 |
| `effective_execution_mode` | 是 | 否 | 与实际采样/验证结果一致的 execution mode |
| `probe_bundle_ref` | 是 | 否 | 实际用于本次验证的探针集合 |
| `sample_ref` | 条件 | 是 | `result_state=captured` 时必填；其他状态允许保留但不得伪造 |
| `baseline_ref` | 条件 | 是 | 存在可用 baseline 且已绑定时必填；仅在 `drift_state=insufficient_baseline` 且当前无可用 baseline 时允许为空 |
| `result_state` | 是 | 否 | closed enum；见下方状态机语义 |
| `drift_state` | 是 | 否 | closed enum；见下方状态机语义 |
| `failure_class` | 条件 | 是 | 仅 `result_state=broken` 时必填；其他状态必须为空 |
| `run_id` | 是 | 否 | 指向本次验证执行 run 的稳定引用 |
| `validated_at` | 是 | 否 | 本次验证结果定稿时间 |

### `anti_detection_validation_view`

| 字段 | 必填 | 可空 | 语义 |
| --- | --- | --- | --- |
| `target_fr_ref` | 是 | 否 | 视图作用域的 FR 维度 |
| `validation_scope` | 是 | 否 | 视图作用域的验证范围 |
| `profile_ref` | 是 | 否 | 视图作用域的 profile 维度 |
| `browser_channel` | 是 | 否 | 视图作用域的浏览器通道 |
| `execution_surface` | 是 | 否 | 视图作用域的执行面 |
| `effective_execution_mode` | 是 | 否 | 视图作用域的真实 execution mode 分区 |
| `latest_record_ref` | 是 | 否 | 当前作用域最新一条 validation record |
| `baseline_status` | 是 | 否 | closed enum：`ready` \| `insufficient` \| `superseded` |
| `current_result_state` | 是 | 否 | latest record 在当前 registry 语义下的有效结果态 |
| `current_drift_state` | 是 | 否 | latest record 在当前 registry 语义下的有效漂移态 |
| `last_success_at` | 否 | 是 | 最近一次 `result_state=verified` 的时间；不存在成功记录时允许为空 |

## 契约约束

- `validation_scope=cross_layer_baseline` 是唯一 Layer 4 编码入口，仅用于跨 Layer 1-3 信号聚合后的基线评估，不承载 Layer 4 模型本体输出。
- baseline snapshot 不得仅以自由文本或 issue comment 充当正式载体。
- baseline replacement 的唯一正式真相源是 `anti_detection_baseline_registry_entry.active_baseline_ref`；snapshot 与 record 都不得自带可写的 active/superseded 状态。
- `requested_execution_mode` / `effective_execution_mode` 的正式语义一律继承 `FR-0010/0011`；本 FR 只把 `effective_execution_mode` 作为 baseline/sample/record/view 的分区维度，不并行重定义 mode 枚举。
- `dry_run`、`recon` 与任意 live 模式不得落入同一条 baseline registry scope。
- validation record 不得替代 `FR-0016` 的 PR 级 gate 对象。
- Layer 4 只能消费本契约对象，不得借此引入长期运营系统对象。

## 状态机语义

### `result_state`

- `captured`：已完成采样并持久化 `sample_ref` 指向的结构化样本，但尚未完成基线对比或基线不足；此时 `drift_state` 必须为 `insufficient_baseline`，`failure_class` 为空。
- `verified`：基线对比已完成且在容差内；此时 `drift_state` 必须为 `no_drift`，`failure_class` 必须为空。
- `broken`：基线对比已完成且判定失败，或验证流程确认不可通过；此时 `failure_class` 必须填写，`drift_state` 必须为 `drift_detected` 或 `insufficient_baseline`。
- `stale`：记录因基线被替换、时间窗过期或关键样本缺失而失效；此时 `drift_state` 必须为 `insufficient_baseline`，`failure_class` 为空。

### `drift_state`

- `no_drift`：已完成基线对比且未发现偏离；只允许与 `result_state=verified` 同时出现。
- `drift_detected`：已完成基线对比且发现偏离；只允许与 `result_state=broken` 同时出现。
- `insufficient_baseline`：基线缺失、样本不足或基线已被替换导致无法给出有效对比；只允许与 `result_state=captured`、`result_state=stale` 或 `result_state=broken` 同时出现。

### `baseline_ref`

- 在存在可用 baseline 且验证已绑定该 baseline 时必须填写。
- 当 `drift_state=insufficient_baseline` 且当前不存在可用 baseline 时允许为空，不得伪造引用。
- 当记录因已有 baseline 被替换而进入 `stale` 语义时，应继续保留原 `baseline_ref` 以支持 superseded 判定。

### `sample_ref`

- `sample_ref` 必须引用 `anti_detection_structured_sample.sample_ref`，不得退化为 issue comment、自由文本摘要或临时控制台输出。
- 在 `result_state=captured` 时必须填写。
- 在 `result_state=verified/broken/stale` 时允许继续保留，用于追溯本次判定所依据的样本。

### `baseline_status`

- `ready`：当前作用域存在 active baseline，且 latest record 未绑定已被替换的 baseline。
- `insufficient`：当前作用域不存在可用 active baseline，或样本覆盖不足以形成有效对比。
- `superseded`：latest record 绑定的 baseline 已不再是当前 active baseline；此时 `current_result_state` 应投影为 `stale`。
- `baseline_status` 是 closed enum；新增取值只能通过新的 spec review 引入。

### `structured_payload`

- 必须承载可重放、可比对、可诊断的最小结构化样本，不得只保留渲染后的描述文本。
- 下游 FR 可以在不破坏本 FR 最小边界的前提下附加更多字段，但不得改变已有字段的空值和所有权语义。

### `failure_class`

- 仅在 `result_state=broken` 时允许出现且必须填写。
- 在 `result_state=captured/verified/stale` 时必须为空。

## 最小兼容 payload 示例

```json
{
  "anti_detection_validation_request": {
    "validation_scope": "layer2_interaction",
    "target_fr_ref": "FR-0013",
    "profile_ref": "profile/default",
    "browser_channel": "chrome-stable",
    "execution_surface": "real_browser",
    "sample_goal": "capture interaction safety baseline",
    "requested_execution_mode": "recon",
    "probe_bundle_ref": "probe-bundle/layer2-min-v1"
  },
  "anti_detection_structured_sample": {
    "sample_ref": "sample/layer2/2026-04-10T10:02:00Z",
    "target_fr_ref": "FR-0013",
    "validation_scope": "layer2_interaction",
    "profile_ref": "profile/default",
    "browser_channel": "chrome-stable",
    "execution_surface": "real_browser",
    "effective_execution_mode": "recon",
    "probe_bundle_ref": "probe-bundle/layer2-min-v1",
    "run_id": "run-20260410-100200-001",
    "captured_at": "2026-04-10T10:02:30Z",
    "structured_payload": {
      "dom_settle_ms": 410,
      "locator_resolution": "resolved",
      "interaction_window": "read_only"
    },
    "artifact_refs": ["artifact://run-20260410-100200-001/network-log"]
  },
  "anti_detection_baseline_snapshot": {
    "baseline_ref": "baseline/layer2/2026-04-10T10:00:00Z",
    "target_fr_ref": "FR-0013",
    "validation_scope": "layer2_interaction",
    "probe_bundle_ref": "probe-bundle/layer2-min-v1",
    "profile_ref": "profile/default",
    "browser_channel": "chrome-stable",
    "execution_surface": "real_browser",
    "effective_execution_mode": "recon",
    "signal_vector": {
      "dom_settle_ms_p95": 420,
      "locate_success_ratio": 0.99
    },
    "captured_at": "2026-04-10T10:00:00Z",
    "source_run_ids": ["run-20260410-100000-001"]
  },
  "anti_detection_baseline_registry_entry": {
    "target_fr_ref": "FR-0013",
    "validation_scope": "layer2_interaction",
    "profile_ref": "profile/default",
    "browser_channel": "chrome-stable",
    "execution_surface": "real_browser",
    "effective_execution_mode": "recon",
    "active_baseline_ref": "baseline/layer2/2026-04-10T10:00:00Z",
    "superseded_baseline_refs": [],
    "replacement_reason": "initial_seed",
    "updated_at": "2026-04-10T10:05:00Z"
  },
  "anti_detection_validation_record": {
    "record_ref": "validation/layer2/2026-04-10T10:06:00Z",
    "target_fr_ref": "FR-0013",
    "validation_scope": "layer2_interaction",
    "profile_ref": "profile/default",
    "browser_channel": "chrome-stable",
    "execution_surface": "real_browser",
    "effective_execution_mode": "recon",
    "probe_bundle_ref": "probe-bundle/layer2-min-v1",
    "sample_ref": "sample/layer2/2026-04-10T10:02:00Z",
    "baseline_ref": "baseline/layer2/2026-04-10T10:00:00Z",
    "result_state": "verified",
    "drift_state": "no_drift",
    "failure_class": null,
    "run_id": "run-20260410-100600-001",
    "validated_at": "2026-04-10T10:06:30Z"
  },
  "anti_detection_validation_view": {
    "target_fr_ref": "FR-0013",
    "validation_scope": "layer2_interaction",
    "profile_ref": "profile/default",
    "browser_channel": "chrome-stable",
    "execution_surface": "real_browser",
    "effective_execution_mode": "recon",
    "latest_record_ref": "validation/layer2/2026-04-10T10:06:00Z",
    "baseline_status": "ready",
    "current_result_state": "verified",
    "current_drift_state": "no_drift",
    "last_success_at": "2026-04-10T10:06:30Z"
  }
}
```
