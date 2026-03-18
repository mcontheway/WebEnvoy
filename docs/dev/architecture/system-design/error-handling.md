# 错误处理与降级策略

> 所属文档：[系统设计（战术层）](../system-design.md) › 第十一章
> 覆盖章节：§十一 错误处理与降级策略

---

## 错误分类

| 错误类型 | 对应 FR | 处理策略 |
|---|---|---|
| 验证码 | ERR-01/02 | 暂停任务 → 通知 AI → 等待人工 → 恢复执行 |
| 登录失效（401/跳转登录页）| ERR-09 | 暂停操作 → 通知 AI"登录已失效" → 不自动重试 |
| 账号封禁/限制 | ERR-10 | 停止该配置空间写操作 → 通知用户 → 等待手动解封 |
| L3 Adapter 失效（平台改版） | ERR-11 | 返回明确错误 + 降级建议（转 L2）→ 附带诊断信息 |
| 操作频率超限 | ERR-05 | 返回频率超限错误 → 通知 AI / 用户稍后重试；是否进入冷却由上层系统或人工决定 |
| 通信断开 | ERR-07 | 30s 内自动重连 → 期间排队（上限 5 条）→ 超时通知 AI |

---

## L3 → L2 降级触发条件

降级**不由运行时自动执行**，而是由系统返回明确错误和诊断信息后，由开发者人工更新 `rules.yaml` 的 `execution.default` 字段来触发：

1. 适配器收到平台错误码且无法重试（改版导致）
2. 规则文件 `endpoints` 中对应端点标记为 `deprecated: true`
3. 连续 3 次 `fetch` 返回非预期数据结构

降级建议输出格式示例：

```json
{
  "status": "error",
  "code": "ERR-11",
  "message": "L3 Adapter 失效：search_notes 端点返回非预期结构（连续 3 次）",
  "diagnosis": {
    "endpoint": "/api/sns/web/v1/search/notes",
    "expected_field": "data.notes",
    "actual_response_keys": ["items", "meta"]
  },
  "suggestion": "建议将 rules.yaml 中 execution.default 改为 L2，并通过 recon --snapshot 更新语义查询"
}
```

---

## 断点续传

批量采集任务在 SQLite 中记录进度快照，进程异常退出后可从断点恢复，无需从头重跑：

```sql
CREATE TABLE batch_checkpoints (
  batch_id TEXT PRIMARY KEY,
  platform TEXT,
  task_type TEXT,
  params_json TEXT,          -- 原始任务参数
  total_requested INTEGER,
  completed INTEGER,
  status TEXT,               -- running / paused / completed / abandoned
  last_cursor TEXT,          -- 平台的翻页游标
  created_at DATETIME,
  updated_at DATETIME
);
```

**恢复流程**：`webenvoy resume --batch <batch_id>` → CLI 读取 `last_cursor` → 从该游标继续请求 → 写入同一 `batch_id` 的后续数据。
