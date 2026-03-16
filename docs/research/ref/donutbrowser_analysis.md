# zhom/donutbrowser 深度调研报告

## 1. 宏观信息
- **仓库地址**: [zhom/donutbrowser](https://github.com/zhom/donutbrowser)
- **Stars**: ~1.1k
- **定位**: 简单而强大的新一代指纹防关联浏览器，旨在替代 AdsPower, Hubstudio 等闭源商业产品。
- **核心技术栈**: Rust (Tauri Backend), TypeScript/React (Frontend)。

## 2. 核心架构与底层机制 (Profile & Browser Runner)
这是一个桌面端（而非纯 CLI 脚本）的多开容器管理方案，其核心在 Tauri 承载的 Rust 后端中由两个单例 Manager 主导：

### 2.1 高度集成的引擎启动器 (BrowserRunner)
- `BrowserRunner` 负责跨平台的进程管控。它不仅支持传统 Chromium、Firefox 甚至是 Zen 浏览器，更是**原生内置了对底层的反指纹内核 `Camoufox` 以及 `Wayfern` 的支持**。
- 当用户在前端点击启动某个配置 (Profile) 时，对应的 `CamoufoxManager` 会被唤起，若配置了 `randomize_fingerprint_on_launch`，它会在启动前自动计算并生成一份截然不同的伪造硬件画像，并将其随进程注入。

### 2.2 配置物理隔离 (ProfileManager)
- 采用极致的“物理隔离”方案：为每个浏览器 ID 在本地文件系统中硬开辟一个独立的数据大目录（缓存、Cookie、IndexedDB 等互不相干），并在内附带 `metadata.json` 长久固化该虚拟设备的硬件指纹特征，确保“养号”环境的连续性和稳定性。

## 3. 防泄漏基石：强制本地 Sidecar 代理池
DonutBrowser 在网络隔离上做到了极致，其 Proxy 架构是其最大亮点：
- **强制流量劫持**: 无论用户是否配置了外部的代理 IP，`PROXY_MANAGER` 都会在唤起任何浏览器**之前**，抢先启动一个叫 `donut-proxy` 的 Rust 编译的 Sidecar (边车) 守护进程守护在随机端口。
- **自动无感注入**: 在引擎启动之际（例如 Firefox 或 Camoufox），`ProfileManager` 会悄悄篡改该目录下的 `user.js` 文件，强行写入 `network.proxy.type = 1` 并将全局流量指向那个 Sidecar。
- **绝对的安全性**: 浏览器本身不直接连接远端代理节点。而是由 Sidecar 进程在操作系统底层接收浏览器的流量，并进行 GeoIP 欺骗注入和发往远端的 SOCKS5/HTTP 节点链。这意味着，就算浏览器内的防线被某些恶意网站打穿，网页 JS 嗅探到的也只是本地的 `donut-proxy` 内网端点，绝对无法泄露宿主机的跨域真实 IP。

## 4. 总结与借鉴价值
DonutBrowser 给 WebEnvoy 提供了一整套“批量账号安全管理系统”的可视化工程模板：
它并不是自己造指纹，而是将 `Camoufox` 作为底层驱动，在外面包了一层基于 Rust Tauri 的优秀并发管理器和 **Sidecar 强制代理池 (`donut-proxy`)**。
如果 WebEnvoy 日后需要扩展到多账号批量并发操作模式（例如电商批量跑单、矩阵社媒运营），这种 `Tauri 本地多窗 + 物理目录分割 + 强制边车隔离 IP` 的方案是目前安全系数最高的商业级实现范本。
