# FR-0012 Layer 1 指纹与 profile 一致性契约

## 边界与适用范围

本契约定义 `#235` 在 Phase 2 需要稳定冻结的两类机器边界：

1. profile 元数据中的 `fingerprint_profile_bundle`
2. 启动时构造的 `fingerprint_patch_manifest`

它们服务于后续 Layer 1 实现 PR、测试、以及运行前一致性校验。

本契约不定义：

- `FR-0010` / `FR-0011` 已冻结的门禁、审批、审计、状态机对象
- patch 具体代码实现
- Worker 线程指纹覆盖方案

## 输出对象

1. `fingerprint_profile_bundle`
2. `fingerprint_patch_manifest`
3. `fingerprint_consistency_check`

## fingerprint_profile_bundle

```json
{
  "fingerprint_profile_bundle": {
    "ua": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)...",
    "hardwareConcurrency": 8,
    "deviceMemory": 8,
    "screen": {
      "width": 1440,
      "height": 900,
      "colorDepth": 30,
      "pixelDepth": 30
    },
    "battery": {
      "level": 0.73,
      "charging": false
    },
    "timezone": "Asia/Shanghai",
    "audioNoiseSeed": 0.000047231,
    "canvasNoiseSeed": 0.000083154,
    "environment": {
      "os_family": "macos",
      "os_version": "14.6",
      "arch": "arm64"
    }
  }
}
```

约束：

1. 上述字段都属于稳定机器边界，不得在运行时按“临时随机值”补齐。
2. `audioNoiseSeed` 与 `canvasNoiseSeed` 必须稳定到 profile 级别，而不是 run 级别。
3. `environment` 字段用于 profile 一致性校验，不用于引入账号运营或长期行为管理能力。

## fingerprint_patch_manifest

```json
{
  "fingerprint_patch_manifest": {
    "profile": "xhs_account_001",
    "manifest_version": "1",
    "required_patches": [
      "audio_context",
      "battery",
      "navigator_plugins",
      "navigator_mime_types"
    ],
    "optional_patches": [
      "hardware_concurrency",
      "device_memory",
      "performance_memory",
      "permissions_api",
      "navigator_connection"
    ],
    "field_dependencies": {
      "audio_context": ["audioNoiseSeed"],
      "battery": ["battery.level", "battery.charging"],
      "navigator_plugins": [],
      "navigator_mime_types": [],
      "hardware_concurrency": ["hardwareConcurrency"],
      "device_memory": ["deviceMemory"],
      "performance_memory": ["deviceMemory"],
      "permissions_api": [],
      "navigator_connection": []
    },
    "unsupported_reason_codes": []
  }
}
```

约束：

1. `required_patches` 表示当前切片缺失后不得继续宣称满足该切片的 Layer 1 交付。
2. `optional_patches` 允许在后续切片继续实现，但语义必须保持稳定。
3. `field_dependencies` 是稳定机器边界，用于实现前校验与测试；patch 内部实现方式不是正式契约。
4. `unsupported_reason_codes` 只能使用稳定原因码，例如 `ENVIRONMENT_MISMATCH`、`PROFILE_FIELD_MISSING`、`PATCH_NOT_AVAILABLE`。

## fingerprint_consistency_check

```json
{
  "fingerprint_consistency_check": {
    "profile": "xhs_account_001",
    "expected_environment": {
      "os_family": "macos",
      "os_version": "14.6",
      "arch": "arm64"
    },
    "actual_environment": {
      "os_family": "linux",
      "os_version": "24.04",
      "arch": "x64"
    },
    "decision": "mismatch",
    "reason_codes": [
      "OS_FAMILY_MISMATCH",
      "ARCH_MISMATCH"
    ]
  }
}
```

约束：

1. 该对象只表达 Layer 1 一致性检查结果，不替代最终 gate 决策对象。
2. `decision=mismatch` 时，后续实现若决定阻断或降级，必须通过 `FR-0010.audit_record` 和相关执行结果对象回传。
3. 原因码属于稳定机器边界；解释文案属于非契约实现细节。

## 兼容性

1. 可以新增 patch 名称和原因码，但不得改变既有语义。
2. 若后续实现切片只覆盖 P0，不得删除 P1/P2 的已冻结 patch 名称，只能保持未实现状态。
3. 若未来需要引入新的 profile 一致性字段，必须通过独立 spec review 追加，不能在实现 PR 中隐式扩张。
