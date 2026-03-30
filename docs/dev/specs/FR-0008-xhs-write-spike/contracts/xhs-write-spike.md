# XHS Write Spike 契约

## 边界与适用范围

本契约定义 FR-0008 侦察阶段的结构化输出边界，用于把小红书最小写链路结论稳定交付给 `#208` 与后续写能力实现 FR。

本契约不定义：

- FR-0001 CLI 外层 argv / output 契约
- FR-0002 Native Messaging 通信协议
- FR-0003 会话状态机
- 具体 `publish` / `interact` / 上传实现代码
- `editor_input` / `interact` 的正式命令接口

## 输出对象

Spike 输出必须包含以下四个对象：

1. `editor_path`
2. `upload_path_catalog`
3. `minimal_action_candidates`
4. `gate_status`

## editor_path

### 语义

记录富文本编辑器的入口、焦点、输入事件链与成功/失败信号。

### 最小结构

```json
{
  "scenario": "rich_text_editor",
  "route_role": "primary|fallback",
  "path_kind": "page|api",
  "entry_locator": "selector|semantic description",
  "focus_strategy": "physical_click|programmatic_focus|candidate",
  "event_chain": [
    "mousedown",
    "mouseup",
    "focus",
    "compositionstart",
    "compositionupdate",
    "compositionend",
    "input",
    "change",
    "blur"
  ],
  "success_signals": ["value_visible", "framework_state_synced", "submit_not_empty"],
  "failure_signals": ["focus_lost", "is_trusted_rejected", "submit_empty", "dom_variant"],
  "evidence_status": "success|failed|candidate",
  "evidence_maturity": "observed_once|reproduced_multi_round|admission_ready",
  "notes": "前置条件、适用页面和分流说明"
}
```

补充约束：

1. `path_kind=page` 时，`focus_strategy` 与 `event_chain` 必须填写。
2. `path_kind=api` 只允许表示“保存草稿或内部接口”一类降级候选，不得伪装成页面输入已验证。
3. 若 `evidence_maturity=admission_ready`，必须满足多轮复现、成功/失败信号稳定、风险边界明确三项条件。

## upload_path_catalog

### 语义

记录图片上传路径，并区分页面主路径与 API 降级路径。

### 外层容器

`upload_path_catalog` 必须是数组容器，元素类型为 `UploadPathEvidence`。

```json
{
  "upload_path_catalog": [
    {
      "scenario": "image_upload",
      "route_role": "primary",
      "path_kind": "page"
    },
    {
      "scenario": "image_upload",
      "route_role": "fallback",
      "path_kind": "api"
    }
  ]
}
```

容器约束：

1. 允许同时存在多条记录，且至少保留一条失败样本或候选样本，不得只保留成功路径。
2. 唯一键为 `(scenario, route_role, path_kind, entry_type)`；同键重复时必须合并为最新一条并把差异写入 `notes`。
3. 排序规则固定为：`route_role=primary` 在前，`route_role=fallback` 在后；同一 `route_role` 下按 `entry_type` 字典序。

### 最小结构

```json
{
  "scenario": "image_upload",
  "route_role": "primary|fallback",
  "path_kind": "page|api",
  "entry_type": "file_input|dropzone|upload_api",
  "file_injection": "data_transfer|native_picker_bridge|api_direct|candidate",
  "trigger_events": ["change", "input", "drop"],
  "progress_signals": ["preview_visible", "uploading", "upload_done"],
  "failure_signals": ["type_rejected", "size_rejected", "upload_failed", "risk_blocked"],
  "evidence_status": "success|failed|candidate",
  "evidence_maturity": "observed_once|reproduced_multi_round|admission_ready",
  "notes": "页面入口、接口线索或失败样本"
}
```

补充约束：

1. 页面上传失败时，不得删除对应失败记录；若存在 API 降级候选，必须单独写为另一条记录。
2. `entry_type=upload_api` 时，`route_role` 只能是 `fallback` 或明确修订后的 `primary`，默认不得作为当前主路径。
3. `admission_ready` 仅允许用于后续实现真正准备采用的主路径证据。

## minimal_action_candidates

### 语义

向 `#208` 输出“可供正式验证选择的最小页面交互动作候选”，但不直接替代 `#208` 的正式结论。

### 外层容器

`minimal_action_candidates` 必须是数组容器，元素类型为 `MinimalActionCandidate`。

```json
{
  "minimal_action_candidates": [
    {
      "action_id": "editor_input",
      "handoff_status": "recommended_input"
    },
    {
      "action_id": "image_attach",
      "handoff_status": "candidate_input"
    }
  ]
}
```

容器约束：

1. `action_id` 在数组内必须唯一，不允许重复候选。
2. 排序规则固定为 `handoff_status` 优先级：`recommended_input` > `candidate_input` > `blocked`；同状态按 `action_id` 字典序。
3. 若全部为 `blocked`，仍必须保留完整候选数组，并在 `notes` 给出阻断理由，不得返回空数组掩盖失败。

### 最小结构

```json
{
  "action_id": "editor_focus|editor_input|image_attach",
  "goal": "供 #208 评估的最小页面交互动作",
  "preconditions": ["logged_in", "page_ready"],
  "steps": ["open_page", "focus_editor", "type_text"],
  "success_signals": ["cursor_visible", "text_persisted"],
  "failure_signals": ["focus_lost", "risk_prompt", "dom_variant"],
  "minimum_replay": ["step 1", "step 2", "step 3"],
  "handoff_status": "candidate_input|recommended_input|blocked",
  "evidence_maturity": "observed_once|reproduced_multi_round|admission_ready",
  "notes": "为何推荐或阻断"
}
```

补充约束：

1. `handoff_status=recommended_input` 不等于 `#208` 已完成，只表示当前更适合作为其正式验证候选。
2. 任何候选动作若依赖多步骤发布、上传后提交或不可逆写入，默认不应被推荐给 `#208`。
3. `action_id=editor_input` 仅表示最小页面交互候选动作，不等于已冻结 `xhs.editor_input` 或 `xhs.interact` 的正式 machine contract。
4. `interact` 当前未在本 Spike 中被冻结为正式候选动作；后续若需要正式机器接口，必须通过独立 contract 规约定义。
5. 一旦 `#208` 的正式验证说明冻结唯一正式验证对象为 `editor_input`，其他候选动作必须降为 `candidate_input` 或 `blocked`，不得继续与其并列为 `recommended_input`。
6. 当 `action_id=editor_input` 被 `#208` 选为唯一正式验证对象时，其验证边界固定为 `creator.xiaohongshu.com/publish` 页面上的“聚焦并输入少量文本”的可逆交互，不得扩张到上传、提交或发布确认。

## gate_status

### 语义

分别记录 fallback viability 与 implementation readiness。

### 最小结构

```json
{
  "fallback_viability": "PASS|BLOCKED",
  "implementation_readiness": "PASS|BLOCKED",
  "rationale": {
    "fallback": "为何可保留连续性输入",
    "implementation": "为何可或不可进入实现 FR"
  }
}
```

## 兼容性约束

1. 新增字段允许追加，不允许破坏既有字段语义。
2. `admission_ready` 的定义变化必须触发后续实现 FR 的显式评审。
3. 未识别失败信号必须追加，不得静默忽略。
4. `#208` 只可消费 `minimal_action_candidates` 中明确输出的对象，不得自行扩写为完整写链路范围。
