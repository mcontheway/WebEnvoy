# AGENTS.md

本文档只说明 `docs/research/ref/` 的使用方式，不在这里重复架构结论。

## 目录定位

`docs/research/ref/` 存放外部项目、竞品和参考实现的调研报告。

- 这些文件用于补充背景、比较方案、验证假设
- 它们不是正式架构契约，也不是直接实现指令
- 研究结论如果已经被吸收到 `docs/dev/architecture/`，应优先读取正式架构文档

## 查阅原则

只有在以下场景才进入本目录：

1. 架构文档或 spec 明确留下开放问题
2. 需要比较多个候选方案的优缺点
3. 需要追溯某个架构决策的外部参考来源

如果只是执行既定 FR，通常不需要通读本目录。

## 优先顺序

按主题选读，不要整目录加载。

- 执行与漫游：`pinchtab_analysis.md`、`browser-use_analysis.md`、`bb-browser_analysis.md`
- 反检测与高隐匿：`camoufox_analysis.md`、`ghost-cursor_analysis.md`
- 通用抓取与适配器：`scrapling_analysis.md`、`page-agent_analysis.md`
- 写操作与富文本：`MultiPost-Extension_analysis.md`
- 云端浏览器与部署：`steel-browser_analysis.md`、`selenoid_analysis.md`
- 视觉兜底：`ui-tars_analysis.md`

## 读取约束

- 只读取当前问题直接相关的报告
- 先看结论，再决定是否深入看细节
- 如果研究结论与 `vision.md`、`docs/dev/architecture/` 或具体 spec 冲突，以后者为准
