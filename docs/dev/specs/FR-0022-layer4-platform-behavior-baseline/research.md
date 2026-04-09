# FR-0022 研究记录

## 研究问题

在不越界到账号运营系统的前提下，如何为 Layer 4 冻结一套可实现、可验证、可回滚的“平台历史行为基线与偏移评估”正式边界。

## 当前输入

- `docs/dev/architecture/anti-detection.md`（Layer 4 与 backlog 映射）
- `docs/dev/roadmap.md`（Layer 4 作为后层扩展，不在当前阶段承诺完整实现）
- `docs/dev/architecture/system-design/account.md`（profile/session 最小身份边界）
- `FR-0010`、`FR-0011`（门禁主链）
- `FR-0014`（session 节律边界）
- `#423/#238/#239`（当前主树挂接与验证前置）

## 收敛结论

1. Layer 4 的首要缺口是 formal contract 与 data model，不是先写实现代码。  
2. Layer 4 必须与门禁主链解耦：只输出 `decision_hint`，不直接改写最终放行状态。  
3. 冷启动与学习期必须保守处理，否则会出现“无基线自动放行”的高风险缺陷。  
4. 评估对象必须坚持数据最小化，行为模型只消费结构化摘要，不消费页面原文/私密原文。  
5. `FR-0020`（`#239`）的验证口径是 Layer 4 进入 implementation-ready 的必要前置。  
