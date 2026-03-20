# 平台适配器规范

> 所属文档：[系统设计（战术层）](../system-design.md) › 第八章
> 覆盖章节：§八 平台适配器规范

---

## 适配器的组成

每个目标平台由两个部分构成：

```
adapters/
  ├── xiaohongshu/
  │     ├── rules.yaml           ← 平台规则文件（可热更新）
  │     └── adapter.ts           ← TypeScript 适配器代码
  └── douyin/
        ├── rules.yaml
        └── adapter.ts
```

---

## 规则文件结构（`rules.yaml`）

规则文件描述平台的 API 端点、签名方式、读路径策略、限流策略和执行层选择，是**唯一需要随平台改版维护的文件**（通过热更新无需重启 CLI）。

```yaml
platform: xiaohongshu
version: "2026.03"

# API 端点（通过 Spike A 确认填入）
endpoints:
  search_notes:
    method: POST
    path: /api/sns/web/v1/search/notes
    sign_fn: window._webmsxyw          # 平台签名函数引用
    params_template:                   # 请求体模板
      keyword: "{{query}}"
      page: "{{page}}"
      page_size: 20

  note_detail:
    method: GET
    path: /api/sns/web/v1/feed
    sign_fn: window._webmsxyw

# 错误码映射
error_codes:
  "471": captcha_required
  "461": account_blocked
  "300": session_expired

# 限流策略
rate_limits:
  publish: { daily_max: 20, interval_ms: 5000 }
  comment: { daily_max: 100, interval_ms: 2000 }
  dm: { daily_max: 50, interval_ms: 3000 }

# webRequest 拦截规则（被动路径）
intercept_patterns:
  - url_pattern: "*/api/sns/web/v1/search*"
    data_type: note_list

# L3 读路径策略
read_strategy:
  primary: api
  fallback:
    - page_state
  admission_gate: api_primary_verified

# 执行层策略
execution:
  default: L3           # L3 / L2 / L1
  write: page_interact  # page_interact / api_direct
```

---

## 适配器代码职责

```typescript
// adapters/xiaohongshu/adapter.ts
export class XhsAdapter implements PlatformAdapter {
  // L3 读：API 主路径，必要时页面状态 fallback
  async search(query: string, page: number): Promise<NoteList> { ... }
  async detail(noteId: string): Promise<Note> { ... }

  // 写：真实页面交互
  async publish(content: NoteContent): Promise<PublishResult> { ... }
  async interact(action: InteractAction): Promise<InteractResult> { ... }
  async download(task: DownloadTask): Promise<DownloadResult> { ... }

  // 侦察与介入命令（ARCHITECTURE_PRINCIPLES.md §2 recon / dispatch）
  async recon(): Promise<ReconResult> { ... }
  async dispatch(next: DispatchDecision): Promise<DispatchResult> { ... }
}
```

`PlatformAdapter` 接口定义了七类标准命令，详见 [`ARCHITECTURE_PRINCIPLES.md`](../ARCHITECTURE_PRINCIPLES.md) §2。私信、点赞、评论、关注等具体动作统一归入 `interact`，不再为单一互动类型单独扩展第八类命令。

---

## L3 读路径与实现准入

为对齐 FR-0005 Spike 输出，平台适配器默认遵循以下规则：

1. **主路径**：核心读场景必须以 API 调用为 primary。
2. **fallback**：允许页面状态读取（例如 `window.__INITIAL_STATE__`）作为连续性或侦察补证路径。
3. **准入门槛**：`fallback` 不等于实现准入。若核心场景只有 fallback、缺少可复现 API 主路径，不得宣告该平台 L3 读能力已完成。
4. **规则可审计**：`rules.yaml` 中必须显式声明 `read_strategy`，并将 `admission_gate` 固定为 `api_primary_verified`。

---

## 热更新机制

| 文件类型 | 变更方式 | 生效时机 |
|---|---|---|
| `rules.yaml` | 文件系统监听（`chokidar`）| **无需重启 CLI**，下一次平台操作调用时自动使用最新规则 |
| `adapter.ts` | 编译产物变更 | 需要重启 CLI 进程 |

---

## 改版后快速维护路径

当平台 UI 改版导致适配器失效时，基于 AX Tree 语义查询的维护流程（参考 bb-browser 「10 分钟 CLI 化」思路）：

```
1. webenvoy recon --snapshot -i   → 生成新版本的 AX Tree 快照（约 2 分钟）
2. 对比新旧快照，找到语义节点的变化（「发布」按钮改名为「创作」）
3. 更新 rules.yaml 中的语义查询参数（或更新 adapter.ts 中的 AX 查询逻辑）
4. 验证
→ 全程约 10 分钟，不需要读懂平台的 React/Vue 源码
```

**为什么 AX Tree 比 CSS 选择器稳定**：
- CSS 类名（如 `.creator-btn-publish`）在前端构建时可能随版本哈希改变
- AX 语义角色和 `name` 属性（如 `role: 'button', name: /发布|创作/`）与 UI 框架实现解耦，改版后通常仍然有效

详细的行为引擎与平台适配器分层原则，见 [`anti-detection.md`](../anti-detection.md) §4.5。
