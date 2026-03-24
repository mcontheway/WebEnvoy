# FR-0012 数据模型（Layer 1 JS 指纹补全与 profile 一致性）

## 范围说明

本模型只定义 FR-0012 需要稳定冻结的共享对象，不新增 SQLite schema。
核心承载落点是 profile 元数据文件 `__webenvoy_meta.json` 及其启动时构造的补丁清单。

凡涉及门禁、审批、审计、风险状态的机器字段，一律继承 `FR-0010` / `FR-0011`；FR-0012 不新增并行 gate/status 数据模型。

## 实体 1：FingerprintProfileBundle

- `ua` TEXT NOT NULL
- `hardwareConcurrency` INTEGER NOT NULL
- `deviceMemory` INTEGER NOT NULL
- `screen.width` INTEGER NOT NULL
- `screen.height` INTEGER NOT NULL
- `screen.colorDepth` INTEGER NOT NULL
- `screen.pixelDepth` INTEGER NOT NULL
- `battery.level` DECIMAL NOT NULL
- `battery.charging` BOOLEAN NOT NULL
- `timezone` TEXT NOT NULL
- `audioNoiseSeed` DECIMAL NOT NULL
- `canvasNoiseSeed` DECIMAL NOT NULL
- `environment.os_family` TEXT NOT NULL
- `environment.os_version` TEXT NOT NULL
- `environment.arch` TEXT NOT NULL

约束：

1. 上述字段均属于稳定机器边界，写入后不得在每次运行时重新随机生成。
2. `battery.level` 必须位于 `[0, 1]` 区间内。
3. `hardwareConcurrency`、`deviceMemory`、`screen.*` 必须彼此可解释，不得出现明显矛盾的设备画像。
4. `environment.*` 用于一致性校验，不代表引入新的账号运营元数据。

## 实体 2：FingerprintPatchManifest

- `profile` TEXT NOT NULL
- `manifest_version` TEXT NOT NULL
- `required_patches` ARRAY NOT NULL
- `optional_patches` ARRAY NOT NULL
- `field_dependencies` OBJECT NOT NULL
- `unsupported_reason_codes` ARRAY NOT NULL

约束：

1. `required_patches` 至少覆盖当前实现切片中的必需补丁。
2. `field_dependencies` 必须显式声明每个 patch 所依赖的 `FingerprintProfileBundle` 字段。
3. `unsupported_reason_codes` 只承载稳定原因码，不承载自由文本解释。
4. patch 名称和原因码属于稳定机器边界；具体 patch 函数实现、文件组织和 helper 名称不属于正式契约。

## 实体 3：FingerprintConsistencyCheck

- `profile` TEXT NOT NULL
- `expected_environment.os_family` TEXT NOT NULL
- `expected_environment.os_version` TEXT NOT NULL
- `expected_environment.arch` TEXT NOT NULL
- `actual_environment.os_family` TEXT NOT NULL
- `actual_environment.os_version` TEXT NOT NULL
- `actual_environment.arch` TEXT NOT NULL
- `decision` ENUM NOT NULL (`match` | `mismatch`)
- `reason_codes` ARRAY NOT NULL

约束：

1. `decision=mismatch` 时，`reason_codes` 不得为空。
2. 该对象只表达 Layer 1 一致性结果，不替代 `FR-0010.gate_outcome`。
3. 若实现把 `decision=mismatch` 映射为 live 阻断或降级，必须通过既有 `audit_record` / `consumer_gate_result` 回传，而不是新增并行最终判定对象。

## 哪些字段是稳定机器边界，哪些不是

### 稳定机器边界

- `FingerprintProfileBundle` 的全部字段
- `FingerprintPatchManifest.required_patches`
- `FingerprintPatchManifest.optional_patches`
- `FingerprintPatchManifest.field_dependencies`
- `FingerprintPatchManifest.unsupported_reason_codes`
- `FingerprintConsistencyCheck.decision`
- `FingerprintConsistencyCheck.reason_codes`

### 非正式契约实现细节

- patch 具体实现文件名和目录结构
- `addInitScript` 内部如何装配补丁代码
- patch 函数内部的 helper 名称
- 检测站点抓样脚本与本地调试日志格式

## 生命周期

1. profile 创建或升级时生成/补齐 `FingerprintProfileBundle`。
2. 启动时读取 profile 元数据并构造 `FingerprintPatchManifest`。
3. 运行前执行 `FingerprintConsistencyCheck`。
4. 若检查失败，由实现层通过既有门禁/审计链路返回结构化结果。

## 与现有 FR 对齐

- 与 `FR-0010`：
  - 继续复用 `audit_record` 与 `consumer_gate_result` 作为执行结果回传承载。
- 与 `FR-0011`：
  - 继续复用 `risk_state_machine`、`session_rhythm_policy` 与 `issue_action_matrix` 作为 live 前置。
- 与 `account.md`：
  - `__webenvoy_meta.json` 仍是 profile 元数据承载点，但 FR-0012 只扩展指纹一致性直接相关字段。
  - 既有 `proxy.url` / `proxy.boundAt` 黏性绑定语义继续保留，作为协同约束存在，但不在 FR-0012 中升级为新的正式 Layer 1 契约对象。
