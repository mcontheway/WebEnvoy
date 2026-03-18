# 数据库结构

> 所属文档：[系统设计（战术层）](../system-design.md) › 第十二章
> 覆盖章节：§十二 数据库结构（核心表）

---

## 设计约束

- **引擎**：SQLite，WAL 模式（`PRAGMA journal_mode=WAL`），读写并发安全
- **媒体文件**：不存 Blob，只存文件路径引用；Blob 落本地磁盘
- **并发保证**：同一 Profile 同时只有一个 CLI 进程（配置空间独占锁），SQLite WAL 保证读写不互斥

---

## 核心表 DDL

```sql
-- WAL 模式
PRAGMA journal_mode=WAL;

-- 采集数据主表（通用结构）
CREATE TABLE raw_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id TEXT,
  platform TEXT NOT NULL,           -- 'xiaohongshu' / 'douyin'
  data_type TEXT NOT NULL,          -- 'note' / 'user' / 'comment'
  biz_id TEXT NOT NULL,             -- 平台侧业务 ID
  data_json TEXT NOT NULL,          -- 完整 JSON 字符串
  source_url TEXT,
  collected_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  retained INTEGER DEFAULT 0,       -- 人工保留标记，跳过自动清理
  UNIQUE(platform, data_type, biz_id) ON CONFLICT REPLACE
);

-- 批量任务断点续传
CREATE TABLE batch_checkpoints (
  batch_id TEXT PRIMARY KEY,
  platform TEXT,
  task_type TEXT,
  params_json TEXT,
  total_requested INTEGER,
  completed INTEGER,
  status TEXT,               -- running / paused / completed / abandoned
  last_cursor TEXT,
  created_at DATETIME,
  updated_at DATETIME
);

-- 写操作审计日志
CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  profile TEXT NOT NULL,
  operation TEXT NOT NULL,          -- 'publish' / 'comment' / 'dm'
  target_id TEXT,
  result TEXT,                      -- 'success' / 'failed'
  result_data TEXT,                 -- 成功时的平台返回 ID/URL
  executed_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 高频查询索引
CREATE INDEX idx_items_platform_type ON raw_items(platform, data_type);
CREATE INDEX idx_items_biz_id ON raw_items(platform, biz_id);
CREATE INDEX idx_items_collected ON raw_items(collected_at);
```

---

## 数据流向

```
Content Script fetch() 响应
     ↓
Extension Background（摘要提取）
     ↓
CLI 进程（SQLite 写入）
     ↓
raw_items / batch_checkpoints / audit_log
     ↓
AI 通过 CLI 查询接口按 batch_id 按需读取
```

`raw_items` 的 `UNIQUE ... ON CONFLICT REPLACE` 约束确保同一业务 ID 的数据不重复入库（幂等写入），断点续传时不会产生重复记录。

---

## 逻辑能力与物理表映射

为保持 CLI 对外能力面简洁，通信层会使用“搜索结果”“详情结果”“下载结果”等逻辑名称；这些名称不额外派生新的 SQLite 物理表，统一映射到以下三类核心表：

| 逻辑能力 | 物理落库 |
|---|---|
| 搜索 / 列表读取 | `raw_items` + `batch_checkpoints` |
| 详情读取 | `raw_items` |
| 发布 / 互动 / 下载 | `audit_log` |

如果后续需要为高频场景增加专用索引或派生视图，应在此文档先补充正式契约，再同步更新通信层说明；不要在单篇文档中直接引入未定义的新表名。
